/**
 * Unit tests for AI and Heuristic Questioner & Goal Refiner.
 */

import { describe, expect, it } from "vitest";
import {
	buildEnrichedGoal,
	generateTaskQuestions,
	suggestProfileAndSchedule,
	type TaskQuestion,
} from "../src/cli/wizard/ai-questioner.ts";
import type { HostInfo } from "../src/cli/wizard/host-inspector.ts";

describe("AI Questioner & Goal Refiner", () => {
	const mockHost: HostInfo = {
		osName: "Linux",
		osVersion: "Ubuntu 24.04",
		kernel: "6.8.0",
		activeServices: ["nginx", "redis-server", "docker"],
		highUsageDisks: [
			{
				filesystem: "/dev/sda1",
				mountPoint: "/",
				total: "100G",
				used: "85G",
				available: "15G",
				usePercentage: 85,
			},
		],
		discoveredLogFiles: ["/var/log/nginx/error.log", "/var/log/syslog"],
		listeningPorts: [80, 6379],
	};

	describe("suggestProfileAndSchedule", () => {
		it("should recommend security profile for audit/security tasks", () => {
			const rec = suggestProfileAndSchedule("Audit open listening ports and ssh configs");
			expect(rec.recommendedProfile).toBe("security");
			expect(rec.recommendedScheduleType).toBe("interval");
		});

		it("should recommend sre and cron for database backup tasks", () => {
			const rec = suggestProfileAndSchedule("Nightly backup of postgres database");
			expect(rec.recommendedProfile).toBe("sre");
			expect(rec.recommendedScheduleType).toBe("cron");
			expect(rec.recommendedCron).toBe("0 2 * * *");
		});

		it("should recommend sysadmin and fast interval for log error monitoring", () => {
			const rec = suggestProfileAndSchedule("Monitor nginx error log for 500 status codes");
			expect(rec.recommendedProfile).toBe("sysadmin");
			expect(rec.recommendedScheduleType).toBe("interval");
			expect(rec.recommendedInterval).toBe("30s");
		});

		it("should recommend devops for docker container maintenance", () => {
			const rec = suggestProfileAndSchedule("Clean up old docker containers and dangling images");
			expect(rec.recommendedProfile).toBe("devops");
			expect(rec.recommendedScheduleType).toBe("interval");
		});
	});

	describe("generateTaskQuestions (Heuristic Generation)", () => {
		it("should generate log-specific follow-up questions including detected log files", async () => {
			const questions = await generateTaskQuestions("Monitor nginx error logs", mockHost);
			expect(questions.length).toBeGreaterThanOrEqual(2);

			const logPathQ = questions.find((q) => q.id === "logPath");
			expect(logPathQ).toBeDefined();
			expect(logPathQ?.type).toBe("select");
			expect(logPathQ?.options?.some((opt) => opt.value === "/var/log/nginx/error.log")).toBe(true);

			const errorThresholdQ = questions.find((q) => q.id === "errorThreshold");
			expect(errorThresholdQ).toBeDefined();
		});

		it("should generate disk-specific questions using detected high-usage mount point", async () => {
			const questions = await generateTaskQuestions("Check disk space and clean up if full", mockHost);
			expect(questions.length).toBeGreaterThanOrEqual(2);

			const thresholdQ = questions.find((q) => q.id === "diskThreshold");
			expect(thresholdQ).toBeDefined();
			expect(thresholdQ?.type).toBe("number");

			const mountQ = questions.find((q) => q.id === "targetMount");
			expect(mountQ).toBeDefined();
			expect(mountQ?.defaultVal).toBe("/");
		});

		it("should generate service reliability questions with active systemd services", async () => {
			const questions = await generateTaskQuestions("Supervise systemd service health", mockHost);
			expect(questions.length).toBeGreaterThanOrEqual(2);

			const svcQ = questions.find((q) => q.id === "targetService");
			expect(svcQ).toBeDefined();
			expect(svcQ?.options?.some((opt) => opt.value === "nginx")).toBe(true);
		});

		it("should generate docker-specific questions", async () => {
			const questions = await generateTaskQuestions("Inspect docker containers", mockHost);
			expect(questions.length).toBeGreaterThanOrEqual(2);

			const actionQ = questions.find((q) => q.id === "dockerAction");
			expect(actionQ).toBeDefined();
			expect(actionQ?.type).toBe("select");
		});
	});

	describe("generateTaskQuestions (AI Model Generation)", () => {
		it("should parse and return model-generated JSON questions when available", async () => {
			const mockModelRuntime = {
				getFastModel: () => ({ id: "mock-model" }),
				completeSimple: async () => ({
					content: [
						{
							type: "text",
							text: JSON.stringify([
								{
									id: "custom_threshold",
									question: "What error rate threshold should trigger an alert?",
									type: "text",
									defaultVal: "10 errors/min",
								},
								{
									id: "notify_slack",
									question: "Should notifications post to the SRE Slack channel?",
									type: "confirm",
									defaultVal: true,
								},
							]),
						},
					],
				}),
			};

			const questions = await generateTaskQuestions("Monitor redis latency", mockHost, {
				modelRuntime: mockModelRuntime,
			});

			expect(questions.length).toBe(2);
			expect(questions[0].id).toBe("custom_threshold");
			expect(questions[0].defaultVal).toBe("10 errors/min");
			expect(questions[1].id).toBe("notify_slack");
			expect(questions[1].type).toBe("confirm");
		});
	});

	describe("buildEnrichedGoal", () => {
		it("should augment base goal with user answers", () => {
			const questions: TaskQuestion[] = [
				{ id: "logPath", question: "Which log file should be monitored?", type: "text" },
				{ id: "errorThreshold", question: "What error threshold should trigger alert?", type: "text" },
				{ id: "autoRestart", question: "Attempt automatic restart if down?", type: "confirm" },
			];

			const answers = {
				logPath: "/var/log/nginx/error.log",
				errorThreshold: "> 5 errors in 5 min",
				autoRestart: true,
			};

			const enriched = buildEnrichedGoal("Monitor nginx errors", answers, questions);
			expect(enriched).toContain("Monitor nginx errors");
			expect(enriched).toContain("Operational Specifications:");
			expect(enriched).toContain("- Which log file should be monitored: /var/log/nginx/error.log");
			expect(enriched).toContain("- What error threshold should trigger alert: > 5 errors in 5 min");
			expect(enriched).toContain("- Attempt automatic restart if down: Yes");
		});

		it("should return unchanged goal if no answers provided", () => {
			const enriched = buildEnrichedGoal("Simple task goal", {}, []);
			expect(enriched).toBe("Simple task goal");
		});
	});
});
