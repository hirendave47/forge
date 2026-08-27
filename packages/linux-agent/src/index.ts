/**
 * Forge Linux Agent — Task scheduler, execution pipeline, and autonomous operations.
 *
 * This package extends Forge with production-grade support for:
 * - One-time AI tasks (forge run)
 * - Persistent scheduled tasks (forge task)
 * - Autonomous monitoring
 * - Task UUIDs and execution UUIDs
 * - Concurrency prevention (lease system)
 * - Durable task state (SQLite)
 * - Checkpoints, retries, and timeouts
 * - Agent profiles (sysadmin, devops, sre, etc.)
 * - Execution policies and verification
 * - Audit history and crash recovery
 */

// CLI
export { handleRunCommand } from "./cli/run-command.ts";
export { calculateTimeline, explainSchedule, formatTimelineTable, handleExplain } from "./cli/schedule-explainer.ts";
export { handleTaskCommand } from "./cli/task-command.ts";
export { handleTest, testTask } from "./cli/task-tester.ts";
export * from "./cli/wizard/index.ts";
// Integrations & MCP (§19, §20)
export * from "./integrations/mcp-client.ts";
export * from "./integrations/mcp-loader.ts";
// Policy Engine (§22)
export * from "./policy/policy-engine.ts";
// Processors
export * from "./processors/index.ts";
// Profiles (§15)
export * from "./profiles/index.ts";
export * from "./runtime/crash-recovery.ts";
export * from "./runtime/model-router.ts";
// State machine
export {
	ACTIVE_RUN_STATES,
	assertValidTransition,
	getPostRunState,
	getValidNextStates,
	InvalidStateTransitionError,
	isActiveRunState,
	isTerminalRunState,
	isValidTransition,
	TERMINAL_RUN_STATES,
} from "./runtime/state-machine.ts";
export type {
	CreateTaskInput,
	EventType,
	ModelTier,
	NotificationConfig,
	OverlapPolicy,
	PolicyMode,
	RetryPolicy,
	Task,
	TaskCheckpoint,
	TaskConfigYAML,
	TaskEvent,
	TaskRun,
	TaskSchedule,
	TaskState,
} from "./runtime/task-model.ts";
// Models
export {
	DEFAULT_OVERLAP_POLICY,
	DEFAULT_POLICY_MODE,
	DEFAULT_RETRY_POLICY,
	DEFAULT_TIMEOUT_SECONDS,
	EVENT_TYPES,
	generateLeaseId,
	generateRunId,
	generateTaskId,
	parseIntervalString,
	parseTaskConfig,
	TASK_STATES,
} from "./runtime/task-model.ts";
export type { ExecutionResult, ProgressEvent, TaskRuntimeOptions } from "./runtime/task-runtime.ts";
// Runtime
export { EXIT_CODES, getExitCode, TaskRuntime } from "./runtime/task-runtime.ts";
// Optimization & Tool/Model Selection (§17, §33)
export * from "./runtime/tool-selector.ts";
export { computeNextCronRun, computeNextRun, parseCronField } from "./scheduler/cron.ts";
export { startDaemon } from "./scheduler/daemon.ts";
export type { TaskSchedulerOptions } from "./scheduler/scheduler.ts";
// Scheduler
export { TaskScheduler } from "./scheduler/scheduler.ts";
export { SCHEMA_VERSION } from "./store/schema.ts";
// Store
export { getDefaultTaskDbPath, TaskStore } from "./store/task-store.ts";
// Systemd & Crash Recovery (§28, §29)
export * from "./systemd/installer.ts";
// Templates
export * from "./templates/index.ts";
// Verification Engine (§24)
export * from "./verification/verification-engine.ts";
