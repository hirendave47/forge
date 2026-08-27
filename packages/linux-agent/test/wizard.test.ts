/**
 * Unit and integration tests for PromptEngine and TaskWizard.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PromptEngine } from "../src/cli/wizard/prompt-engine.ts";
import { runTaskWizard } from "../src/cli/wizard/task-wizard.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB = ".test-wizard-db/tasks.db";

function feedInputs(stream: PassThrough, lines: string[], startDelay = 15, step = 20): void {
	let delay = startDelay;
	for (const line of lines) {
		setTimeout(() => {
			stream.write(`${line}\n`);
		}, delay);
		delay += step;
	}
}

describe("PromptEngine", () => {
	it("should return typed text and fallback to default", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const prompt = new PromptEngine({ input, output });

		feedInputs(input, [""]); // press enter to accept default
		const result = await prompt.promptText("Your name", { defaultVal: "default-name" });
		expect(result).toBe("default-name");
		prompt.close();
	});

	it("should validate input and retry on failure", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const prompt = new PromptEngine({ input, output });

		feedInputs(input, ["-5", "10"]); // first invalid, second valid
		const result = await prompt.promptText("Enter positive number", {
			validate: (val) => (Number(val) > 0 ? true : "Must be > 0"),
		});

		expect(result).toBe("10");
		prompt.close();
	});

	it("should select option by number and direct value", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const prompt = new PromptEngine({ input, output });

		const options = [
			{ label: "Option A", value: "a" },
			{ label: "Option B", value: "b" },
		];

		feedInputs(input, ["2"]);
		const res1 = await prompt.promptSelect("Choose", options, 0);
		expect(res1).toBe("b");

		feedInputs(input, [""]); // default index 0
		const res2 = await prompt.promptSelect("Choose", options, 0);
		expect(res2).toBe("a");
		prompt.close();
	});

	it("should handle yes/no confirmations", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const prompt = new PromptEngine({ input, output });

		feedInputs(input, ["y"]);
		expect(await prompt.promptConfirm("Confirm?", false)).toBe(true);

		feedInputs(input, [""]);
		expect(await prompt.promptConfirm("Confirm?", true)).toBe(true);

		feedInputs(input, ["n"]);
		expect(await prompt.promptConfirm("Confirm?", true)).toBe(false);
		prompt.close();
	});

	it("should prompt for numbers with range bounds", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const prompt = new PromptEngine({ input, output });

		feedInputs(input, ["7"]);
		expect(await prompt.promptNumber("Enter count", { defaultVal: 5, min: 1, max: 10 })).toBe(7);
		prompt.close();
	});
});

describe("runTaskWizard", () => {
	beforeEach(() => {
		rmSync(".test-wizard-db", { recursive: true, force: true });
		rmSync(".test-wizard-yaml", { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(".test-wizard-db", { recursive: true, force: true });
		rmSync(".test-wizard-yaml", { recursive: true, force: true });
	});

	it("should run wizard for interval task and save to SQLite store", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		// Queue answers:
		// 1. Goal: "Monitor nginx logs"
		// 2. Name: "nginx-log-mon"
		// 3. Profile: sysadmin (1)
		// 4. Schedule Type: Interval (1)
		// 5. Interval value: 30s
		// 6. Policy: autonomous (1)
		// 7. Advanced settings: No (n)
		// 8. Action: Save (1)
		feedInputs(input, ["Monitor nginx logs", "nginx-log-mon", "1", "1", "30s", "1", "n", "1"]);

		const result = await runTaskWizard({
			input,
			output,
			dbPath: TEST_DB,
			smart: false,
		});

		expect(result).toBeDefined();
		expect(result?.name).toBe("nginx-log-mon");
		expect(result?.goal).toBe("Monitor nginx logs");
		expect(result?.profile).toBe("sysadmin");
		expect(result?.schedule).toEqual({ type: "interval", seconds: 30 });
		expect(result?.policyMode).toBe("autonomous");

		// Verify persisted in SQLite store
		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("nginx-log-mon");
		store.close();

		expect(task).toBeDefined();
		expect(task?.name).toBe("nginx-log-mon");
		expect(task?.schedule).toEqual({ type: "interval", seconds: 30 });
	});

	it("should run wizard with smart question refinement and enrich goal", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		// Queue answers:
		// 1. Refine questions: Yes (y)
		// 2. Log path: 1 (/var/log/syslog)
		// 3. Error threshold: > 10 errors
		// 4. Context lines: Yes (y)
		// 5. Name: nginx-error-mon
		// 6. Profile: sysadmin (1)
		// 7. Schedule: interval (1) -> 30s
		// 8. Policy: autonomous (1)
		// 9. Advanced: No (n)
		// 10. Action: Save (1)
		feedInputs(input, ["y", "1", "> 10 errors in 1m", "y", "nginx-error-mon", "1", "1", "30s", "1", "n", "1"]);

		const result = await runTaskWizard({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Monitor nginx error logs",
		});

		expect(result).toBeDefined();
		expect(result?.name).toBe("nginx-error-mon");
		expect(result?.goal).toContain("Monitor nginx error logs");
		expect(result?.goal).toContain("Operational Specifications:");
		expect(result?.goal).toContain("> 10 errors in 1m");
	});

	it("should run wizard with cron schedule and advanced retry/notification settings", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		// Queue answers (initialGoal already provided):
		// 1. Name: "nightly-pg-backup"
		// 2. Profile: sre (2)
		// 3. Schedule Type: Cron (2)
		// 4. Cron expression: "0 2 * * *"
		// 5. Policy: autonomous (1)
		// 6. Advanced settings: Yes (y)
		// 7. Timeout: 300
		// 8. Overlap: queue (2)
		// 9. Retries: 2
		// 10. Retry delay: 45
		// 11. Retry strategy: exponential (2)
		// 12. Email: "alerts@example.com"
		// 13. Webhook: "https://hooks.slack.com/test"
		// 14. Action: Save (1)
		feedInputs(input, [
			"nightly-pg-backup",
			"2",
			"2",
			"0 2 * * *",
			"1",
			"y",
			"300",
			"2",
			"2",
			"45",
			"2",
			"alerts@example.com",
			"https://hooks.slack.com/test",
			"1",
		]);

		const result = await runTaskWizard({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Nightly backup of Postgres",
			smart: false,
		});

		expect(result).toBeDefined();
		expect(result?.name).toBe("nightly-pg-backup");
		expect(result?.schedule).toEqual({ type: "cron", expression: "0 2 * * *" });
		expect(result?.timeoutSeconds).toBe(300);
		expect(result?.overlapPolicy).toBe("queue");
		expect(result?.retryPolicy?.maxRetries).toBe(2);
		expect(result?.retryPolicy?.delaySeconds).toBe(45);
		expect(result?.retryPolicy?.strategy).toBe("exponential");
		expect(result?.notifications?.email?.to).toEqual(["alerts@example.com"]);
		expect(result?.notifications?.webhook?.url).toBe("https://hooks.slack.com/test");
	});

	it("should support exporting wizard configuration to YAML file", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const yamlPath = ".test-wizard-yaml/custom-task.yaml";
		const futureDate = new Date(Date.now() + 86400 * 1000).toISOString();

		// Queue answers:
		// 1. Name: sec-ports
		// 2. Profile: security (4)
		// 3. Schedule Type: Once (3)
		// 4. Once time: futureDate
		// 5. Policy: safe (3)
		// 6. Advanced settings: No (n)
		// 7. Action: Export YAML (2)
		// 8. Path: yamlPath
		feedInputs(input, ["sec-ports", "4", "3", futureDate, "3", "n", "2", yamlPath]);

		const result = await runTaskWizard({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Audit open network ports",
			smart: false,
		});

		expect(result).toBeDefined();
		expect(existsSync(yamlPath)).toBe(true);

		const parsedYaml = parse(readFileSync(yamlPath, "utf-8"));
		expect(parsedYaml.name).toBe("sec-ports");
		expect(parsedYaml.profile).toBe("security");
		expect(parsedYaml.policy.mode).toBe("safe");
		expect(parsedYaml.schedule.type).toBe("once");
	});

	it("should handle user cancellation gracefully", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		// Queue answers:
		// 1. Name: cancelled-task
		// 2. Profile: default (6)
		// 3. Schedule: manual (4)
		// 4. Policy: autonomous (1)
		// 5. Advanced: No (n)
		// 6. Action: Cancel (3)
		feedInputs(input, ["cancelled-task", "6", "4", "1", "n", "3"]);

		const result = await runTaskWizard({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Cancelled task",
			smart: false,
		});

		expect(result).toBeNull();
	});
});
