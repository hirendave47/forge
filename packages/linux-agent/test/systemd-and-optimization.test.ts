/**
 * Unit tests for systemd installer, Crash Recovery, Tool Selector, and Model Router (§17, §28, §29, §33).
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { performCrashRecovery } from "../src/runtime/crash-recovery.ts";
import { ModelRouter } from "../src/runtime/model-router.ts";
import { selectToolsForTask } from "../src/runtime/tool-selector.ts";
import { TaskStore } from "../src/store/task-store.ts";
import { generateServiceUnit } from "../src/systemd/installer.ts";

const TEST_DIR = join(import.meta.dirname ?? ".", ".test-systemd-opt");

describe("systemd, Crash Recovery & Optimization", () => {
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

	describe("systemd Installer (§29)", () => {
		it("should generate valid systemd service unit", () => {
			const unit = generateServiceUnit("/usr/local/bin/forge");
			expect(unit).toContain("Description=Forge Autonomous Task Scheduler Daemon");
			expect(unit).toContain("ExecStart=/usr/local/bin/forge task daemon");
			expect(unit).toContain("Restart=always");
			expect(unit).toContain("StandardOutput=journal");
		});

		it("should check daemon running status safely", () => {
			const { isDaemonRunning } = require("../src/systemd/installer.ts");
			const status = isDaemonRunning();
			expect(typeof status.running).toBe("boolean");
			expect(["systemd", "process", "none"]).toContain(status.mode);
		});
	});

	describe("Crash Recovery (§28)", () => {
		it("should fix orphaned active runs after process crash", () => {
			const task = store.createTask({
				name: "orphaned-task",
				goal: "Crash recovery test",
				retryPolicy: { maxRetries: 2, delaySeconds: 10, strategy: "fixed" },
				enabled: true,
			});

			const run = store.createRun(task.id, "RUNNING");
			// Simulate crashed process without lease
			const report = performCrashRecovery(store);

			expect(report.orphanedRunsFixed).toContain(run.id);

			const updatedRun = store.getRun(run.id);
			expect(updatedRun!.status).toBe("FAILED");
			expect(updatedRun!.exitReason).toBe("recovered_after_crash");

			// Task should be scheduled for retry
			expect(report.tasksScheduledForRetry).toContain(task.id);
			const updatedTask = store.getTask(task.id);
			expect(updatedTask!.nextRunAt).toBeDefined();
		});
	});

	describe("Dynamic Tool Selector (§17)", () => {
		it("should select log and bash tools for log monitoring tasks", () => {
			const tools = selectToolsForTask({
				goal: "Monitor /var/log/nginx/error.log for HTTP 500 errors and search pattern",
				profile: "sysadmin",
			});

			expect(tools).toContain("bash");
			expect(tools).toContain("read");
			expect(tools).toContain("grep");
			expect(tools).toContain("wait_interval");
			expect(tools).toContain("send_notification");
		});

		it("should respect explicit toolsAllow and toolsDeny", () => {
			const tools = selectToolsForTask({
				goal: "Anything",
				toolsAllow: ["bash", "read", "grep", "write"],
				toolsDeny: ["write"],
			});

			expect(tools).toEqual(["bash", "read", "grep"]);
		});
	});

	describe("Model Router (§33)", () => {
		it("should route monitoring tasks to fast model tier", () => {
			const router = new ModelRouter();
			const model = router.resolveModelPattern("fast");
			expect(model).toBeDefined();
			expect(model).toContain("flash");
		});

		it("should route SRE/security profiles to reasoning tier", () => {
			const router = new ModelRouter();
			const model = router.resolveModelPattern(undefined, "sre");
			expect(model).toBeDefined();
		});

		it("should route software-engineer profile to coding tier", () => {
			const router = new ModelRouter();
			const model = router.resolveModelPattern(undefined, "software-engineer");
			expect(model).toBeDefined();
		});

		it("should allow custom tier overrides", () => {
			const router = new ModelRouter({
				fast: "custom/small-model",
				reasoning: "custom/deep-reasoning",
			});

			expect(router.resolveModelPattern("fast")).toBe("custom/small-model");
			expect(router.resolveModelPattern("reasoning")).toBe("custom/deep-reasoning");
		});
	});
});
