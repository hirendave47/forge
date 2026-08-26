/**
 * Unit tests for Task Model — factories, parsing, and validation.
 */

import { describe, expect, it } from "vitest";
import {
	DEFAULT_RETRY_POLICY,
	generateLeaseId,
	generateRunId,
	generateTaskId,
	parseIntervalString,
	parseTaskConfig,
	type TaskConfigYAML,
} from "../src/runtime/task-model.ts";

describe("Task Model", () => {
	describe("UUID generation", () => {
		it("should generate unique task IDs", () => {
			const id1 = generateTaskId();
			const id2 = generateTaskId();
			expect(id1).not.toBe(id2);
			expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		});

		it("should generate unique run IDs", () => {
			const id1 = generateRunId();
			const id2 = generateRunId();
			expect(id1).not.toBe(id2);
		});

		it("should generate unique lease IDs", () => {
			const id1 = generateLeaseId();
			const id2 = generateLeaseId();
			expect(id1).not.toBe(id2);
		});
	});

	describe("parseIntervalString", () => {
		it("should parse seconds", () => {
			expect(parseIntervalString("30s")).toBe(30);
			expect(parseIntervalString("30sec")).toBe(30);
			expect(parseIntervalString("30seconds")).toBe(30);
		});

		it("should parse minutes", () => {
			expect(parseIntervalString("5m")).toBe(300);
			expect(parseIntervalString("5min")).toBe(300);
			expect(parseIntervalString("5minutes")).toBe(300);
		});

		it("should parse hours", () => {
			expect(parseIntervalString("1h")).toBe(3600);
			expect(parseIntervalString("2hours")).toBe(7200);
		});

		it("should default to seconds for plain numbers", () => {
			expect(parseIntervalString("60")).toBe(60);
		});

		it("should handle decimal values", () => {
			expect(parseIntervalString("1.5m")).toBe(90);
		});

		it("should throw for invalid format", () => {
			expect(() => parseIntervalString("abc")).toThrow();
			expect(() => parseIntervalString("")).toThrow();
		});
	});

	describe("parseTaskConfig", () => {
		it("should parse minimal YAML config", () => {
			const config: TaskConfigYAML = {
				name: "test-task",
				goal: "Do something useful",
			};
			const input = parseTaskConfig(config);
			expect(input.name).toBe("test-task");
			expect(input.goal).toBe("Do something useful");
			expect(input.schedule).toBeUndefined();
		});

		it("should parse interval schedule", () => {
			const config: TaskConfigYAML = {
				name: "monitor",
				goal: "Monitor things",
				schedule: { type: "interval", seconds: 30 },
			};
			const input = parseTaskConfig(config);
			expect(input.schedule).toEqual({ type: "interval", seconds: 30 });
		});

		it("should parse cron schedule", () => {
			const config: TaskConfigYAML = {
				name: "hourly-check",
				goal: "Check every hour",
				schedule: { type: "cron", expression: "0 * * * *" },
			};
			const input = parseTaskConfig(config);
			expect(input.schedule).toEqual({ type: "cron", expression: "0 * * * *" });
		});

		it("should parse full config with all fields", () => {
			const config: TaskConfigYAML = {
				name: "nginx-500-monitor",
				goal: "Monitor nginx for 500 errors",
				enabled: true,
				profile: "sysadmin",
				schedule: { type: "interval", seconds: 30 },
				execution: {
					overlap: "skip",
					timeout: 120,
					retries: 2,
					retry_delay_seconds: 30,
					retry_strategy: "exponential",
				},
				skills: ["linux-log-analysis", "nginx-troubleshooting"],
				tools: {
					allow: ["bash", "read", "grep"],
				},
				model_tier: "fast",
				policy: { mode: "autonomous" },
				notifications: {
					email: { to: ["admin@example.com"] },
				},
			};

			const input = parseTaskConfig(config);
			expect(input.name).toBe("nginx-500-monitor");
			expect(input.profile).toBe("sysadmin");
			expect(input.schedule).toEqual({ type: "interval", seconds: 30 });
			expect(input.overlapPolicy).toBe("skip");
			expect(input.timeoutSeconds).toBe(120);
			expect(input.retryPolicy?.maxRetries).toBe(2);
			expect(input.retryPolicy?.strategy).toBe("exponential");
			expect(input.skills).toEqual(["linux-log-analysis", "nginx-troubleshooting"]);
			expect(input.toolsAllow).toEqual(["bash", "read", "grep"]);
			expect(input.modelTier).toBe("fast");
			expect(input.policyMode).toBe("autonomous");
			expect(input.notifications?.email?.to).toEqual(["admin@example.com"]);
		});
	});

	describe("DEFAULT_RETRY_POLICY", () => {
		it("should have sensible defaults", () => {
			expect(DEFAULT_RETRY_POLICY.maxRetries).toBe(0);
			expect(DEFAULT_RETRY_POLICY.delaySeconds).toBe(30);
			expect(DEFAULT_RETRY_POLICY.strategy).toBe("fixed");
		});
	});
});
