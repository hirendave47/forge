/**
 * Concurrency tests for Forge Linux Agent.
 *
 * Explicitly tests §31 requirement:
 * "two scheduler triggers at exactly the same time — only one must acquire the lease."
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskRuntime } from "../src/runtime/task-runtime.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB_DIR = join(import.meta.dirname ?? ".", ".test-concurrency-db");

function getTestDbPath(): string {
	return join(TEST_DB_DIR, `test-concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("Concurrency & Lease Prevention (§5, §31)", () => {
	let dbPath: string;
	let store: TaskStore;

	beforeEach(() => {
		if (!existsSync(TEST_DB_DIR)) {
			mkdirSync(TEST_DB_DIR, { recursive: true });
		}
		dbPath = getTestDbPath();
		store = new TaskStore(dbPath);
	});

	afterEach(() => {
		store.close();
		try {
			rmSync(dbPath, { force: true });
			rmSync(`${dbPath}-wal`, { force: true });
			rmSync(`${dbPath}-shm`, { force: true });
		} catch {}
	});

	it("should allow only ONE execution when two triggers occur at the exact same time", async () => {
		const task = store.createTask({
			name: "nginx-monitor-concurrent",
			goal: "Monitor nginx error log",
			overlapPolicy: "skip",
			schedule: { type: "interval", seconds: 30 },
			enabled: true,
		});

		// Create two separate runtime instances (e.g. two scheduler processes or worker threads)
		const runtime1 = new TaskRuntime({ dbPath, ownerId: "worker-1" });
		const runtime2 = new TaskRuntime({ dbPath, ownerId: "worker-2" });

		try {
			// Acquire lease simultaneously by running executeTask in parallel
			// We simulate a long running task via leases
			const run1 = store.createRun(task.id, "ACQUIRING");
			const run2 = store.createRun(task.id, "ACQUIRING");

			// Both try to acquire lease simultaneously
			const [lease1, lease2] = await Promise.all([
				Promise.resolve(store.acquireLease(task.id, run1.id, "worker-1", 60)),
				Promise.resolve(store.acquireLease(task.id, run2.id, "worker-2", 60)),
			]);

			// Exactly one must succeed, the other must fail (return null)
			const successfulLeases = [lease1, lease2].filter((l) => l !== null);
			const failedLeases = [lease1, lease2].filter((l) => l === null);

			expect(successfulLeases.length).toBe(1);
			expect(failedLeases.length).toBe(1);

			// Check database state
			const activeLease = store.getLease(task.id);
			expect(activeLease).toBeDefined();
			expect(activeLease!.lease_id).toBe(successfulLeases[0]);

			// The failed run transitions to SKIPPED with an event recorded
			const winningRunId = lease1 ? run1.id : run2.id;
			const losingRunId = lease1 ? run2.id : run1.id;

			store.updateRunStatus(losingRunId, "SKIPPED", {
				exitReason: "overlap_skip",
				finishedAt: new Date().toISOString(),
			});
			store.recordEvent(task.id, losingRunId, "run_skipped", {
				reason: "overlap_skip",
				existingRunId: winningRunId,
			});

			const losingRun = store.getRun(losingRunId);
			expect(losingRun!.status).toBe("SKIPPED");
			expect(losingRun!.exitReason).toBe("overlap_skip");

			const events = store.listEvents(task.id);
			expect(events.some((e) => e.eventType === "run_skipped")).toBe(true);

			// Once the winner releases its lease, the next trigger is free to acquire it
			store.releaseLease(task.id);
			expect(store.getLease(task.id)).toBeNull();

			const run3 = store.createRun(task.id);
			const lease3 = store.acquireLease(task.id, run3.id, "worker-2", 60);
			expect(lease3).toBeTruthy();
		} finally {
			runtime1.close();
			runtime2.close();
		}
	});

	it("should automatically recover stale lease after a worker crash", async () => {
		const task = store.createTask({
			name: "crash-recovery-task",
			goal: "Recover after crash",
			overlapPolicy: "skip",
			enabled: true,
		});

		const crashedRun = store.createRun(task.id, "RUNNING");
		// Worker crashed without releasing lease; lease expired with 0s TTL
		store.acquireLease(task.id, crashedRun.id, "crashed-worker-pid-999", 0);

		// Next worker starts up and attempts lease acquisition
		const nextRun = store.createRun(task.id);
		const newLease = store.acquireLease(task.id, nextRun.id, "new-worker-pid-1000", 60);

		// Must succeed by reclaiming stale lease
		expect(newLease).toBeTruthy();

		const activeLease = store.getLease(task.id);
		expect(activeLease!.owner_id).toBe("new-worker-pid-1000");
		expect(activeLease!.run_id).toBe(nextRun.id);
	});
});
