/**
 * Unit and integration tests for Task Refinement (`forge task refine`).
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runTaskRefine } from "../src/cli/task-architect/refine.ts";
import type { TaskPlan } from "../src/cli/task-architect/schemas.ts";
import { writeTaskBundle } from "../src/cli/task-architect/script-generator.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB = ".test-refine-db/tasks.db";
const TEST_YAML = "tasks/refine-test-task.yaml";

function feedInputs(stream: PassThrough, lines: string[], startDelay = 15, step = 20): void {
	let delay = startDelay;
	for (const line of lines) {
		setTimeout(() => {
			stream.write(`${line}\n`);
		}, delay);
		delay += step;
	}
}

describe("Task Refine — Interactive Evolution Loop", () => {
	beforeEach(() => {
		rmSync(".test-refine-db", { recursive: true, force: true });
		rmSync(TEST_YAML, { force: true });
	});

	afterEach(() => {
		rmSync(".test-refine-db", { recursive: true, force: true });
		rmSync(TEST_YAML, { force: true });
	});

	it("should refine an existing task and update SQLite store", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		// 1. Create baseline task
		const store = new TaskStore(TEST_DB);
		const initialTask = store.createTask({
			name: "refine-test-task",
			goal: "Monitor disk space",
			schedule: { type: "interval", seconds: 60 },
			policyMode: "autonomous",
			profile: "sysadmin",
		});
		store.close();

		// Write initial bundle
		const initialPlan: TaskPlan = {
			name: "refine-test-task",
			goal: "Monitor disk space",
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			policyMode: "autonomous",
			profile: "sysadmin",
			schedule: { type: "interval", intervalSeconds: 60 },
			explanation: { summary: "", whyStrategy: "", whyScheduler: "" },
		};
		writeTaskBundle(initialPlan);

		// Mock Model Runtime for refinement
		const mockModelRuntime = {
			completeSimple: async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							type: "task_plan",
							plan: {
								name: "refine-test-task",
								goal: "Monitor root disk space and escalate if >90%",
								executionStrategy: "hybrid",
								scheduler: "forge_sqlite",
								policyMode: "supervised",
								profile: "sre",
								schedule: {
									type: "interval",
									intervalSeconds: 300,
									intervalHuman: "every 5m",
								},
								timeoutSeconds: 180,
								retries: 2,
								explanation: {
									summary: "Refined disk monitor with supervised policy",
									whyStrategy: "Fast probe with SRE AI escalation",
									whyScheduler: "SQLite scheduler",
								},
							},
						}),
					},
				],
			}),
		};

		// Queue User Responses:
		// 1. Refinement prompt: "Change schedule to 5m, policy to supervised, profile to sre"
		// 2. Action choice: "1" (Apply and save changes)
		feedInputs(input, ["Change schedule to 5m, policy to supervised, profile to sre", "1"]);

		const success = await runTaskRefine(initialTask.name, {
			input,
			output,
			dbPath: TEST_DB,
			modelRuntime: mockModelRuntime,
			model: { id: "test", provider: "test" },
		});

		expect(success).toBe(true);

		// Verify task was updated in SQLite
		const verifyStore = new TaskStore(TEST_DB);
		const updated = verifyStore.getTask(initialTask.id);
		verifyStore.close();

		expect(updated).toBeDefined();
		expect(updated?.goal).toContain("escalate if >90%");
		expect(updated?.profile).toBe("sre");
		expect(updated?.policyMode).toBe("supervised");
		expect(updated?.schedule).toEqual({ type: "interval", seconds: 300 });
		expect(updated?.timeoutSeconds).toBe(180);
	});

	it("should support exporting refined configuration to YAML", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		const store = new TaskStore(TEST_DB);
		const initialTask = store.createTask({
			name: "refine-test-task",
			goal: "Monitor memory usage",
			schedule: { type: "interval", seconds: 60 },
			policyMode: "autonomous",
		});
		store.close();

		const mockModelRuntime = {
			completeSimple: async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							type: "task_plan",
							plan: {
								name: "refine-test-task",
								goal: "Monitor RAM and alert on memory leak",
								executionStrategy: "deterministic",
								scheduler: "systemd_timer",
								policyMode: "safe",
								schedule: { type: "interval", intervalSeconds: 600 },
								explanation: { summary: "", whyStrategy: "", whyScheduler: "" },
							},
						}),
					},
				],
			}),
		};

		// Queue User Responses:
		// 1. Refinement prompt: "Switch to deterministic memory check"
		// 2. Action choice: "2" (Export YAML)
		feedInputs(input, ["Switch to deterministic memory check", "2"]);

		const success = await runTaskRefine(initialTask.name, {
			input,
			output,
			dbPath: TEST_DB,
			modelRuntime: mockModelRuntime,
			model: { id: "test", provider: "test" },
		});

		expect(success).toBe(true);
		expect(existsSync(TEST_YAML)).toBe(true);

		const parsed = parse(readFileSync(TEST_YAML, "utf-8"));
		expect(parsed.name).toBe("refine-test-task");
		expect(parsed.policy.mode).toBe("safe");
	});

	it("should handle cancellation without modifying the original task", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		const store = new TaskStore(TEST_DB);
		const initialTask = store.createTask({
			name: "refine-test-task",
			goal: "Original goal",
			schedule: { type: "interval", seconds: 60 },
			policyMode: "autonomous",
		});
		store.close();

		// Queue User Responses:
		// 1. Refinement prompt: "Some changes"
		// 2. Action choice: "3" (Discard changes)
		feedInputs(input, ["Some changes", "3"]);

		const success = await runTaskRefine(initialTask.name, {
			input,
			output,
			dbPath: TEST_DB,
			modelRuntime: {
				completeSimple: async () => ({
					content: [{ type: "text", text: "" }],
				}),
			},
			model: { id: "test", provider: "test" },
		});

		expect(success).toBe(false);

		const verifyStore = new TaskStore(TEST_DB);
		const unchanged = verifyStore.getTask(initialTask.id);
		verifyStore.close();

		expect(unchanged?.goal).toBe("Original goal");
		expect(unchanged?.policyMode).toBe("autonomous");
	});
});
