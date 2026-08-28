/**
 * Comprehensive Unit and Integration Tests for Forge AI Task Architect.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseArchitectJson, runTaskArchitect } from "../src/cli/task-architect/architect.ts";
import { executeDiscoveryRequests } from "../src/cli/task-architect/discovery-planner.ts";
import { generateHeuristicPlan } from "../src/cli/task-architect/prompts.ts";
import type { TaskPlan } from "../src/cli/task-architect/schemas.ts";
import {
	createDesignSession,
	formatSessionContext,
	recordAnswer,
	recordDiscovery,
	recordRecommendation,
} from "../src/cli/task-architect/session.ts";
import { taskPlanToCreateTaskInput, validateTaskPlan } from "../src/cli/task-architect/validator.ts";
import type { HostInfo } from "../src/cli/wizard/host-inspector.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB = ".test-architect-db/tasks.db";

function feedInputs(stream: PassThrough, lines: string[], startDelay = 15, step = 20): void {
	let delay = startDelay;
	for (const line of lines) {
		setTimeout(() => {
			stream.write(`${line}\n`);
		}, delay);
		delay += step;
	}
}

const mockHostInfo: HostInfo = {
	osName: "Linux",
	osVersion: "24.04",
	kernel: "6.8.0",
	activeServices: ["postgresql.service", "nginx.service", "sshd.service"],
	highUsageDisks: [
		{
			filesystem: "/dev/sda1",
			mountPoint: "/",
			total: "50G",
			used: "35G",
			available: "15G",
			usePercentage: 70,
		},
	],
	discoveredLogFiles: ["/var/log/syslog", "/var/log/nginx/error.log"],
	listeningPorts: [22, 80, 5432],
};

describe("Task Architect — Protocol JSON Parser", () => {
	it("should parse clean JSON action", () => {
		const json = JSON.stringify({
			type: "question",
			question: {
				id: "q1",
				question: "How often should health be checked?",
				type: "single_select",
				options: [{ label: "Every 1m", value: "1m" }],
				required: true,
			},
		});

		const result = parseArchitectJson(json);
		expect(result).toBeDefined();
		expect(result?.type).toBe("question");
	});

	it("should parse JSON wrapped in markdown codeblocks", () => {
		const raw = `Here is my architecture proposal:
\`\`\`json
{
  "type": "recommendation",
  "message": "Use hybrid execution",
  "recommendation": {
    "executionStrategy": "hybrid",
    "scheduler": "forge_sqlite",
    "reason": "Fast checks"
  }
}
\`\`\`
Let me know if you agree.`;

		const result = parseArchitectJson(raw);
		expect(result).toBeDefined();
		expect(result?.type).toBe("recommendation");
	});

	it("should parse JSON embedded in commentary without fences", () => {
		const raw = `Thinking process...
{"type":"inspect","reason":"Check postgres","checks":[{"checkType":"service","target":"postgresql"}]}
End of thought.`;

		const result = parseArchitectJson(raw);
		expect(result).toBeDefined();
		expect(result?.type).toBe("inspect");
	});

	it("should return null on invalid JSON", () => {
		expect(parseArchitectJson("Not valid json")).toBeNull();
		expect(parseArchitectJson("{ incomplete json")).toBeNull();
	});
});

describe("Task Architect — Session State Management", () => {
	it("should create session and format context correctly", () => {
		const session = createDesignSession("Monitor PostgreSQL and restart on failure", mockHostInfo);
		expect(session.sessionId).toBeDefined();
		expect(session.goal).toBe("Monitor PostgreSQL and restart on failure");
		expect(session.status).toBe("collecting");

		recordAnswer(session, "remed_mode", "How should failures be handled?", "restart");
		expect(session.answers).toHaveLength(1);

		recordDiscovery(session, {
			check: { checkType: "service", target: "postgresql" },
			found: true,
			summary: "Service postgresql is active",
		});
		expect(session.discoveries).toHaveLength(1);

		recordRecommendation(session, {
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			reason: "Low token usage",
		});
		expect(session.recommendations).toHaveLength(1);
		expect(session.executionStrategy).toBe("hybrid");

		const contextStr = formatSessionContext(session);
		expect(contextStr).toContain('Operational Goal: "Monitor PostgreSQL and restart on failure"');
		expect(contextStr).toContain("postgresql.service");
		expect(contextStr).toContain("How should failures be handled?: restart");
		expect(contextStr).toContain("Service postgresql is active");
		expect(contextStr).toContain("Strategy: hybrid");
	});
});

describe("Task Architect — Discovery Planner", () => {
	it("should execute safe discovery requests and sanitize targets", () => {
		const requests = [
			{ checkType: "disk" as const, target: "/" },
			{ checkType: "command" as const, target: "node" },
			{ checkType: "port" as const, target: "80" },
			{ checkType: "service" as const, target: "nonexistent-test-service; rm -rf /" },
		];

		const results = executeDiscoveryRequests(requests);
		expect(results).toHaveLength(4);

		// Disk check for root should find disk info on linux
		expect(results[0].check.checkType).toBe("disk");

		// Command check for node should be found in test env
		expect(results[1].check.checkType).toBe("command");

		// Malicious service target should be sanitized safely without throwing
		expect(results[3].found).toBe(false);
	});
});

describe("Task Architect — Validator & Materializer", () => {
	it("should validate a well-formed TaskPlan", () => {
		const plan: TaskPlan = {
			name: "pg-watchdog",
			goal: "Monitor PostgreSQL health",
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			profile: "sre",
			schedule: {
				type: "interval",
				intervalSeconds: 30,
			},
			policyMode: "autonomous",
			elevated: true,
			timeoutSeconds: 120,
			retries: 2,
			retryDelaySeconds: 30,
			retryStrategy: "fixed",
			notifications: {
				email: { to: ["ops@example.com"] },
				webhook: { url: "https://example.com/webhook" },
			},
			verification: ["systemctl is-active postgresql"],
			explanation: {
				summary: "Hybrid PostgreSQL watchdog",
				whyStrategy: "Zero tokens unless errors occur",
				whyScheduler: "Leases and audit required",
			},
		};

		const res = validateTaskPlan(plan);
		expect(res.valid).toBe(true);
		expect(res.errors).toHaveLength(0);

		const taskInput = taskPlanToCreateTaskInput(plan, true);
		expect(taskInput.name).toBe("pg-watchdog");
		expect(taskInput.goal).toBe("Monitor PostgreSQL health");
		expect(taskInput.profile).toBe("sre");
		expect(taskInput.schedule).toEqual({ type: "interval", seconds: 30 });
		expect(taskInput.elevated).toBe(true);
		expect(taskInput.retryPolicy?.maxRetries).toBe(2);
		expect(taskInput.notifications?.email?.to).toEqual(["ops@example.com"]);
	});

	it("should catch validation errors in invalid plans", () => {
		const invalidPlan: TaskPlan = {
			name: "invalid name with spaces!",
			goal: "",
			executionStrategy: "invalid_strat" as any,
			scheduler: "invalid_sched" as any,
			schedule: {
				type: "cron",
				cronExpression: "not a valid cron",
			},
			policyMode: "invalid_policy" as any,
			timeoutSeconds: 2, // too small
			retries: 50, // too big
			notifications: {
				webhook: { url: "ftp://invalid-url" },
			},
			explanation: {
				summary: "",
				whyStrategy: "",
				whyScheduler: "",
			},
		};

		const res = validateTaskPlan(invalidPlan);
		expect(res.valid).toBe(false);
		expect(res.errors.length).toBeGreaterThanOrEqual(6);
	});
});

describe("Task Architect — Heuristic Generator", () => {
	it("should generate deterministic strategy for disk cleanup", () => {
		const plan = generateHeuristicPlan("Clean up old files from /tmp older than 7 days", mockHostInfo);
		expect(plan.executionStrategy).toBe("deterministic");
		expect(plan.profile).toBe("sysadmin");
		expect(plan.policyMode).toBe("supervised");
	});

	it("should generate ai_agent strategy for complex diagnosis", () => {
		const plan = generateHeuristicPlan("Investigate why nginx intermittently returns 502", mockHostInfo);
		expect(plan.executionStrategy).toBe("ai_agent");
		expect(plan.profile).toBe("sre");
	});

	it("should generate hybrid strategy for continuous monitoring", () => {
		const plan = generateHeuristicPlan("Monitor PostgreSQL servers", mockHostInfo);
		expect(plan.executionStrategy).toBe("hybrid");
		expect(plan.scheduler).toBe("forge_sqlite");
	});
});

describe("runTaskArchitect — Full Interactive Loop Integration", () => {
	beforeEach(() => {
		rmSync(".test-architect-db", { recursive: true, force: true });
		rmSync(".test-architect-yaml", { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(".test-architect-db", { recursive: true, force: true });
		rmSync(".test-architect-yaml", { recursive: true, force: true });
	});

	it("should run multi-turn interactive session with model and materialize task to SQLite", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		// Mock Model Runtime that simulates:
		// Turn 1: AI requests inspection of postgresql service & port 5432
		// Turn 2: AI asks operational follow-up question
		// Turn 3: AI produces finalized TaskPlan
		let callCount = 0;
		const mockModelRuntime = {
			completeSimple: async () => {
				callCount++;
				if (callCount === 1) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									type: "inspect",
									reason: "Checking if PostgreSQL service is installed",
									checks: [{ checkType: "service", target: "postgresql" }],
								}),
							},
						],
					};
				}
				if (callCount === 2) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									type: "question",
									question: {
										id: "failure_mode",
										question: "How should Forge respond if PostgreSQL is down?",
										type: "single_select",
										options: [
											{ label: "Restart immediately", value: "restart" },
											{ label: "Alert only", value: "alert" },
										],
										defaultValue: "restart",
										required: true,
									},
								}),
							},
						],
					};
				}
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								type: "task_plan",
								plan: {
									name: "postgres-health-watchdog",
									goal: "Monitor PostgreSQL and restart on failure",
									executionStrategy: "hybrid",
									scheduler: "forge_sqlite",
									profile: "sre",
									schedule: {
										type: "interval",
										intervalSeconds: 60,
										intervalHuman: "every 1m",
									},
									policyMode: "autonomous",
									elevated: true,
									timeoutSeconds: 120,
									retries: 1,
									explanation: {
										summary: "Hybrid PostgreSQL monitor",
										whyStrategy: "Deterministic probe with AI escalation",
										whyScheduler: "Forge scheduler",
										estimatedAiUsage: "Low",
									},
									confidence: 0.95,
								},
							}),
						},
					],
				};
			},
		};

		// Queue User Responses:
		// 1. Answer to question: "1" (Restart immediately)
		// 2. Action at review phase: "1" (Create and enable in Forge Task Store)
		feedInputs(input, ["1", "1"]);

		const result = await runTaskArchitect({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Keep PostgreSQL healthy and restart if failed",
			modelRuntime: mockModelRuntime,
			model: { id: "test-model", provider: "test" },
			autoStartDaemon: false,
			inspectHostContext: false,
		});

		expect(result).toBeDefined();
		expect(result?.name).toBe("postgres-health-watchdog");
		expect(result?.profile).toBe("sre");
		expect(result?.schedule).toEqual({ type: "interval", seconds: 60 });
		expect(result?.elevated).toBe(true);

		// Verify task was saved in SQLite TaskStore
		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("postgres-health-watchdog");
		store.close();

		expect(task).toBeDefined();
		expect(task?.name).toBe("postgres-health-watchdog");
		expect(task?.enabled).toBe(true);
	});

	it("should support exporting AI-designed task to YAML file", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const yamlPath = ".test-architect-yaml/ai-task.yaml";

		const mockModelRuntime = {
			completeSimple: async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							type: "task_plan",
							plan: {
								name: "ai-nginx-monitor",
								goal: "Audit nginx access errors",
								executionStrategy: "deterministic",
								scheduler: "systemd_timer",
								profile: "sysadmin",
								schedule: {
									type: "interval",
									intervalSeconds: 300,
									intervalHuman: "every 5m",
								},
								policyMode: "supervised",
								elevated: false,
								timeoutSeconds: 60,
								explanation: {
									summary: "Nginx error check",
									whyStrategy: "Deterministic script",
									whyScheduler: "systemd",
								},
							},
						}),
					},
				],
			}),
		};

		// Queue User Responses:
		// 1. Review action: "3" (Export YAML)
		// 2. YAML file path: yamlPath
		feedInputs(input, ["3", yamlPath]);

		const result = await runTaskArchitect({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Audit nginx access errors",
			modelRuntime: mockModelRuntime,
			model: { id: "test-model", provider: "test" },
			inspectHostContext: false,
		});

		expect(result).toBeDefined();
		expect(existsSync(yamlPath)).toBe(true);

		const parsedYaml = parse(readFileSync(yamlPath, "utf-8"));
		expect(parsedYaml.name).toBe("ai-nginx-monitor");
		expect(parsedYaml.architecture.strategy).toBe("deterministic");
		expect(parsedYaml.architecture.scheduler).toBe("systemd_timer");
		expect(parsedYaml.architecture.generated_by).toBe("forge-ai-architect");
	});

	it("should handle user cancellation gracefully", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		const mockModelRuntime = {
			completeSimple: async () => ({
				content: [
					{
						type: "text",
						text: JSON.stringify({
							type: "task_plan",
							plan: {
								name: "cancelled-task",
								goal: "Will be cancelled",
								executionStrategy: "hybrid",
								scheduler: "forge_sqlite",
								policyMode: "autonomous",
								explanation: { summary: "", whyStrategy: "", whyScheduler: "" },
							},
						}),
					},
				],
			}),
		};

		// Queue User Response:
		// 1. Review action: "4" (Cancel and discard)
		feedInputs(input, ["4"]);

		const result = await runTaskArchitect({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Will be cancelled",
			modelRuntime: mockModelRuntime,
			model: { id: "test-model", provider: "test" },
			inspectHostContext: false,
		});

		expect(result).toBeNull();
	});

	it("should fallback gracefully to heuristic design when model errors", async () => {
		const input = new PassThrough();
		const output = new PassThrough();

		const failingModelRuntime = {
			completeSimple: async () => {
				throw new Error("Model API unavailable");
			},
		};

		// Queue User Responses:
		// 1. Answer heuristic question: "1" (remediation preference)
		// 2. Action: "1" (Create and enable)
		feedInputs(input, ["1", "1"]);

		const result = await runTaskArchitect({
			input,
			output,
			dbPath: TEST_DB,
			initialGoal: "Check disk space every hour",
			modelRuntime: failingModelRuntime,
			model: { id: "test-model", provider: "test" },
			autoStartDaemon: false,
			inspectHostContext: false,
		});

		expect(result).toBeDefined();
		expect(result?.goal).toBe("Check disk space every hour");
		expect(result?.policyMode).toBe("supervised");
	});
});
