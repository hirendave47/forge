/**
 * Task and Run model types for the Forge Linux Agent.
 *
 * Every persistent task has a stable UUID. Every execution gets a unique run UUID.
 * Task UUID survives restarts, reboots, and upgrades.
 */

import { randomUUID } from "node:crypto";

// ============================================================
// Task State Machine states (§6)
// ============================================================

export const TASK_STATES = [
	"CREATED",
	"ENABLED",
	"DISABLED",
	"DUE",
	"ACQUIRING",
	"RUNNING",
	"VERIFYING",
	"SUCCEEDED",
	"FAILED",
	"RETRY_WAIT",
	"CANCEL_REQUESTED",
	"CANCELLED",
	"SKIPPED",
	"TIMED_OUT",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

// ============================================================
// Schedule types
// ============================================================

export interface IntervalSchedule {
	type: "interval";
	seconds: number;
}

export interface CronSchedule {
	type: "cron";
	expression: string;
}

export interface OnceSchedule {
	type: "once";
	at: string; // ISO 8601 datetime
}

export type TaskSchedule = IntervalSchedule | CronSchedule | OnceSchedule;

// ============================================================
// Overlap policy
// ============================================================

export type OverlapPolicy = "skip" | "queue";

// ============================================================
// Retry policy
// ============================================================

export interface RetryPolicy {
	maxRetries: number;
	delaySeconds: number;
	strategy: "fixed" | "exponential";
}

// ============================================================
// Policy mode (§22)
// ============================================================

export type PolicyMode = "safe" | "supervised" | "autonomous";

// ============================================================
// Model tier (§33)
// ============================================================

export type ModelTier = "fast" | "default" | "reasoning" | "coding";

// ============================================================
// Notification config
// ============================================================

export interface NotificationConfig {
	email?: {
		to: string[];
		from?: string;
	};
	webhook?: {
		url: string;
	};
}

// ============================================================
// Task definition
// ============================================================

export interface Task {
	id: string;
	name: string;
	goal: string;
	profile?: string;
	schedule?: TaskSchedule;
	enabled: boolean;
	overlapPolicy: OverlapPolicy;
	timeoutSeconds: number;
	retryPolicy: RetryPolicy;
	policyMode: PolicyMode;
	toolsAllow?: string[];
	toolsDeny?: string[];
	skills?: string[];
	modelTier?: ModelTier;
	elevated?: boolean;
	notifications?: NotificationConfig;
	createdAt: string;
	updatedAt: string;
	nextRunAt?: string;
	lastRunAt?: string;
	lastSuccessAt?: string;
}

// ============================================================
// Task run
// ============================================================

export interface TaskRun {
	id: string;
	taskId: string;
	sessionId?: string;
	triggerType?: "schedule" | "manual" | "retry" | "test" | "oneshot";
	hostUser?: string;
	hostName?: string;
	elevated?: boolean;
	modelUsed?: string;
	transcriptPath?: string;
	startedAt: string;
	finishedAt?: string;
	status: TaskState;
	exitReason?: string;
	error?: string;
	resultSummary?: string;
	inputTokens: number;
	outputTokens: number;
	toolCalls: number;
	durationMs?: number;
	cpuPercent?: number;
	memoryMb?: number;
}

// ============================================================
// Task step log (Granular Tool Call Traces)
// ============================================================

export interface TaskStepLog {
	id?: number;
	taskId: string;
	runId: string;
	stepIndex: number;
	toolName: string;
	toolArgs?: Record<string, unknown> | string;
	toolResult?: string;
	isError?: boolean;
	durationMs?: number;
	policyDecision?: Record<string, unknown>;
	timestamp: string;
}

// ============================================================
// Task event types (§8)
// ============================================================

export const EVENT_TYPES = [
	"task_created",
	"task_enabled",
	"task_disabled",
	"task_updated",
	"triggered",
	"run_started",
	"run_skipped",
	"lease_acquired",
	"lease_released",
	"lease_expired",
	"processor_started",
	"processor_completed",
	"agent_started",
	"tool_started",
	"tool_completed",
	"verification_started",
	"verification_passed",
	"verification_failed",
	"notification_sent",
	"notification_failed",
	"checkpoint_committed",
	"run_completed",
	"run_failed",
	"run_timed_out",
	"run_cancelled",
	"run_retrying",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface TaskEvent {
	id?: number;
	taskId: string;
	runId?: string;
	eventType: EventType;
	timestamp: string;
	details?: Record<string, unknown>;
}

// ============================================================
// Task checkpoint (§11)
// ============================================================

export interface TaskCheckpoint {
	id?: number;
	taskId: string;
	checkpointKey: string;
	device?: string;
	inode?: string;
	byteOffset: number;
	lineOffset: number;
	lastHash?: string;
	updatedAt: string;
}

// ============================================================
// Task creation input (from CLI or YAML)
// ============================================================

export interface CreateTaskInput {
	name: string;
	goal: string;
	profile?: string;
	schedule?: TaskSchedule;
	enabled?: boolean;
	overlapPolicy?: OverlapPolicy;
	timeoutSeconds?: number;
	retryPolicy?: Partial<RetryPolicy>;
	policyMode?: PolicyMode;
	toolsAllow?: string[];
	toolsDeny?: string[];
	skills?: string[];
	modelTier?: ModelTier;
	elevated?: boolean;
	notifications?: NotificationConfig;
}

// ============================================================
// YAML task config (§9)
// ============================================================

export interface TaskConfigYAML {
	id?: string;
	name: string;
	enabled?: boolean;
	schedule?: {
		type: "interval" | "cron" | "once";
		seconds?: number;
		expression?: string;
		at?: string;
	};
	execution?: {
		overlap?: OverlapPolicy;
		timeout?: number;
		retries?: number;
		retry_delay_seconds?: number;
		retry_strategy?: "fixed" | "exponential";
		elevated?: boolean;
	};
	elevated?: boolean;
	profile?: string;
	goal: string;
	skills?: string[];
	tools?: {
		allow?: string[];
		deny?: string[];
	};
	model_tier?: ModelTier;
	policy?: {
		mode?: PolicyMode;
	};
	notifications?: {
		email?: {
			to: string[];
			from?: string;
		};
		webhook?: {
			url: string;
		};
	};
}

// ============================================================
// Factories
// ============================================================

export function generateTaskId(): string {
	return randomUUID();
}

export function generateRunId(): string {
	return randomUUID();
}

export function generateLeaseId(): string {
	return randomUUID();
}

/** Default retry policy */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxRetries: 0,
	delaySeconds: 30,
	strategy: "fixed",
};

/** Default timeout */
export const DEFAULT_TIMEOUT_SECONDS = 120;

/** Default overlap policy */
export const DEFAULT_OVERLAP_POLICY: OverlapPolicy = "skip";

/** Default policy mode */
export const DEFAULT_POLICY_MODE: PolicyMode = "autonomous";

/**
 * Parse a YAML task config into a CreateTaskInput.
 */
export function parseTaskConfig(config: TaskConfigYAML): CreateTaskInput {
	let schedule: TaskSchedule | undefined;
	if (config.schedule) {
		if (config.schedule.type === "interval" && config.schedule.seconds !== undefined) {
			schedule = { type: "interval", seconds: config.schedule.seconds };
		} else if (config.schedule.type === "cron" && config.schedule.expression !== undefined) {
			schedule = { type: "cron", expression: config.schedule.expression };
		} else if (config.schedule.type === "once" && config.schedule.at !== undefined) {
			schedule = { type: "once", at: config.schedule.at };
		}
	}

	return {
		name: config.name,
		goal: config.goal,
		profile: config.profile,
		schedule,
		enabled: config.enabled,
		overlapPolicy: config.execution?.overlap,
		timeoutSeconds: config.execution?.timeout,
		retryPolicy: config.execution
			? {
					maxRetries: config.execution.retries,
					delaySeconds: config.execution.retry_delay_seconds,
					strategy: config.execution.retry_strategy,
				}
			: undefined,
		policyMode: config.policy?.mode,
		toolsAllow: config.tools?.allow,
		toolsDeny: config.tools?.deny,
		skills: config.skills,
		modelTier: config.model_tier,
		elevated: config.elevated ?? config.execution?.elevated,
		notifications: config.notifications,
	};
}

/**
 * Parse an interval string like "30s", "5m", "1h" into seconds.
 */
export function parseIntervalString(value: string): number {
	const match = value.match(/^(\d+(?:\.\d+)?)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hour|hours)?$/i);
	if (!match) {
		throw new Error(`Invalid interval format: "${value}". Use formats like "30s", "5m", "1h", or plain seconds.`);
	}
	const num = Number.parseFloat(match[1]);
	const unit = (match[2] ?? "s").toLowerCase();

	if (unit.startsWith("h")) return num * 3600;
	if (unit.startsWith("m")) return num * 60;
	return num;
}
