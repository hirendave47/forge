/**
 * Unit tests for `forge task create` CLI command handler and option parsing.
 */

import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskCommand } from "../src/cli/task-command.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DB = ".test-cli-task-db/tasks.db";

describe("forge task create CLI Handler", () => {
	let originalExitCode: string | number | null | undefined;

	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = 0;
		rmSync(".test-cli-task-db", { recursive: true, force: true });
		process.env.FORGE_TASK_DB = TEST_DB;

		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		process.exitCode = originalExitCode;
		delete process.env.FORGE_TASK_DB;
		rmSync(".test-cli-task-db", { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("should create a task with basic interval schedule", async () => {
		await handleTaskCommand(["create", "--name", "mem-check", "--every", "5m", "Check memory usage"]);
		expect(process.exitCode).toBe(0);

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("mem-check");
		store.close();

		expect(task).toBeDefined();
		expect(task?.goal).toBe("Check memory usage");
		expect(task?.schedule).toEqual({ type: "interval", seconds: 300 });
		expect(task?.enabled).toBe(true);
	});

	it("should create a task with standard 5-part cron expression", async () => {
		await handleTaskCommand([
			"create",
			"--name",
			"hourly-db-vacuum",
			"--cron",
			"0 * * * *",
			"--profile",
			"sysadmin",
			"Run database vacuum",
		]);
		expect(process.exitCode).toBe(0);

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("hourly-db-vacuum");
		store.close();

		expect(task).toBeDefined();
		expect(task?.schedule).toEqual({ type: "cron", expression: "0 * * * *" });
		expect(task?.profile).toBe("sysadmin");
	});

	it("should create a one-time scheduled task with --at", async () => {
		const targetTime = "2026-08-30T15:00:00.000Z";
		await handleTaskCommand(["create", "--name", "cert-renewal", "--at", targetTime, "Renew SSL certificate"]);
		expect(process.exitCode).toBe(0);

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("cert-renewal");
		store.close();

		expect(task).toBeDefined();
		expect(task?.schedule).toEqual({ type: "once", at: targetTime });
	});

	it("should reject multiple conflicting schedule flags", async () => {
		await handleTaskCommand(["create", "--every", "5m", "--cron", "*/5 * * * *", "Conflicting task"]);
		expect(process.exitCode).toBe(3);
	});

	it("should reject invalid cron expressions", async () => {
		await handleTaskCommand(["create", "--name", "bad-cron", "--cron", "invalid-cron-expr", "Some goal"]);
		expect(process.exitCode).toBe(3);
	});

	it("should reject invalid ISO dates for --at", async () => {
		await handleTaskCommand(["create", "--name", "bad-at", "--at", "not-a-date", "Some goal"]);
		expect(process.exitCode).toBe(3);
	});

	it("should create a task with complete execution & retry policies", async () => {
		await handleTaskCommand([
			"create",
			"--name",
			"resilient-backup",
			"--every",
			"1h",
			"--timeout",
			"300",
			"--overlap",
			"queue",
			"--retries",
			"3",
			"--retry-delay",
			"60",
			"--retry-strategy",
			"exponential",
			"Backup files with retry",
		]);
		expect(process.exitCode).toBe(0);

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("resilient-backup");
		store.close();

		expect(task).toBeDefined();
		expect(task?.timeoutSeconds).toBe(300);
		expect(task?.overlapPolicy).toBe("queue");
		expect(task?.retryPolicy.maxRetries).toBe(3);
		expect(task?.retryPolicy.delaySeconds).toBe(60);
		expect(task?.retryPolicy.strategy).toBe("exponential");
	});

	it("should create a task with policy mode, model tier, tools, and skills", async () => {
		await handleTaskCommand([
			"create",
			"--name",
			"security-audit",
			"--profile",
			"security",
			"--policy",
			"safe",
			"--model-tier",
			"reasoning",
			"--tools",
			"read,grep",
			"--exclude-tools",
			"bash,edit",
			"--skills",
			"sec-audit,log-analysis",
			"Audit ssh config and open ports",
		]);
		expect(process.exitCode).toBe(0);

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("security-audit");
		store.close();

		expect(task).toBeDefined();
		expect(task?.profile).toBe("security");
		expect(task?.policyMode).toBe("safe");
		expect(task?.modelTier).toBe("reasoning");
		expect(task?.toolsAllow).toEqual(["read", "grep"]);
		expect(task?.toolsDeny).toEqual(["bash", "edit"]);
		expect(task?.skills).toEqual(["sec-audit", "log-analysis"]);
	});

	it("should create a task with email and webhook notifications", async () => {
		await handleTaskCommand([
			"create",
			"--name",
			"notify-task",
			"--every",
			"10m",
			"--notify-email",
			"admin@example.com,oncall@example.com",
			"--notify-webhook",
			"https://hooks.slack.com/services/T00/B00/X00",
			"Monitor critical API health",
		]);
		expect(process.exitCode).toBe(0);

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("notify-task");
		store.close();

		expect(task).toBeDefined();
		expect(task?.notifications?.email?.to).toEqual(["admin@example.com", "oncall@example.com"]);
		expect(task?.notifications?.webhook?.url).toBe("https://hooks.slack.com/services/T00/B00/X00");
	});

	it("should support creating a task in disabled state with --disabled", async () => {
		await handleTaskCommand(["create", "--name", "dormant-task", "--disabled", "Run only when manually triggered"]);
		expect(process.exitCode).toBe(0);

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("dormant-task");
		store.close();

		expect(task).toBeDefined();
		expect(task?.enabled).toBe(false);
	});

	it("should reject invalid enum values with exit code 3", async () => {
		await handleTaskCommand(["create", "--policy", "ultra-safe", "Invalid policy"]);
		expect(process.exitCode).toBe(3);

		process.exitCode = 0;
		await handleTaskCommand(["create", "--model-tier", "super-fast", "Invalid tier"]);
		expect(process.exitCode).toBe(3);

		process.exitCode = 0;
		await handleTaskCommand(["create", "--overlap", "replace", "Invalid overlap"]);
		expect(process.exitCode).toBe(3);

		process.exitCode = 0;
		await handleTaskCommand(["create", "--retry-strategy", "linear", "Invalid strategy"]);
		expect(process.exitCode).toBe(3);
	});

	it("should reject when goal is missing", async () => {
		await handleTaskCommand(["create", "--name", "no-goal"]);
		expect(process.exitCode).toBe(3);
	});

	it("should support status, cancel, pause, resume, show with long task names and truncated prefixes", async () => {
		await handleTaskCommand([
			"create",
			"--name",
			"qforge-dr-user-login-monitoring",
			"--every",
			"30s",
			"Monitor user logins",
		]);
		expect(process.exitCode).toBe(0);

		// Show with truncated name prefix
		await handleTaskCommand(["show", "qforge-dr-user-login-mon"]);
		expect(process.exitCode).toBe(0);

		// Status with truncated name prefix
		await handleTaskCommand(["status", "qforge-dr-user-login-mon"]);
		expect(process.exitCode).toBe(0);

		// Pause with truncated name prefix
		await handleTaskCommand(["pause", "qforge-dr-user-login-mon"]);
		expect(process.exitCode).toBe(0);

		let store = new TaskStore(TEST_DB);
		let task = store.getTaskByName("qforge-dr-user-login-monitoring");
		expect(task?.enabled).toBe(false);
		store.close();

		// Resume with truncated name prefix
		await handleTaskCommand(["resume", "qforge-dr-user-login-mon"]);
		expect(process.exitCode).toBe(0);

		store = new TaskStore(TEST_DB);
		task = store.getTaskByName("qforge-dr-user-login-monitoring");
		expect(task?.enabled).toBe(true);
		store.close();

		// Cancel with truncated name prefix
		await handleTaskCommand(["cancel", "qforge-dr-user-login-mon"]);
		expect(process.exitCode).toBe(0);

		store = new TaskStore(TEST_DB);
		task = store.getTaskByName("qforge-dr-user-login-monitoring");
		expect(task?.enabled).toBe(false);
		store.close();

		// List without throwing
		await handleTaskCommand(["list"]);
		expect(process.exitCode).toBe(0);
	});
});
