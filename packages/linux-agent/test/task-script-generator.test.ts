/**
 * Unit tests for Task Script Generator and Bundle Manager.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskPlan } from "../src/cli/task-architect/schemas.ts";
import {
	generateFastPathScriptContent,
	generateVerificationScriptContent,
	loadTaskBundle,
	validateScriptSyntax,
	writeTaskBundle,
} from "../src/cli/task-architect/script-generator.ts";

const TEST_BUNDLES_DIR = ".test-task-bundles";

describe("Script Generator — Script Content and Syntax", () => {
	it("should generate valid bash syntax for postgresql monitor", () => {
		const plan: TaskPlan = {
			name: "test-pg-mon",
			goal: "Monitor postgresql server health",
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			policyMode: "autonomous",
			explanation: { summary: "", whyStrategy: "", whyScheduler: "" },
		};

		const content = generateFastPathScriptContent(plan);
		expect(content).toContain("postgresql.service");
		expect(content).toContain(":5432");

		const syntax = validateScriptSyntax(content);
		expect(syntax.valid).toBe(true);
	});

	it("should generate valid bash syntax for web/nginx monitor", () => {
		const plan: TaskPlan = {
			name: "test-web-mon",
			goal: "Check if nginx is running and port 80 is listening",
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			policyMode: "autonomous",
			explanation: { summary: "", whyStrategy: "", whyScheduler: "" },
		};

		const content = generateFastPathScriptContent(plan);
		expect(content).toContain("nginx.service");
		expect(content).toContain("80|443");

		const syntax = validateScriptSyntax(content);
		expect(syntax.valid).toBe(true);
	});

	it("should generate valid bash syntax for disk space monitor", () => {
		const plan: TaskPlan = {
			name: "test-disk-mon",
			goal: "Check disk usage and alert when full",
			executionStrategy: "deterministic",
			scheduler: "systemd_timer",
			policyMode: "supervised",
			explanation: { summary: "", whyStrategy: "", whyScheduler: "" },
		};

		const content = generateFastPathScriptContent(plan);
		expect(content).toContain("df -P /");

		const syntax = validateScriptSyntax(content);
		expect(syntax.valid).toBe(true);
	});

	it("should generate valid verification script", () => {
		const plan: TaskPlan = {
			name: "test-verification",
			goal: "General verification",
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			policyMode: "autonomous",
			verification: ["systemctl is-active --quiet nginx", "test -f /var/log/syslog"],
			explanation: { summary: "", whyStrategy: "", whyScheduler: "" },
		};

		const content = generateVerificationScriptContent(plan);
		expect(content).toContain("systemctl is-active --quiet nginx");
		expect(content).toContain("test -f /var/log/syslog");

		const syntax = validateScriptSyntax(content);
		expect(syntax.valid).toBe(true);
	});
});

describe("Script Generator — Bundle Disk Persistence", () => {
	beforeEach(() => {
		rmSync(TEST_BUNDLES_DIR, { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(TEST_BUNDLES_DIR, { recursive: true, force: true });
	});

	it("should write bundle files and load them back accurately", () => {
		const plan: TaskPlan = {
			name: "db-watchdog",
			goal: "Supervise PostgreSQL database",
			executionStrategy: "hybrid",
			scheduler: "forge_sqlite",
			profile: "sre",
			policyMode: "autonomous",
			elevated: true,
			schedule: {
				type: "interval",
				intervalSeconds: 60,
			},
			explanation: {
				summary: "Hybrid PostgreSQL watchdog",
				whyStrategy: "Fast probe with AI root-cause escalation",
				whyScheduler: "Stateful SQLite scheduler with leases",
				estimatedAiUsage: "Low",
			},
			confidence: 0.98,
		};

		const bundle = writeTaskBundle(plan, TEST_BUNDLES_DIR);
		expect(existsSync(bundle.dir)).toBe(true);
		expect(existsSync(bundle.scriptPath!)).toBe(true);
		expect(existsSync(bundle.manifestPath)).toBe(true);
		expect(existsSync(bundle.readmePath)).toBe(true);

		// Read manifest
		const manifest = JSON.parse(readFileSync(bundle.manifestPath, "utf-8"));
		expect(manifest.name).toBe("db-watchdog");
		expect(manifest.architecture.strategy).toBe("hybrid");
		expect(manifest.architecture.confidence).toBe(0.98);
		expect(manifest.architecture.explanation.why_strategy).toContain("Fast probe");

		// Load bundle via helper
		const loaded = loadTaskBundle("db-watchdog", TEST_BUNDLES_DIR);
		expect(loaded).toBeDefined();
		expect(loaded?.manifest.name).toBe("db-watchdog");
		expect(loaded?.scriptPath).toBeDefined();
	});

	it("should return null for non-existent bundle", () => {
		const nonExistent = loadTaskBundle("nonexistent-task-xyz", TEST_BUNDLES_DIR);
		expect(nonExistent).toBeNull();
	});
});
