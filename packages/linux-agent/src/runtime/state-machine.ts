/**
 * Task State Machine — validates and enforces legal state transitions.
 *
 * All state transitions are explicit. Invalid transitions are rejected with
 * descriptive errors. This module is pure logic — it does not perform I/O.
 */

import type { TaskState } from "./task-model.ts";

/**
 * Legal state transitions map.
 * Key = current state, Value = set of allowed next states.
 */
const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
	CREATED: ["ENABLED", "DISABLED", "CANCELLED"],
	ENABLED: ["DISABLED", "DUE", "CANCEL_REQUESTED", "CANCELLED"],
	DISABLED: ["ENABLED", "CANCELLED"],
	DUE: ["ACQUIRING", "SKIPPED", "CANCEL_REQUESTED", "CANCELLED"],
	ACQUIRING: ["RUNNING", "SKIPPED", "FAILED", "CANCEL_REQUESTED"],
	RUNNING: ["VERIFYING", "SUCCEEDED", "FAILED", "TIMED_OUT", "CANCEL_REQUESTED"],
	VERIFYING: ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCEL_REQUESTED"],
	SUCCEEDED: ["ENABLED", "DISABLED", "CANCELLED"],
	FAILED: ["RETRY_WAIT", "ENABLED", "DISABLED", "CANCELLED"],
	RETRY_WAIT: ["DUE", "CANCEL_REQUESTED", "CANCELLED"],
	CANCEL_REQUESTED: ["CANCELLED", "FAILED"],
	CANCELLED: [],
	SKIPPED: ["ENABLED", "DUE"],
	TIMED_OUT: ["RETRY_WAIT", "ENABLED", "DISABLED", "CANCELLED"],
};

/**
 * Terminal states — a run in these states is considered complete.
 */
export const TERMINAL_RUN_STATES: ReadonlySet<TaskState> = new Set([
	"SUCCEEDED",
	"FAILED",
	"CANCELLED",
	"SKIPPED",
	"TIMED_OUT",
]);

/**
 * Active run states — a run in these states is actively executing.
 */
export const ACTIVE_RUN_STATES: ReadonlySet<TaskState> = new Set(["ACQUIRING", "RUNNING", "VERIFYING"]);

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: TaskState, to: TaskState): boolean {
	const allowed = TRANSITIONS[from];
	return allowed?.includes(to) ?? false;
}

/**
 * Validate a state transition and throw if invalid.
 */
export function assertValidTransition(from: TaskState, to: TaskState): void {
	if (!isValidTransition(from, to)) {
		const allowed = TRANSITIONS[from];
		const allowedStr = allowed && allowed.length > 0 ? allowed.join(", ") : "(none — terminal state)";
		throw new InvalidStateTransitionError(from, to, allowedStr);
	}
}

/**
 * Get all valid next states from a given state.
 */
export function getValidNextStates(state: TaskState): readonly TaskState[] {
	return TRANSITIONS[state] ?? [];
}

/**
 * Check if a state is a terminal run state.
 */
export function isTerminalRunState(state: TaskState): boolean {
	return TERMINAL_RUN_STATES.has(state);
}

/**
 * Check if a state is an active run state.
 */
export function isActiveRunState(state: TaskState): boolean {
	return ACTIVE_RUN_STATES.has(state);
}

/**
 * Determine the appropriate next state for a task after a run completes.
 * Scheduled tasks return to ENABLED; non-scheduled tasks stay in their terminal state.
 */
export function getPostRunState(terminalState: TaskState, hasSchedule: boolean): TaskState {
	if (!isTerminalRunState(terminalState)) {
		throw new Error(`getPostRunState called with non-terminal state: ${terminalState}`);
	}
	if (terminalState === "CANCELLED") return "CANCELLED";
	if (!hasSchedule) return terminalState;

	// Scheduled tasks return to ENABLED after terminal states
	if (terminalState === "SUCCEEDED" || terminalState === "SKIPPED") return "ENABLED";
	if (terminalState === "FAILED" || terminalState === "TIMED_OUT") return "ENABLED";
	return terminalState;
}

/**
 * Error thrown when an invalid state transition is attempted.
 */
export class InvalidStateTransitionError extends Error {
	readonly from: TaskState;
	readonly to: TaskState;

	constructor(from: TaskState, to: TaskState, allowedStr: string) {
		super(`Invalid state transition: ${from} → ${to}. Allowed transitions from ${from}: ${allowedStr}`);
		this.name = "InvalidStateTransitionError";
		this.from = from;
		this.to = to;
	}
}
