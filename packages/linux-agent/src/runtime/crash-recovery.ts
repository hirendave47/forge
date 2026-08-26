/**
 * Crash Recovery Module for Forge Linux Agent (§28).
 *
 * Recovers from process crashes, node reboots, and network failures.
 * Inspects orphaned runs, reclaims stale leases, records audit events,
 * and restores task state safely without duplicate execution.
 */

import type { TaskStore } from "../store/task-store.ts";

export interface RecoveryReport {
	staleLeasesRecovered: string[];
	orphanedRunsFixed: string[];
	tasksScheduledForRetry: string[];
	timestamp: string;
}

export function performCrashRecovery(store: TaskStore): RecoveryReport {
	const now = new Date().toISOString();
	const report: RecoveryReport = {
		staleLeasesRecovered: [],
		orphanedRunsFixed: [],
		tasksScheduledForRetry: [],
		timestamp: now,
	};

	// 1. Recover stale leases
	report.staleLeasesRecovered = store.recoverStaleLeases();

	// 2. Inspect all tasks for orphaned runs that have no active lease
	const tasks = store.listTasks();
	for (const task of tasks) {
		const activeRun = store.getActiveRun(task.id);
		const lease = store.getLease(task.id);

		// If a run is in an active state but no valid lease is held, mark it failed
		if (activeRun && (!lease || new Date(lease.expires_at) < new Date())) {
			store.updateRunStatus(activeRun.id, "FAILED", {
				exitReason: "recovered_after_crash",
				error: "Process terminated unexpectedly before completion",
				finishedAt: now,
			});

			store.recordEvent(task.id, activeRun.id, "run_failed", {
				reason: "recovered_after_crash",
				recoveredAt: now,
			});

			report.orphanedRunsFixed.push(activeRun.id);

			// 3. Evaluate retry policy if configured
			if (task.retryPolicy && task.retryPolicy.maxRetries > 0) {
				const recentRuns = store.listRuns(task.id, task.retryPolicy.maxRetries + 1);
				const failureCount = recentRuns.filter((r) => r.status === "FAILED" || r.status === "TIMED_OUT").length;

				if (failureCount <= task.retryPolicy.maxRetries) {
					const delay =
						task.retryPolicy.strategy === "exponential"
							? task.retryPolicy.delaySeconds * 2 ** (failureCount - 1)
							: task.retryPolicy.delaySeconds;

					const retryTime = new Date(Date.now() + delay * 1000).toISOString();
					store.updateTaskNextRun(task.id, retryTime);
					store.recordEvent(task.id, activeRun.id, "run_retrying", {
						attempt: failureCount,
						retryTime,
					});
					report.tasksScheduledForRetry.push(task.id);
				}
			}
		}
	}

	return report;
}
