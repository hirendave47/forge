/**
 * Task Scheduler for Forge Linux Agent.
 *
 * A long-running internal daemon scheduler supervised by systemd.
 * Dispatches due tasks, prevents overlapping executions, manages retries,
 * and recovers stale leases after restarts.
 *
 * Responsibilities (§7):
 * - "WHEN should a task execute?" (Timing, next_run calculation, missed-run handling)
 * - Invokes TaskRuntime for "WHAT should the task do?"
 */

import type { Task } from "../runtime/task-model.ts";
import { type ExecutionResult, TaskRuntime } from "../runtime/task-runtime.ts";
import { getDefaultTaskDbPath, TaskStore } from "../store/task-store.ts";
import { computeNextRun } from "./cron.ts";

export interface TaskSchedulerOptions {
	/** Path to SQLite task database */
	dbPath?: string;
	/** Working directory for task execution */
	cwd?: string;
	/** Poll interval in milliseconds (default: 1000ms) */
	pollIntervalMs?: number;
	/** Runtime instance or auto-created */
	runtime?: TaskRuntime;
	/** Custom logger */
	logger?: (level: "info" | "warn" | "error" | "debug", message: string) => void;
}

export class TaskScheduler {
	private readonly store: TaskStore;
	private readonly runtime: TaskRuntime;
	private readonly pollIntervalMs: number;
	private readonly logger: (level: "info" | "warn" | "error" | "debug", message: string) => void;
	private timer: NodeJS.Timeout | null = null;
	private isRunning = false;
	private isTicking = false;
	private readonly inFlightTasks = new Map<string, Promise<ExecutionResult>>();

	constructor(options: TaskSchedulerOptions = {}) {
		const dbPath = options.dbPath ?? getDefaultTaskDbPath();
		this.store = new TaskStore(dbPath);
		this.runtime = options.runtime ?? new TaskRuntime({ dbPath, cwd: options.cwd });
		this.pollIntervalMs = options.pollIntervalMs ?? 1000;
		this.logger =
			options.logger ??
			((level, msg) => {
				const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
				if (level === "error") {
					console.error(`[${ts}] [ERROR] [scheduler] ${msg}`);
				} else if (level === "warn") {
					console.warn(`[${ts}] [WARN]  [scheduler] ${msg}`);
				} else {
					console.log(`[${ts}] [INFO]  [scheduler] ${msg}`);
				}
			});
	}

	/**
	 * Start the scheduler loop and recover any leftover stale leases.
	 */
	async start(): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;

		this.logger("info", "Starting Task Scheduler daemon...");

		// 1. Recover stale leases from prior crashed instances (§28)
		const recovered = this.store.recoverStaleLeases();
		if (recovered.length > 0) {
			this.logger("warn", `Recovered ${recovered.length} stale lease(s) on startup: ${recovered.join(", ")}`);
		}

		// 2. Initialize next_run_at for enabled scheduled tasks if missing
		this.initTaskSchedules();

		// 3. Start polling loop
		this.scheduleNextTick();
		this.logger("info", `Scheduler started. Polling every ${this.pollIntervalMs}ms.`);
	}

	/**
	 * Stop the scheduler gracefully, allowing in-flight runs to finish up to timeoutMs.
	 */
	async stop(timeoutMs = 15000): Promise<void> {
		if (!this.isRunning) return;
		this.isRunning = false;

		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		this.logger("info", "Stopping Task Scheduler...");

		// Wait for currently running tasks to finish
		if (this.inFlightTasks.size > 0) {
			this.logger("info", `Waiting for ${this.inFlightTasks.size} active task execution(s) to finish...`);
			const inflightPromises = Array.from(this.inFlightTasks.values());

			const waitPromise = Promise.allSettled(inflightPromises);
			const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeoutMs));

			await Promise.race([waitPromise, timeoutPromise]);
		}

		this.store.close();
		this.runtime.close();
		this.logger("info", "Task Scheduler stopped.");
	}

	/**
	 * Inspect and execute all currently due tasks.
	 */
	async tick(): Promise<void> {
		if (this.isTicking || !this.isRunning) return;
		this.isTicking = true;

		try {
			const tasks = this.store.listTasks();
			const now = new Date();

			for (const task of tasks) {
				if (!task.enabled || !task.schedule) {
					continue;
				}

				// If nextRunAt is missing (e.g. created while daemon was running), initialize it
				if (!task.nextRunAt) {
					const next = computeNextRun(task.schedule, now);
					const nextIso = next ? next.toISOString() : null;
					this.store.updateTaskNextRun(task.id, nextIso);
					task.nextRunAt = nextIso ?? undefined;
					if (nextIso) {
						this.logger("debug", `Initialized schedule for "${task.name}": next run at ${nextIso}`);
					}
				}

				if (!task.nextRunAt) {
					continue;
				}

				const nextRun = new Date(task.nextRunAt);
				if (nextRun <= now) {
					this.dispatchTask(task);
				}
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger("error", `Error during scheduler tick: ${msg}`);
		} finally {
			this.isTicking = false;
		}
	}

	/**
	 * Dispatch a single task run and advance its next_run_at timestamp.
	 */
	private dispatchTask(task: Task): void {
		const now = new Date();
		this.logger("info", `Triggering task: "${task.name}" (${task.id.slice(0, 8)})`);

		// Advance next_run_at immediately to avoid re-triggering in next tick
		this.advanceSchedule(task, now);

		// Record trigger event in audit log
		this.store.recordEvent(task.id, undefined, "triggered", {
			schedule: task.schedule,
			scheduledFor: task.nextRunAt,
			triggeredAt: now.toISOString(),
		});

		// Execute task asynchronously
		const executionPromise = this.runtime
			.executeTask(task.id)
			.then((result) => {
				this.handleTaskResult(task, result);
				return result;
			})
			.catch((err) => {
				const errorMsg = err instanceof Error ? err.message : String(err);
				this.logger("error", `Unexpected execution error for task "${task.name}": ${errorMsg}`);
				return {
					runId: "error",
					taskId: task.id,
					status: "FAILED" as const,
					error: errorMsg,
					durationMs: 0,
					inputTokens: 0,
					outputTokens: 0,
					toolCalls: 0,
				};
			})
			.finally(() => {
				this.inFlightTasks.delete(task.id);
			});

		this.inFlightTasks.set(task.id, executionPromise);
	}

	/**
	 * Handle task completion, retry policies, and logging.
	 */
	private handleTaskResult(task: Task, result: ExecutionResult): void {
		if (result.status === "SUCCEEDED") {
			this.logger(
				"info",
				`Task "${task.name}" completed successfully in ${(result.durationMs / 1000).toFixed(1)}s.`,
			);
		} else if (result.status === "SKIPPED") {
			this.logger("warn", `Task "${task.name}" skipped (already running / lease held).`);
		} else {
			this.logger("error", `Task "${task.name}" failed: ${result.error || result.status}`);

			// Check retry policy (§25)
			if (task.retryPolicy && task.retryPolicy.maxRetries > 0) {
				const recentRuns = this.store.listRuns(task.id, task.retryPolicy.maxRetries + 1);
				const consecutiveFailures = recentRuns.filter(
					(r) => r.status === "FAILED" || r.status === "TIMED_OUT",
				).length;

				if (consecutiveFailures <= task.retryPolicy.maxRetries) {
					const delaySeconds =
						task.retryPolicy.strategy === "exponential"
							? task.retryPolicy.delaySeconds * 2 ** (consecutiveFailures - 1)
							: task.retryPolicy.delaySeconds;

					const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
					this.store.updateTaskNextRun(task.id, retryAt);
					this.store.recordEvent(task.id, result.runId, "run_retrying", {
						attempt: consecutiveFailures,
						maxRetries: task.retryPolicy.maxRetries,
						retryAt,
						delaySeconds,
					});
					this.logger(
						"warn",
						`Task "${task.name}" scheduled for retry in ${delaySeconds}s (attempt ${consecutiveFailures}/${task.retryPolicy.maxRetries}).`,
					);
				}
			}
		}
	}

	/**
	 * Advance next_run_at timestamp based on task schedule.
	 */
	private advanceSchedule(task: Task, fromTime: Date = new Date()): void {
		if (!task.schedule) {
			this.store.updateTaskNextRun(task.id, null);
			return;
		}

		if (task.schedule.type === "once") {
			// One-time tasks are marked completed & disabled after trigger
			this.store.updateTaskNextRun(task.id, null);
			this.store.updateTaskEnabled(task.id, false);
			return;
		}

		try {
			const next = computeNextRun(task.schedule, fromTime);
			this.store.updateTaskNextRun(task.id, next ? next.toISOString() : null);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.logger("error", `Failed to compute next run for task "${task.name}": ${msg}`);
			this.store.updateTaskNextRun(task.id, null);
		}
	}

	/**
	 * Compute initial next_run_at for enabled tasks on startup if not already scheduled.
	 * Preserves existing past nextRunAt timestamps for missed-run execution.
	 */
	private initTaskSchedules(): void {
		const tasks = this.store.listTasks();
		const now = new Date();

		for (const task of tasks) {
			if (!task.enabled || !task.schedule) continue;

			if (!task.nextRunAt) {
				const next = computeNextRun(task.schedule, now);
				this.store.updateTaskNextRun(task.id, next ? next.toISOString() : null);
				if (next) {
					this.logger("debug", `Initialized schedule for "${task.name}": next run at ${next.toISOString()}`);
				}
			}
		}
	}

	private scheduleNextTick(): void {
		if (!this.isRunning) return;
		this.timer = setTimeout(async () => {
			await this.tick();
			this.scheduleNextTick();
		}, this.pollIntervalMs);
	}

	/**
	 * Get the underlying TaskStore.
	 */
	getStore(): TaskStore {
		return this.store;
	}

	/**
	 * Get the underlying TaskRuntime.
	 */
	getRuntime(): TaskRuntime {
		return this.runtime;
	}
}
