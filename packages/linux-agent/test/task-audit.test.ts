/**
 * Unit and Integration Tests for Task Auditing, Forensic Step Logs & Export (§8, §14).
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAuditCommand } from "../src/cli/audit-command.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DIR = join(import.meta.dirname ?? ".", ".test-audit-db");

describe("Task Auditing and Forensic Step Logs", () => {
	let store: TaskStore;
	let dbPath: string;

	beforeEach(() => {
		if (!existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true });
		}
		dbPath = join(TEST_DIR, `test-${Date.now()}.db`);
		store = new TaskStore(dbPath);
	});

	afterEach(() => {
		store.close();
		try {
			rmSync(TEST_DIR, { recursive: true, force: true });
		} catch {}
	});

	it("should create run with host and execution context metadata", () => {
		const task = store.createTask({
			name: "audit-metadata-task",
			goal: "Check audit logging",
			elevated: true,
			modelTier: "reasoning",
		});

		const run = store.createRun(task.id, "RUNNING", {
			triggerType: "manual",
			hostUser: "kvmadmin",
			hostName: "qforge-dr",
			elevated: true,
			modelUsed: "gemini-3.7-flash",
		});

		expect(run).toBeDefined();
		expect(run.taskId).toBe(task.id);
		expect(run.triggerType).toBe("manual");
		expect(run.hostUser).toBe("kvmadmin");
		expect(run.hostName).toBe("qforge-dr");
		expect(run.elevated).toBe(true);
		expect(run.modelUsed).toBe("gemini-3.7-flash");

		const fetched = store.getRun(run.id);
		expect(fetched?.triggerType).toBe("manual");
		expect(fetched?.hostUser).toBe("kvmadmin");
		expect(fetched?.elevated).toBe(true);
	});

	it("should record and list granular tool execution steps", () => {
		const task = store.createTask({
			name: "step-log-task",
			goal: "Diagnose nginx",
		});

		const run = store.createRun(task.id, "RUNNING");

		// Record Step 1: systemctl status
		store.recordStepLog({
			taskId: task.id,
			runId: run.id,
			stepIndex: 1,
			toolName: "bash",
			toolArgs: { command: "systemctl status nginx" },
			toolResult: "● nginx.service - Active (running)",
			isError: false,
			durationMs: 45,
			timestamp: new Date().toISOString(),
		});

		// Record Step 2: read log
		store.recordStepLog({
			taskId: task.id,
			runId: run.id,
			stepIndex: 2,
			toolName: "read",
			toolArgs: { path: "/var/log/nginx/error.log" },
			toolResult: "2026/08/27 12:00:00 [error] 100#0: upstream timed out",
			isError: false,
			durationMs: 12,
			timestamp: new Date().toISOString(),
		});

		// Record Step 3: failed tool call
		store.recordStepLog({
			taskId: task.id,
			runId: run.id,
			stepIndex: 3,
			toolName: "bash",
			toolArgs: { command: "reboot" },
			toolResult: "Command blocked by policy engine (DESTRUCTIVE)",
			isError: true,
			durationMs: 2,
			timestamp: new Date().toISOString(),
		});

		const steps = store.listStepLogs(run.id);
		expect(steps.length).toBe(3);
		expect(steps[0].stepIndex).toBe(1);
		expect(steps[0].toolName).toBe("bash");
		expect(steps[0].toolArgs).toEqual({ command: "systemctl status nginx" });
		expect(steps[0].toolResult).toContain("Active (running)");
		expect(steps[0].isError).toBe(false);
		expect(steps[0].durationMs).toBe(45);

		expect(steps[1].stepIndex).toBe(2);
		expect(steps[1].toolName).toBe("read");

		expect(steps[2].stepIndex).toBe(3);
		expect(steps[2].isError).toBe(true);

		const taskSteps = store.listTaskStepLogs(task.id);
		expect(taskSteps.length).toBe(3);
	});

	it("should handle audit command invocation for tasks and runs without throwing", async () => {
		const originalEnv = process.env.FORGE_TASK_DB;
		process.env.FORGE_TASK_DB = dbPath;

		try {
			const task = store.createTask({
				name: "cli-audit-task",
				goal: "Audit CLI test",
			});
			const run = store.createRun(task.id, "SUCCEEDED", {
				triggerType: "schedule",
				hostUser: "root",
				hostName: "qforge-prod",
			});

			store.recordStepLog({
				taskId: task.id,
				runId: run.id,
				stepIndex: 1,
				toolName: "bash",
				toolArgs: { command: "df -h" },
				toolResult: "Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 50G 20G 30G 40% /",
				isError: false,
				durationMs: 15,
				timestamp: new Date().toISOString(),
			});

			// Test help
			await expect(handleAuditCommand(["--help"])).resolves.not.toThrow();

			// Test task overview
			await expect(handleAuditCommand(["cli-audit-task"])).resolves.not.toThrow();

			// Test run show
			await expect(handleAuditCommand(["show", run.id])).resolves.not.toThrow();

			// Test export markdown to file
			const exportFile = join(TEST_DIR, "audit-export.md");
			await expect(
				handleAuditCommand(["export", "cli-audit-task", "--format", "md", "--out", exportFile]),
			).resolves.not.toThrow();

			expect(existsSync(exportFile)).toBe(true);
			const content = readFileSync(exportFile, "utf-8");
			expect(content).toContain('# Audit Report: Task "cli-audit-task"');
			expect(content).toContain("df -h");
			expect(content).toContain("Step 1: `bash`");
		} finally {
			process.env.FORGE_TASK_DB = originalEnv;
		}
	});

	it("should support JSON and JSONL audit export formats", async () => {
		const originalEnv = process.env.FORGE_TASK_DB;
		process.env.FORGE_TASK_DB = dbPath;

		try {
			const task = store.createTask({
				name: "export-format-task",
				goal: "Test export formats",
			});
			const run = store.createRun(task.id, "SUCCEEDED");
			store.recordStepLog({
				taskId: task.id,
				runId: run.id,
				stepIndex: 1,
				toolName: "bash",
				toolArgs: { command: "free -m" },
				toolResult: "Mem: 16000 8000 8000",
				isError: false,
				durationMs: 10,
				timestamp: new Date().toISOString(),
			});

			// Test JSON export to file
			const jsonFile = join(TEST_DIR, "audit.json");
			await handleAuditCommand(["export", run.id, "--format", "json", "--out", jsonFile]);
			expect(existsSync(jsonFile)).toBe(true);
			const jsonContent = JSON.parse(readFileSync(jsonFile, "utf-8"));
			expect(jsonContent.run.id).toBe(run.id);
			expect(jsonContent.steps.length).toBe(1);
			expect(jsonContent.steps[0].toolName).toBe("bash");

			// Test JSONL export to file
			const jsonlFile = join(TEST_DIR, "audit.jsonl");
			await handleAuditCommand(["export", task.name, "--format", "jsonl", "--out", jsonlFile]);
			expect(existsSync(jsonlFile)).toBe(true);
			const lines = readFileSync(jsonlFile, "utf-8").trim().split("\n");
			expect(lines.length).toBe(1);
			const parsed = JSON.parse(lines[0]);
			expect(parsed.task.name).toBe("export-format-task");
		} finally {
			process.env.FORGE_TASK_DB = originalEnv;
		}
	});
});
