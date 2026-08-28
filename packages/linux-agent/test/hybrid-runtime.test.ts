/**
 * Integration tests for Hybrid Fast-Path and Anomaly Escalation Runtime.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/forge-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskPlan } from "../src/cli/task-architect/schemas.ts";
import { writeTaskBundle } from "../src/cli/task-architect/script-generator.ts";
import { TaskRuntime } from "../src/runtime/task-runtime.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB = ".test-hybrid-runtime-db/tasks.db";

describe("Hybrid Fast-Path Execution Pipeline", () => {
	beforeEach(() => {
		rmSync(".test-hybrid-runtime-db", { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(".test-hybrid-runtime-db", { recursive: true, force: true });
	});

	it("should execute fast-path script with 0 tokens when probe succeeds", async () => {
		const store = new TaskStore(TEST_DB);
		const task = store.createTask({
			name: "hybrid-probe-success",
			goal: "Check local health status",
			schedule: { type: "interval", seconds: 60 },
			policyMode: "autonomous",
		});
		store.close();

		// Write task bundle with custom fast-path script that exits 0
		const plan: TaskPlan = {
			name: "hybrid-probe-success",
			goal: "Check local health status",
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			policyMode: "autonomous",
			fastPath: {
				type: "bash",
				content: '#!/usr/bin/env bash\necho "[OK] Fast probe healthy"\nexit 0\n',
			},
			explanation: { summary: "", whyStrategy: "Fast probe", whyScheduler: "" },
		};
		writeTaskBundle(plan);

		const runtime = new TaskRuntime({ dbPath: TEST_DB });
		const result = await runtime.executeTask(task.id, { triggerType: "manual" });
		runtime.close();

		expect(result.status).toBe("SUCCEEDED");
		expect(result.inputTokens).toBe(0);
		expect(result.outputTokens).toBe(0);
		expect(result.toolCalls).toBe(0);
		expect(result.resultSummary).toContain("[OK] Fast probe healthy");

		// Clean up generated bundle
		rmSync(join(getAgentDir(), "tasks", "hybrid-probe-success"), { recursive: true, force: true });
	});
});
