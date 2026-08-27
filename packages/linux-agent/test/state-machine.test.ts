/**
 * Unit tests for Task State Machine.
 */

import { describe, expect, it } from "vitest";
import {
	assertValidTransition,
	getPostRunState,
	getValidNextStates,
	InvalidStateTransitionError,
	isActiveRunState,
	isTerminalRunState,
	isValidTransition,
} from "../src/runtime/state-machine.ts";
import { TASK_STATES, type TaskState } from "../src/runtime/task-model.ts";

describe("State Machine", () => {
	describe("isValidTransition", () => {
		it("should allow CREATED → ENABLED", () => {
			expect(isValidTransition("CREATED", "ENABLED")).toBe(true);
		});

		it("should allow CREATED → DISABLED", () => {
			expect(isValidTransition("CREATED", "DISABLED")).toBe(true);
		});

		it("should allow ENABLED → DUE", () => {
			expect(isValidTransition("ENABLED", "DUE")).toBe(true);
		});

		it("should allow DUE → ACQUIRING", () => {
			expect(isValidTransition("DUE", "ACQUIRING")).toBe(true);
		});

		it("should allow ACQUIRING → RUNNING", () => {
			expect(isValidTransition("ACQUIRING", "RUNNING")).toBe(true);
		});

		it("should allow RUNNING → SUCCEEDED", () => {
			expect(isValidTransition("RUNNING", "SUCCEEDED")).toBe(true);
		});

		it("should allow RUNNING → FAILED", () => {
			expect(isValidTransition("RUNNING", "FAILED")).toBe(true);
		});

		it("should allow RUNNING → TIMED_OUT", () => {
			expect(isValidTransition("RUNNING", "TIMED_OUT")).toBe(true);
		});

		it("should allow RUNNING → VERIFYING", () => {
			expect(isValidTransition("RUNNING", "VERIFYING")).toBe(true);
		});

		it("should allow FAILED → RETRY_WAIT", () => {
			expect(isValidTransition("FAILED", "RETRY_WAIT")).toBe(true);
		});

		it("should allow RETRY_WAIT → DUE", () => {
			expect(isValidTransition("RETRY_WAIT", "DUE")).toBe(true);
		});

		it("should allow CREATED → ACQUIRING", () => {
			expect(isValidTransition("CREATED", "ACQUIRING")).toBe(true);
		});

		it("should allow CREATED → SKIPPED", () => {
			expect(isValidTransition("CREATED", "SKIPPED")).toBe(true);
		});

		it("should allow CREATED → RUNNING", () => {
			expect(isValidTransition("CREATED", "RUNNING")).toBe(true);
		});

		it("should reject CREATED → SUCCEEDED (must go through execution states)", () => {
			expect(isValidTransition("CREATED", "SUCCEEDED")).toBe(false);
		});

		it("should reject CANCELLED → anything (terminal state)", () => {
			for (const state of TASK_STATES) {
				expect(isValidTransition("CANCELLED", state)).toBe(false);
			}
		});

		it("should reject SUCCEEDED → RUNNING", () => {
			expect(isValidTransition("SUCCEEDED", "RUNNING")).toBe(false);
		});

		it("should allow DUE → SKIPPED", () => {
			expect(isValidTransition("DUE", "SKIPPED")).toBe(true);
		});
	});

	describe("assertValidTransition", () => {
		it("should not throw for valid transition", () => {
			expect(() => assertValidTransition("ENABLED", "DUE")).not.toThrow();
			expect(() => assertValidTransition("CREATED", "ACQUIRING")).not.toThrow();
		});

		it("should throw InvalidStateTransitionError for invalid transition", () => {
			expect(() => assertValidTransition("CREATED", "SUCCEEDED")).toThrow(InvalidStateTransitionError);
		});

		it("should include from and to in error", () => {
			try {
				assertValidTransition("CREATED", "SUCCEEDED");
			} catch (e) {
				const err = e as InvalidStateTransitionError;
				expect(err.from).toBe("CREATED");
				expect(err.to).toBe("SUCCEEDED");
			}
		});
	});

	describe("getValidNextStates", () => {
		it("should return allowed states for CREATED", () => {
			const next = getValidNextStates("CREATED");
			expect(next).toContain("ENABLED");
			expect(next).toContain("DISABLED");
			expect(next).toContain("ACQUIRING");
			expect(next).toContain("RUNNING");
			expect(next).toContain("SKIPPED");
			expect(next).toContain("CANCELLED");
			expect(next).not.toContain("SUCCEEDED");
		});

		it("should return empty for CANCELLED", () => {
			expect(getValidNextStates("CANCELLED")).toEqual([]);
		});
	});

	describe("isTerminalRunState", () => {
		it("should return true for SUCCEEDED", () => {
			expect(isTerminalRunState("SUCCEEDED")).toBe(true);
		});

		it("should return true for FAILED", () => {
			expect(isTerminalRunState("FAILED")).toBe(true);
		});

		it("should return true for CANCELLED", () => {
			expect(isTerminalRunState("CANCELLED")).toBe(true);
		});

		it("should return true for TIMED_OUT", () => {
			expect(isTerminalRunState("TIMED_OUT")).toBe(true);
		});

		it("should return false for RUNNING", () => {
			expect(isTerminalRunState("RUNNING")).toBe(false);
		});
	});

	describe("isActiveRunState", () => {
		it("should return true for RUNNING", () => {
			expect(isActiveRunState("RUNNING")).toBe(true);
		});

		it("should return true for ACQUIRING", () => {
			expect(isActiveRunState("ACQUIRING")).toBe(true);
		});

		it("should return true for VERIFYING", () => {
			expect(isActiveRunState("VERIFYING")).toBe(true);
		});

		it("should return false for SUCCEEDED", () => {
			expect(isActiveRunState("SUCCEEDED")).toBe(false);
		});
	});

	describe("getPostRunState", () => {
		it("should return ENABLED after SUCCEEDED for scheduled task", () => {
			expect(getPostRunState("SUCCEEDED", true)).toBe("ENABLED");
		});

		it("should return SUCCEEDED after SUCCEEDED for non-scheduled task", () => {
			expect(getPostRunState("SUCCEEDED", false)).toBe("SUCCEEDED");
		});

		it("should return ENABLED after FAILED for scheduled task", () => {
			expect(getPostRunState("FAILED", true)).toBe("ENABLED");
		});

		it("should return CANCELLED regardless of schedule", () => {
			expect(getPostRunState("CANCELLED", true)).toBe("CANCELLED");
			expect(getPostRunState("CANCELLED", false)).toBe("CANCELLED");
		});

		it("should throw for non-terminal state", () => {
			expect(() => getPostRunState("RUNNING" as TaskState, true)).toThrow();
		});
	});
});
