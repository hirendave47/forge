/**
 * SQLite-backed Task Store for the Forge Linux Agent.
 *
 * Provides CRUD operations for tasks, runs, events, checkpoints, and locks.
 * Uses node:sqlite DatabaseSync with WAL mode for concurrent read access.
 *
 * The database is the authoritative source of truth during execution (§9).
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertValidTransition } from "../runtime/state-machine.ts";
import {
	type CreateTaskInput,
	DEFAULT_OVERLAP_POLICY,
	DEFAULT_POLICY_MODE,
	DEFAULT_RETRY_POLICY,
	DEFAULT_TIMEOUT_SECONDS,
	type EventType,
	generateLeaseId,
	generateRunId,
	generateTaskId,
	type Task,
	type TaskCheckpoint,
	type TaskEvent,
	type TaskRun,
	type TaskState,
} from "../runtime/task-model.ts";
import { CREATE_TABLES_SQL, SCHEMA_VERSION } from "./schema.ts";

// ============================================================
// Database row types (snake_case from SQLite)
// ============================================================

interface TaskRow {
	id: string;
	name: string;
	goal: string;
	profile: string | null;
	schedule_type: string | null;
	schedule_value: string | null;
	enabled: number;
	overlap_policy: string;
	timeout_seconds: number;
	retry_max: number;
	retry_delay_seconds: number;
	retry_strategy: string;
	policy_mode: string;
	tools_allow: string | null;
	tools_deny: string | null;
	skills: string | null;
	model_tier: string | null;
	notifications: string | null;
	created_at: string;
	updated_at: string;
	next_run_at: string | null;
	last_run_at: string | null;
	last_success_at: string | null;
}

interface RunRow {
	id: string;
	task_id: string;
	session_id: string | null;
	started_at: string;
	finished_at: string | null;
	status: string;
	exit_reason: string | null;
	error: string | null;
	result_summary: string | null;
	input_tokens: number;
	output_tokens: number;
	tool_calls: number;
	duration_ms: number | null;
	cpu_percent: number | null;
	memory_mb: number | null;
}

interface EventRow {
	id: number;
	task_id: string;
	run_id: string | null;
	event_type: string;
	timestamp: string;
	details: string | null;
}

interface LockRow {
	task_id: string;
	run_id: string;
	lease_id: string;
	owner_id: string;
	acquired_at: string;
	expires_at: string;
	heartbeat_at: string;
}

interface CheckpointRow {
	id: number;
	task_id: string;
	checkpoint_key: string;
	device: string | null;
	inode: string | null;
	byte_offset: number;
	line_offset: number;
	last_hash: string | null;
	updated_at: string;
}

interface VersionRow {
	version: number;
}

// ============================================================
// Task Store
// ============================================================

export class TaskStore {
	private readonly db: DatabaseSync;

	constructor(dbPath: string) {
		const dir = dirname(dbPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		this.db = new DatabaseSync(dbPath);
		this.initialize();
	}

	private initialize(): void {
		// Check if schema exists
		try {
			const row = this.db.prepare("SELECT version FROM schema_version LIMIT 1").get() as VersionRow | undefined;
			if (row && row.version >= SCHEMA_VERSION) {
				return; // Schema is up to date
			}
		} catch {
			// Table doesn't exist yet — create schema
		}
		this.db.exec(CREATE_TABLES_SQL);
	}

	// ================================================================
	// Task CRUD
	// ================================================================

	createTask(input: CreateTaskInput): Task {
		const id = generateTaskId();
		const now = new Date().toISOString();
		const retryPolicy = {
			...DEFAULT_RETRY_POLICY,
			...input.retryPolicy,
		};

		const stmt = this.db.prepare(`
			INSERT INTO tasks (
				id, name, goal, profile, schedule_type, schedule_value,
				enabled, overlap_policy, timeout_seconds,
				retry_max, retry_delay_seconds, retry_strategy,
				policy_mode, tools_allow, tools_deny, skills,
				model_tier, notifications, created_at, updated_at
			) VALUES (
				?, ?, ?, ?, ?, ?,
				?, ?, ?,
				?, ?, ?,
				?, ?, ?, ?,
				?, ?, ?, ?
			)
		`);

		stmt.run(
			id,
			input.name,
			input.goal,
			input.profile ?? null,
			input.schedule?.type ?? null,
			input.schedule ? serializeScheduleValue(input.schedule) : null,
			(input.enabled ?? true) ? 1 : 0,
			input.overlapPolicy ?? DEFAULT_OVERLAP_POLICY,
			input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
			retryPolicy.maxRetries,
			retryPolicy.delaySeconds,
			retryPolicy.strategy,
			input.policyMode ?? DEFAULT_POLICY_MODE,
			input.toolsAllow ? JSON.stringify(input.toolsAllow) : null,
			input.toolsDeny ? JSON.stringify(input.toolsDeny) : null,
			input.skills ? JSON.stringify(input.skills) : null,
			input.modelTier ?? null,
			input.notifications ? JSON.stringify(input.notifications) : null,
			now,
			now,
		);

		this.recordEvent(id, undefined, "task_created", { name: input.name });

		return this.getTask(id)!;
	}

	getTask(id: string): Task | undefined {
		const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
		return row ? rowToTask(row) : undefined;
	}

	getTaskByName(name: string): Task | undefined {
		const row = this.db.prepare("SELECT * FROM tasks WHERE name = ?").get(name) as TaskRow | undefined;
		return row ? rowToTask(row) : undefined;
	}

	listTasks(): Task[] {
		const rows = this.db.prepare("SELECT * FROM tasks ORDER BY created_at DESC").all() as unknown as TaskRow[];
		return rows.map(rowToTask);
	}

	updateTaskEnabled(id: string, enabled: boolean): void {
		const now = new Date().toISOString();
		this.db.prepare("UPDATE tasks SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, now, id);
		this.recordEvent(id, undefined, enabled ? "task_enabled" : "task_disabled");
	}

	updateTaskNextRun(id: string, nextRunAt: string | null): void {
		const now = new Date().toISOString();
		this.db.prepare("UPDATE tasks SET next_run_at = ?, updated_at = ? WHERE id = ?").run(nextRunAt, now, id);
	}

	updateTaskLastRun(id: string, lastRunAt: string, succeeded: boolean): void {
		const now = new Date().toISOString();
		if (succeeded) {
			this.db
				.prepare("UPDATE tasks SET last_run_at = ?, last_success_at = ?, updated_at = ? WHERE id = ?")
				.run(lastRunAt, lastRunAt, now, id);
		} else {
			this.db.prepare("UPDATE tasks SET last_run_at = ?, updated_at = ? WHERE id = ?").run(lastRunAt, now, id);
		}
	}

	deleteTask(id: string): boolean {
		const result = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
		return result.changes > 0;
	}

	// ================================================================
	// Task Runs
	// ================================================================

	createRun(taskId: string, status: TaskState = "CREATED"): TaskRun {
		const id = generateRunId();
		const now = new Date().toISOString();

		this.db
			.prepare(
				`INSERT INTO task_runs (id, task_id, started_at, status)
			 VALUES (?, ?, ?, ?)`,
			)
			.run(id, taskId, now, status);

		return this.getRun(id)!;
	}

	getRun(id: string): TaskRun | undefined {
		const row = this.db.prepare("SELECT * FROM task_runs WHERE id = ?").get(id) as RunRow | undefined;
		return row ? rowToRun(row) : undefined;
	}

	listRuns(taskId: string, limit = 50): TaskRun[] {
		const rows = this.db
			.prepare("SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?")
			.all(taskId, limit) as unknown as RunRow[];
		return rows.map(rowToRun);
	}

	updateRunStatus(
		runId: string,
		status: TaskState,
		extras?: Partial<
			Pick<
				TaskRun,
				| "exitReason"
				| "error"
				| "resultSummary"
				| "finishedAt"
				| "durationMs"
				| "inputTokens"
				| "outputTokens"
				| "toolCalls"
			>
		>,
	): void {
		const run = this.getRun(runId);
		if (run) {
			assertValidTransition(run.status, status);
		}

		const sets: string[] = ["status = ?"];
		const values: unknown[] = [status];

		if (extras?.exitReason !== undefined) {
			sets.push("exit_reason = ?");
			values.push(extras.exitReason);
		}
		if (extras?.error !== undefined) {
			sets.push("error = ?");
			values.push(extras.error);
		}
		if (extras?.resultSummary !== undefined) {
			sets.push("result_summary = ?");
			values.push(extras.resultSummary);
		}
		if (extras?.finishedAt !== undefined) {
			sets.push("finished_at = ?");
			values.push(extras.finishedAt);
		}
		if (extras?.durationMs !== undefined) {
			sets.push("duration_ms = ?");
			values.push(extras.durationMs);
		}
		if (extras?.inputTokens !== undefined) {
			sets.push("input_tokens = ?");
			values.push(extras.inputTokens);
		}
		if (extras?.outputTokens !== undefined) {
			sets.push("output_tokens = ?");
			values.push(extras.outputTokens);
		}
		if (extras?.toolCalls !== undefined) {
			sets.push("tool_calls = ?");
			values.push(extras.toolCalls);
		}

		values.push(runId);
		this.db.prepare(`UPDATE task_runs SET ${sets.join(", ")} WHERE id = ?`).run(...(values as any[]));
	}

	getActiveRun(taskId: string): TaskRun | undefined {
		const row = this.db
			.prepare(
				"SELECT * FROM task_runs WHERE task_id = ? AND status IN ('CREATED', 'ACQUIRING', 'RUNNING', 'VERIFYING') ORDER BY started_at DESC LIMIT 1",
			)
			.get(taskId) as unknown as RunRow | undefined;
		return row ? rowToRun(row) : undefined;
	}

	// ================================================================
	// Lease/Lock management (§5)
	// ================================================================

	acquireLease(taskId: string, runId: string, ownerId: string, ttlSeconds: number): string | null {
		const leaseId = generateLeaseId();
		const now = new Date().toISOString();
		const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

		try {
			// Use INSERT OR IGNORE — if a lock already exists, no row is inserted
			const result = this.db
				.prepare(
					`INSERT OR IGNORE INTO task_locks (task_id, run_id, lease_id, owner_id, acquired_at, expires_at, heartbeat_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(taskId, runId, leaseId, ownerId, now, expiresAt, now);

			if (result.changes === 0) {
				// Lock already exists — check if it's stale
				const existing = this.getLease(taskId);
				if (existing && new Date(existing.expires_at) < new Date()) {
					// Stale lease — reclaim
					this.releaseLease(taskId);
					return this.acquireLease(taskId, runId, ownerId, ttlSeconds);
				}
				return null; // Lock held by active lease
			}

			this.recordEvent(taskId, runId, "lease_acquired", { leaseId, ownerId, ttlSeconds });
			return leaseId;
		} catch {
			return null;
		}
	}

	releaseLease(taskId: string): void {
		const existing = this.getLease(taskId);
		this.db.prepare("DELETE FROM task_locks WHERE task_id = ?").run(taskId);
		if (existing) {
			this.recordEvent(taskId, existing.run_id, "lease_released", { leaseId: existing.lease_id });
		}
	}

	renewLease(taskId: string, leaseId: string, ttlSeconds: number): boolean {
		const now = new Date().toISOString();
		const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
		const result = this.db
			.prepare("UPDATE task_locks SET heartbeat_at = ?, expires_at = ? WHERE task_id = ? AND lease_id = ?")
			.run(now, expiresAt, taskId, leaseId);
		return Number(result.changes) > 0;
	}

	getLease(taskId: string): LockRow | null {
		return (this.db.prepare("SELECT * FROM task_locks WHERE task_id = ?").get(taskId) as unknown as LockRow) ?? null;
	}

	/**
	 * Find and clean up stale leases — leases whose expires_at is in the past.
	 * Returns the list of task IDs that had stale leases recovered.
	 */
	recoverStaleLeases(): string[] {
		const now = new Date().toISOString();
		const stale = this.db.prepare("SELECT * FROM task_locks WHERE expires_at < ?").all(now) as unknown as LockRow[];

		const recovered: string[] = [];
		for (const lock of stale) {
			this.db.prepare("DELETE FROM task_locks WHERE task_id = ?").run(lock.task_id);
			this.recordEvent(lock.task_id, lock.run_id, "lease_expired", {
				leaseId: lock.lease_id,
				expiredAt: lock.expires_at,
			});

			// Mark the associated run as failed if still active
			const run = this.getRun(lock.run_id);
			if (run && !["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT", "SKIPPED"].includes(run.status)) {
				try {
					this.updateRunStatus(lock.run_id, "FAILED", {
						exitReason: "lease_expired",
						error: "Lease expired — process likely crashed",
						finishedAt: now,
					});
				} catch {
					// State transition may be invalid for some intermediate states — force it
					this.db
						.prepare("UPDATE task_runs SET status = ?, exit_reason = ?, error = ?, finished_at = ? WHERE id = ?")
						.run("FAILED", "lease_expired", "Lease expired — process likely crashed", now, lock.run_id);
				}
			}

			recovered.push(lock.task_id);
		}

		return recovered;
	}

	// ================================================================
	// Events (§8)
	// ================================================================

	recordEvent(
		taskId: string,
		runId: string | undefined,
		eventType: EventType,
		details?: Record<string, unknown>,
	): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO task_events (task_id, run_id, event_type, timestamp, details)
			 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(taskId, runId ?? null, eventType, now, details ? JSON.stringify(details) : null);
	}

	listEvents(taskId: string, limit = 100): TaskEvent[] {
		const rows = this.db
			.prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY timestamp DESC LIMIT ?")
			.all(taskId, limit) as unknown as EventRow[];
		return rows.map(rowToEvent);
	}

	listRunEvents(runId: string): TaskEvent[] {
		const rows = this.db
			.prepare("SELECT * FROM task_events WHERE run_id = ? ORDER BY timestamp ASC")
			.all(runId) as unknown as EventRow[];
		return rows.map(rowToEvent);
	}

	// ================================================================
	// Checkpoints (§11)
	// ================================================================

	getCheckpoint(taskId: string, key: string): TaskCheckpoint | undefined {
		const row = this.db
			.prepare("SELECT * FROM task_checkpoints WHERE task_id = ? AND checkpoint_key = ?")
			.get(taskId, key) as unknown as CheckpointRow | undefined;
		return row ? rowToCheckpoint(row) : undefined;
	}

	upsertCheckpoint(checkpoint: Omit<TaskCheckpoint, "id" | "updatedAt">): void {
		const now = new Date().toISOString();
		this.db
			.prepare(
				`INSERT INTO task_checkpoints (task_id, checkpoint_key, device, inode, byte_offset, line_offset, last_hash, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(task_id, checkpoint_key) DO UPDATE SET
				device = excluded.device,
				inode = excluded.inode,
				byte_offset = excluded.byte_offset,
				line_offset = excluded.line_offset,
				last_hash = excluded.last_hash,
				updated_at = excluded.updated_at`,
			)
			.run(
				checkpoint.taskId,
				checkpoint.checkpointKey,
				checkpoint.device ?? null,
				checkpoint.inode ?? null,
				checkpoint.byteOffset,
				checkpoint.lineOffset,
				checkpoint.lastHash ?? null,
				now,
			);
	}

	// ================================================================
	// Cleanup
	// ================================================================

	/**
	 * Remove completed runs older than the specified number of days.
	 */
	cleanupOldRuns(olderThanDays: number): number {
		const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
		const result = this.db
			.prepare(
				"DELETE FROM task_runs WHERE finished_at IS NOT NULL AND finished_at < ? AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED', 'TIMED_OUT')",
			)
			.run(cutoff);
		return Number(result.changes);
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		this.db.close();
	}
}

// ============================================================
// Row → Model converters
// ============================================================

function rowToTask(row: TaskRow): Task {
	return {
		id: row.id,
		name: row.name,
		goal: row.goal,
		profile: row.profile ?? undefined,
		schedule: deserializeSchedule(row.schedule_type, row.schedule_value),
		enabled: row.enabled === 1,
		overlapPolicy: row.overlap_policy as Task["overlapPolicy"],
		timeoutSeconds: row.timeout_seconds,
		retryPolicy: {
			maxRetries: row.retry_max,
			delaySeconds: row.retry_delay_seconds,
			strategy: row.retry_strategy as "fixed" | "exponential",
		},
		policyMode: row.policy_mode as Task["policyMode"],
		toolsAllow: row.tools_allow ? JSON.parse(row.tools_allow) : undefined,
		toolsDeny: row.tools_deny ? JSON.parse(row.tools_deny) : undefined,
		skills: row.skills ? JSON.parse(row.skills) : undefined,
		modelTier: (row.model_tier as Task["modelTier"]) ?? undefined,
		notifications: row.notifications ? JSON.parse(row.notifications) : undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		nextRunAt: row.next_run_at ?? undefined,
		lastRunAt: row.last_run_at ?? undefined,
		lastSuccessAt: row.last_success_at ?? undefined,
	};
}

function rowToRun(row: RunRow): TaskRun {
	return {
		id: row.id,
		taskId: row.task_id,
		sessionId: row.session_id ?? undefined,
		startedAt: row.started_at,
		finishedAt: row.finished_at ?? undefined,
		status: row.status as TaskState,
		exitReason: row.exit_reason ?? undefined,
		error: row.error ?? undefined,
		resultSummary: row.result_summary ?? undefined,
		inputTokens: row.input_tokens,
		outputTokens: row.output_tokens,
		toolCalls: row.tool_calls,
		durationMs: row.duration_ms ?? undefined,
		cpuPercent: row.cpu_percent ?? undefined,
		memoryMb: row.memory_mb ?? undefined,
	};
}

function rowToEvent(row: EventRow): TaskEvent {
	return {
		id: row.id,
		taskId: row.task_id,
		runId: row.run_id ?? undefined,
		eventType: row.event_type as EventType,
		timestamp: row.timestamp,
		details: row.details ? JSON.parse(row.details) : undefined,
	};
}

function rowToCheckpoint(row: CheckpointRow): TaskCheckpoint {
	return {
		id: row.id,
		taskId: row.task_id,
		checkpointKey: row.checkpoint_key,
		device: row.device ?? undefined,
		inode: row.inode ?? undefined,
		byteOffset: row.byte_offset,
		lineOffset: row.line_offset,
		lastHash: row.last_hash ?? undefined,
		updatedAt: row.updated_at,
	};
}

// ============================================================
// Schedule serialization helpers
// ============================================================

function serializeScheduleValue(schedule: {
	type: string;
	seconds?: number;
	expression?: string;
	at?: string;
}): string {
	if (schedule.type === "interval") return String(schedule.seconds);
	if (schedule.type === "cron") return schedule.expression!;
	if (schedule.type === "once") return schedule.at!;
	return "";
}

function deserializeSchedule(type: string | null, value: string | null): Task["schedule"] {
	if (!type || !value) return undefined;
	if (type === "interval") return { type: "interval", seconds: Number(value) };
	if (type === "cron") return { type: "cron", expression: value };
	if (type === "once") return { type: "once", at: value };
	return undefined;
}

// ============================================================
// Default database path
// ============================================================

export function getDefaultTaskDbPath(): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return join(home, ".forge", "agent", "tasks.db");
}
