/**
 * Unit tests for the TaskStore — SQLite operations, leases, events, checkpoints.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreateTaskInput } from "../src/runtime/task-model.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB_DIR = join(import.meta.dirname ?? ".", ".test-db");

function getTestDbPath(): string {
	return join(TEST_DB_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("TaskStore", () => {
	let store: TaskStore;
	let dbPath: string;

	beforeEach(() => {
		if (!existsSync(TEST_DB_DIR)) {
			mkdirSync(TEST_DB_DIR, { recursive: true });
		}
		dbPath = getTestDbPath();
		store = new TaskStore(dbPath);
	});

	afterEach(() => {
		store.close();
		// Clean up test databases
		try {
			rmSync(dbPath, { force: true });
			rmSync(`${dbPath}-wal`, { force: true });
			rmSync(`${dbPath}-shm`, { force: true });
		} catch {}
	});

	describe("Task CRUD", () => {
		const baseInput: CreateTaskInput = {
			name: "test-task",
			goal: "Test something important",
		};

		it("should create a task with UUID", () => {
			const task = store.createTask(baseInput);
			expect(task.id).toMatch(/^[0-9a-f]{8}-/);
			expect(task.name).toBe("test-task");
			expect(task.goal).toBe("Test something important");
			expect(task.enabled).toBe(true);
		});

		it("should retrieve a task by ID", () => {
			const created = store.createTask(baseInput);
			const retrieved = store.getTask(created.id);
			expect(retrieved).toBeDefined();
			expect(retrieved!.id).toBe(created.id);
			expect(retrieved!.name).toBe("test-task");
		});

		it("should retrieve a task by name", () => {
			store.createTask(baseInput);
			const retrieved = store.getTaskByName("test-task");
			expect(retrieved).toBeDefined();
			expect(retrieved!.name).toBe("test-task");
		});

		it("should return undefined for non-existent task", () => {
			expect(store.getTask("non-existent")).toBeUndefined();
			expect(store.getTaskByName("non-existent")).toBeUndefined();
		});

		it("should list all tasks", () => {
			store.createTask({ name: "task-1", goal: "First" });
			store.createTask({ name: "task-2", goal: "Second" });
			const tasks = store.listTasks();
			expect(tasks.length).toBe(2);
		});

		it("should enforce unique task names", () => {
			store.createTask(baseInput);
			expect(() => store.createTask(baseInput)).toThrow();
		});

		it("should persist elevated privilege flag in task store", () => {
			const task = store.createTask({
				...baseInput,
				name: "root-sysadmin-task",
				elevated: true,
			});
			expect(task.elevated).toBe(true);

			const fetched = store.getTask(task.id);
			expect(fetched?.elevated).toBe(true);
		});

		it("should create task with schedule", () => {
			const task = store.createTask({
				...baseInput,
				name: "scheduled-task",
				schedule: { type: "interval", seconds: 30 },
			});
			expect(task.schedule).toEqual({ type: "interval", seconds: 30 });
		});

		it("should create task with full config", () => {
			const task = store.createTask({
				name: "full-task",
				goal: "Full config test",
				profile: "sysadmin",
				schedule: { type: "interval", seconds: 60 },
				overlapPolicy: "skip",
				timeoutSeconds: 300,
				retryPolicy: { maxRetries: 3, delaySeconds: 10, strategy: "exponential" },
				policyMode: "safe",
				toolsAllow: ["bash", "read"],
				skills: ["linux-log-analysis"],
				modelTier: "fast",
			});
			expect(task.profile).toBe("sysadmin");
			expect(task.overlapPolicy).toBe("skip");
			expect(task.timeoutSeconds).toBe(300);
			expect(task.retryPolicy.maxRetries).toBe(3);
			expect(task.retryPolicy.strategy).toBe("exponential");
			expect(task.policyMode).toBe("safe");
			expect(task.toolsAllow).toEqual(["bash", "read"]);
			expect(task.skills).toEqual(["linux-log-analysis"]);
			expect(task.modelTier).toBe("fast");
		});

		it("should delete a task", () => {
			const task = store.createTask(baseInput);
			expect(store.deleteTask(task.id)).toBe(true);
			expect(store.getTask(task.id)).toBeUndefined();
		});

		it("should return false when deleting non-existent task", () => {
			expect(store.deleteTask("non-existent")).toBe(false);
		});

		it("should update task enabled status", () => {
			const task = store.createTask(baseInput);
			store.updateTaskEnabled(task.id, false);
			expect(store.getTask(task.id)!.enabled).toBe(false);
			store.updateTaskEnabled(task.id, true);
			expect(store.getTask(task.id)!.enabled).toBe(true);
		});
	});

	describe("Task Runs", () => {
		it("should create a run", () => {
			const task = store.createTask({ name: "run-test", goal: "Test runs" });
			const run = store.createRun(task.id);
			expect(run.id).toMatch(/^[0-9a-f]{8}-/);
			expect(run.taskId).toBe(task.id);
			expect(run.status).toBe("CREATED");
		});

		it("should list runs for a task", () => {
			const task = store.createTask({ name: "runs-test", goal: "Test runs list" });
			store.createRun(task.id);
			store.createRun(task.id);
			const runs = store.listRuns(task.id);
			expect(runs.length).toBe(2);
		});

		it("should update run status with valid transition", () => {
			const task = store.createTask({ name: "status-test", goal: "Test status" });
			const run = store.createRun(task.id);
			store.updateRunStatus(run.id, "ENABLED");
			const updated = store.getRun(run.id);
			expect(updated!.status).toBe("ENABLED");
		});

		it("should find active run", () => {
			const task = store.createTask({ name: "active-test", goal: "Test active" });
			const run = store.createRun(task.id, "RUNNING");
			const active = store.getActiveRun(task.id);
			expect(active).toBeDefined();
			expect(active!.id).toBe(run.id);
		});
	});

	describe("Lease Management", () => {
		it("should acquire a lease", () => {
			const task = store.createTask({ name: "lease-test", goal: "Test leases" });
			const run = store.createRun(task.id);
			const leaseId = store.acquireLease(task.id, run.id, "test-owner", 60);
			expect(leaseId).toBeTruthy();
		});

		it("should prevent double lease acquisition", () => {
			const task = store.createTask({ name: "double-lease", goal: "Test double lease" });
			const run1 = store.createRun(task.id);
			const run2 = store.createRun(task.id);
			const lease1 = store.acquireLease(task.id, run1.id, "owner-1", 60);
			const lease2 = store.acquireLease(task.id, run2.id, "owner-2", 60);
			expect(lease1).toBeTruthy();
			expect(lease2).toBeNull();
		});

		it("should release a lease", () => {
			const task = store.createTask({ name: "release-test", goal: "Test release" });
			const run = store.createRun(task.id);
			store.acquireLease(task.id, run.id, "test-owner", 60);
			store.releaseLease(task.id);
			expect(store.getLease(task.id)).toBeNull();
		});

		it("should allow new lease after release", () => {
			const task = store.createTask({ name: "reacquire", goal: "Test reacquire" });
			const run1 = store.createRun(task.id);
			const run2 = store.createRun(task.id);
			store.acquireLease(task.id, run1.id, "owner-1", 60);
			store.releaseLease(task.id);
			const lease2 = store.acquireLease(task.id, run2.id, "owner-2", 60);
			expect(lease2).toBeTruthy();
		});

		it("should renew a lease", () => {
			const task = store.createTask({ name: "renew-test", goal: "Test renew" });
			const run = store.createRun(task.id);
			const leaseId = store.acquireLease(task.id, run.id, "test-owner", 60)!;
			const renewed = store.renewLease(task.id, leaseId, 120);
			expect(renewed).toBe(true);
		});

		it("should recover stale leases", () => {
			const task = store.createTask({ name: "stale-test", goal: "Test stale" });
			const run = store.createRun(task.id, "RUNNING");

			// Manually insert an expired lease
			store.acquireLease(task.id, run.id, "dead-owner", 0);

			// Wait a tick for expiry
			const recovered = store.recoverStaleLeases();
			expect(recovered).toContain(task.id);
			expect(store.getLease(task.id)).toBeNull();
		});
	});

	describe("Events", () => {
		it("should record events on task creation", () => {
			const task = store.createTask({ name: "event-test", goal: "Test events" });
			const events = store.listEvents(task.id);
			expect(events.length).toBeGreaterThan(0);
			expect(events.some((e) => e.eventType === "task_created")).toBe(true);
		});

		it("should record custom events", () => {
			const task = store.createTask({ name: "custom-event", goal: "Test custom events" });
			store.recordEvent(task.id, undefined, "task_enabled", { reason: "test" });
			const events = store.listEvents(task.id);
			expect(events.some((e) => e.eventType === "task_enabled")).toBe(true);
		});
	});

	describe("Checkpoints", () => {
		it("should upsert a checkpoint", () => {
			const task = store.createTask({ name: "cp-test", goal: "Test checkpoints" });
			store.upsertCheckpoint({
				taskId: task.id,
				checkpointKey: "/var/log/nginx/error.log",
				device: "sda1",
				inode: "829174",
				byteOffset: 15829031,
				lineOffset: 50000,
				lastHash: "abc123",
			});

			const cp = store.getCheckpoint(task.id, "/var/log/nginx/error.log");
			expect(cp).toBeDefined();
			expect(cp!.byteOffset).toBe(15829031);
			expect(cp!.inode).toBe("829174");
		});

		it("should update existing checkpoint", () => {
			const task = store.createTask({ name: "cp-update", goal: "Test checkpoint update" });
			const key = "/var/log/syslog";

			store.upsertCheckpoint({
				taskId: task.id,
				checkpointKey: key,
				byteOffset: 100,
				lineOffset: 10,
			});

			store.upsertCheckpoint({
				taskId: task.id,
				checkpointKey: key,
				byteOffset: 200,
				lineOffset: 20,
			});

			const cp = store.getCheckpoint(task.id, key);
			expect(cp!.byteOffset).toBe(200);
			expect(cp!.lineOffset).toBe(20);
		});
	});

	describe("Cleanup", () => {
		it("should clean up old completed runs", () => {
			const task = store.createTask({ name: "cleanup-test", goal: "Test cleanup" });
			const run = store.createRun(task.id);

			// Manually set finished_at to a past date
			store.updateRunStatus(run.id, "ENABLED");
			store.updateRunStatus(run.id, "DUE");
			store.updateRunStatus(run.id, "ACQUIRING");
			store.updateRunStatus(run.id, "RUNNING");
			store.updateRunStatus(run.id, "SUCCEEDED", {
				finishedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(), // 60 days ago
			});

			const removed = store.cleanupOldRuns(30);
			expect(removed).toBe(1);
		});
	});

	describe("Schema Migration and Legacy DB Upgrade", () => {
		it("should seamlessly migrate a legacy database missing the elevated column", async () => {
			const { DatabaseSync } = await import("node:sqlite");
			const legacyDbPath = getTestDbPath();

			// Initialize a legacy DB (schema version 1) without the elevated column in tasks and task_runs
			const rawDb = new DatabaseSync(legacyDbPath);
			rawDb.exec(`
				CREATE TABLE tasks (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL UNIQUE,
					goal TEXT NOT NULL,
					profile TEXT,
					schedule_type TEXT,
					schedule_value TEXT,
					enabled INTEGER NOT NULL DEFAULT 1,
					overlap_policy TEXT NOT NULL DEFAULT 'skip',
					timeout_seconds INTEGER DEFAULT 120,
					retry_max INTEGER DEFAULT 0,
					retry_delay_seconds INTEGER DEFAULT 30,
					retry_strategy TEXT DEFAULT 'fixed',
					policy_mode TEXT DEFAULT 'autonomous',
					tools_allow TEXT,
					tools_deny TEXT,
					skills TEXT,
					model_tier TEXT,
					notifications TEXT,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					updated_at TEXT NOT NULL DEFAULT (datetime('now')),
					next_run_at TEXT,
					last_run_at TEXT,
					last_success_at TEXT
				);
				CREATE TABLE task_runs (
					id TEXT PRIMARY KEY,
					task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
					session_id TEXT,
					started_at TEXT NOT NULL DEFAULT (datetime('now')),
					finished_at TEXT,
					status TEXT NOT NULL DEFAULT 'CREATED',
					exit_reason TEXT,
					error TEXT,
					result_summary TEXT,
					input_tokens INTEGER DEFAULT 0,
					output_tokens INTEGER DEFAULT 0,
					tool_calls INTEGER DEFAULT 0,
					duration_ms INTEGER,
					cpu_percent REAL,
					memory_mb REAL
				);
				CREATE TABLE schema_version (
					version INTEGER NOT NULL
				);
				INSERT INTO schema_version (version) VALUES (1);
			`);
			rawDb.close();

			// Now open with TaskStore - should automatically detect missing columns and migrate without error
			const upgradedStore = new TaskStore(legacyDbPath);
			try {
				const created = upgradedStore.createTask({
					name: "migrated-elevated-task",
					goal: "Ensure elevated column works after migration",
					elevated: true,
				});

				expect(created.elevated).toBe(true);
				const fetched = upgradedStore.getTask(created.id);
				expect(fetched?.elevated).toBe(true);

				const run = upgradedStore.createRun(created.id, "CREATED", {
					elevated: true,
					triggerType: "manual",
				});
				expect(run.elevated).toBe(true);
				expect(run.triggerType).toBe("manual");
			} finally {
				upgradedStore.close();
				try {
					rmSync(legacyDbPath, { force: true });
					rmSync(`${legacyDbPath}-wal`, { force: true });
					rmSync(`${legacyDbPath}-shm`, { force: true });
				} catch {}
			}
		});
	});
});
