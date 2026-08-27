/**
 * Unit & Integration tests for TaskScheduler.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResult, TaskRuntime } from "../src/runtime/task-runtime.ts";
import { TaskScheduler } from "../src/scheduler/scheduler.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB_DIR = join(import.meta.dirname ?? ".", ".test-scheduler-db");

function getTestDbPath(): string {
	return join(TEST_DB_DIR, `test-sched-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("TaskScheduler", () => {
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

	it("should initialize task schedules on start()", async () => {
		store.createTask({
			name: "task-init",
			goal: "Check initial schedule",
			schedule: { type: "interval", seconds: 60 },
			enabled: true,
		});

		const scheduler = new TaskScheduler({ dbPath, pollIntervalMs: 50 });
		await scheduler.start();

		const task = store.getTaskByName("task-init");
		expect(task!.nextRunAt).toBeDefined();

		const nextRun = new Date(task!.nextRunAt!);
		expect(nextRun.getTime()).toBeGreaterThan(Date.now());

		await scheduler.stop();
	});

	it("should recover stale leases on start()", async () => {
		const task = store.createTask({
			name: "stale-task",
			goal: "Check stale recovery",
			enabled: true,
		});
		const run = store.createRun(task.id, "RUNNING");
		// Create expired lease (0s TTL)
		store.acquireLease(task.id, run.id, "dead-pid", 0);

		const scheduler = new TaskScheduler({ dbPath, pollIntervalMs: 50 });
		await scheduler.start();

		// Lease should be gone
		expect(store.getLease(task.id)).toBeNull();
		const updatedRun = store.getRun(run.id);
		expect(updatedRun!.status).toBe("FAILED");

		await scheduler.stop();
	});

	it("should trigger due tasks during tick()", async () => {
		const task = store.createTask({
			name: "due-task",
			goal: "Execute when due",
			schedule: { type: "interval", seconds: 30 },
			enabled: true,
		});

		// Set nextRunAt in the past to make it immediately due
		store.updateTaskNextRun(task.id, new Date(Date.now() - 1000).toISOString());

		const executedTasks: string[] = [];
		const mockRuntime = {
			executeTask: vi.fn().mockImplementation(async (taskId: string) => {
				executedTasks.push(taskId);
				return {
					runId: "mock-run-1",
					taskId,
					status: "SUCCEEDED",
					durationMs: 50,
					inputTokens: 0,
					outputTokens: 0,
					toolCalls: 0,
				} as ExecutionResult;
			}),
			close: vi.fn(),
		} as unknown as TaskRuntime;

		const scheduler = new TaskScheduler({
			dbPath,
			pollIntervalMs: 50,
			runtime: mockRuntime,
		});

		await scheduler.start();
		await scheduler.tick();

		expect(executedTasks).toContain(task.id);
		expect(mockRuntime.executeTask).toHaveBeenCalledWith(task.id);

		// Check that nextRunAt was advanced
		const updatedTask = store.getTask(task.id);
		const newNextRun = new Date(updatedTask!.nextRunAt!);
		expect(newNextRun.getTime()).toBeGreaterThan(Date.now());

		await scheduler.stop();
	});

	it("should disable 'once' tasks after execution", async () => {
		const task = store.createTask({
			name: "once-task",
			goal: "Run once and disable",
			schedule: { type: "once", at: new Date(Date.now() - 1000).toISOString() },
			enabled: true,
		});
		store.updateTaskNextRun(task.id, new Date(Date.now() - 1000).toISOString());

		const mockRuntime = {
			executeTask: vi.fn().mockResolvedValue({
				runId: "once-run",
				taskId: task.id,
				status: "SUCCEEDED",
				durationMs: 10,
				inputTokens: 0,
				outputTokens: 0,
				toolCalls: 0,
			} as ExecutionResult),
			close: vi.fn(),
		} as unknown as TaskRuntime;

		const scheduler = new TaskScheduler({
			dbPath,
			pollIntervalMs: 50,
			runtime: mockRuntime,
		});

		await scheduler.start();
		await scheduler.tick();

		const updatedTask = store.getTask(task.id);
		expect(updatedTask!.enabled).toBe(false);
		expect(updatedTask!.nextRunAt).toBeUndefined();

		await scheduler.stop();
	});

	it("should schedule retry when task fails with retry policy", async () => {
		const task = store.createTask({
			name: "retry-task",
			goal: "Fail and retry",
			schedule: { type: "interval", seconds: 60 },
			retryPolicy: { maxRetries: 2, delaySeconds: 5, strategy: "fixed" },
			enabled: true,
		});
		store.updateTaskNextRun(task.id, new Date(Date.now() - 1000).toISOString());

		const mockRuntime = {
			executeTask: vi.fn().mockImplementation(async (taskId: string) => {
				const run = store.createRun(taskId);
				store.updateRunStatus(run.id, "ENABLED");
				store.updateRunStatus(run.id, "DUE");
				store.updateRunStatus(run.id, "ACQUIRING");
				store.updateRunStatus(run.id, "RUNNING");
				store.updateRunStatus(run.id, "FAILED", { error: "Network error" });
				return {
					runId: run.id,
					taskId,
					status: "FAILED",
					error: "Network error",
					durationMs: 20,
					inputTokens: 0,
					outputTokens: 0,
					toolCalls: 0,
				} as ExecutionResult;
			}),
			close: vi.fn(),
		} as unknown as TaskRuntime;

		const scheduler = new TaskScheduler({
			dbPath,
			pollIntervalMs: 50,
			runtime: mockRuntime,
		});

		await scheduler.start();
		await scheduler.tick();

		// Allow microtasks to complete
		await new Promise((r) => setTimeout(r, 50));

		const events = store.listEvents(task.id);
		expect(events.some((e) => e.eventType === "run_retrying")).toBe(true);

		await scheduler.stop();
	});

	it("should automatically schedule and trigger tasks created dynamically while scheduler is running", async () => {
		const executedTasks: string[] = [];
		const mockRuntime = {
			executeTask: vi.fn().mockImplementation(async (taskId: string) => {
				executedTasks.push(taskId);
				return {
					runId: `run-${taskId}`,
					taskId,
					status: "SUCCEEDED",
					durationMs: 10,
					inputTokens: 0,
					outputTokens: 0,
					toolCalls: 0,
				} as ExecutionResult;
			}),
			close: vi.fn(),
		} as unknown as TaskRuntime;

		const scheduler = new TaskScheduler({
			dbPath,
			pollIntervalMs: 50,
			runtime: mockRuntime,
		});

		await scheduler.start();

		// Create a task dynamically AFTER scheduler has already started
		const dynamicTask = store.createTask({
			name: "dynamic-task",
			goal: "Execute dynamically created task",
			schedule: { type: "interval", seconds: 1 },
			enabled: true,
		});

		// Task created with schedule should have nextRunAt populated
		expect(dynamicTask.nextRunAt).toBeDefined();

		// Make it immediately due
		store.updateTaskNextRun(dynamicTask.id, new Date(Date.now() - 100).toISOString());

		await scheduler.tick();
		await new Promise((r) => setTimeout(r, 50));

		expect(executedTasks).toContain(dynamicTask.id);
		await scheduler.stop();
	});
});
