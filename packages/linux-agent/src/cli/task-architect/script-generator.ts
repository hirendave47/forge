/**
 * Task Script Bundle Generator & Manager for Forge AI Task Architect.
 *
 * Generates and manages standalone task bundles for deterministic and hybrid tasks:
 * - script.sh: Fast-path local probe or deterministic execution script
 * - manifest.json: Architecture metadata, trigger thresholds, and escalation rules
 * - verification.sh: Standalone verification probe
 * - README.md: Human-readable task documentation
 */

import { execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/forge-coding-agent";
import type { TaskPlan } from "./schemas.ts";

export interface TaskManifest {
	version: number;
	name: string;
	goal: string;
	architecture: {
		strategy: "deterministic" | "ai_agent" | "hybrid";
		scheduler: string;
		generated_by: string;
		generated_at: string;
		design_session_id?: string;
		confidence?: number;
		explanation: {
			summary: string;
			why_strategy: string;
			why_scheduler: string;
			estimated_ai_usage?: string;
		};
	};
	fast_path?: {
		type: "bash" | "python";
		script_path: string;
		timeout_seconds: number;
		escalate_on: "non_zero_exit" | "error_pattern";
	};
	verification?: string[];
	profile?: string;
	policy_mode: string;
	elevated: boolean;
	schedule?: {
		type: string;
		interval_seconds?: number;
		cron_expression?: string;
		at?: string;
	};
	notifications?: {
		email?: { to: string[]; from?: string };
		webhook?: { url: string };
	};
}

export interface TaskBundle {
	dir: string;
	manifestPath: string;
	scriptPath?: string;
	verificationPath?: string;
	readmePath: string;
	manifest: TaskManifest;
}

/**
 * Returns the standard task bundle storage directory for a task.
 */
export function getTaskBundleDir(taskName: string, baseDir?: string): string {
	const root = baseDir ?? join(getAgentDir(), "tasks");
	return join(root, taskName);
}

/**
 * Validates bash script syntax using `bash -n` if bash is available.
 */
export function validateScriptSyntax(scriptContent: string): { valid: boolean; error?: string } {
	try {
		execSync("bash -n", {
			input: scriptContent,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 2000,
		});
		return { valid: true };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return { valid: false, error: message };
	}
}

/**
 * Generates deterministic fast-path script content based on task goal and plan.
 */
export function generateFastPathScriptContent(plan: TaskPlan): string {
	if (plan.fastPath?.content) {
		return plan.fastPath.content;
	}

	const goalLower = plan.goal.toLowerCase();
	const lines: string[] = ["#!/usr/bin/env bash", "set -euo pipefail", ""];

	lines.push(`# Fast-path deterministic check for: ${plan.name}`);
	lines.push(`# Goal: ${plan.goal}`);
	lines.push(`# Exit 0 = Normal / Healthy (no AI escalation needed)`);
	lines.push(`# Exit >0 = Anomaly detected (triggers AI diagnosis)`);
	lines.push("");

	if (goalLower.includes("postgres") || goalLower.includes("psql") || goalLower.includes("database")) {
		lines.push("# 1. Check PostgreSQL service status");
		lines.push("if ! systemctl is-active --quiet postgresql 2>/dev/null; then");
		lines.push('  echo "[ANOMALY] postgresql.service is not active" >&2');
		lines.push("  exit 1");
		lines.push("fi");
		lines.push("");
		lines.push("# 2. Check listening socket port 5432");
		lines.push('if ! ss -tlpn | grep -q ":5432 "; then');
		lines.push('  echo "[ANOMALY] PostgreSQL is not listening on port 5432" >&2');
		lines.push("  exit 2");
		lines.push("fi");
		lines.push("");
		lines.push('echo "[OK] PostgreSQL service and port 5432 are healthy"');
		lines.push("exit 0");
	} else if (
		goalLower.includes("nginx") ||
		goalLower.includes("apache") ||
		goalLower.includes("caddy") ||
		goalLower.includes("httpd") ||
		(goalLower.includes("web server") && !goalLower.includes("http://") && !goalLower.includes("https://"))
	) {
		lines.push("# 1. Check web service status");
		lines.push("if ! systemctl is-active --quiet nginx 2>/dev/null; then");
		lines.push('  echo "[ANOMALY] nginx.service is not active" >&2');
		lines.push("  exit 1");
		lines.push("fi");
		lines.push("");
		lines.push("# 2. Check HTTP port 80/443");
		lines.push('if ! ss -tlpn | grep -E -q ":(80|443) "; then');
		lines.push('  echo "[ANOMALY] No web server listening on port 80 or 443" >&2');
		lines.push("  exit 2");
		lines.push("fi");
		lines.push("");
		lines.push('echo "[OK] Web service and ports are healthy"');
		lines.push("exit 0");
	} else if (goalLower.includes("disk") || goalLower.includes("space") || goalLower.includes("mount")) {
		lines.push("# Check root filesystem usage threshold (85%)");
		lines.push('USAGE=$(df -P / | awk \'NR==2 {gsub("%","",$5); print $5}\')');
		lines.push("THRESHOLD=85");
		lines.push('if [ "$USAGE" -ge "$THRESHOLD" ]; then');
		lines.push('  echo "[ANOMALY] Root filesystem usage is $"\'{\'"USAGE}% (threshold: $"\'{\'"THRESHOLD}%)" >&2');
		lines.push("  exit 1");
		lines.push("fi");
		lines.push("");
		lines.push('echo "[OK] Root filesystem usage is $"\'{\'"USAGE}% (below $"\'{\'"THRESHOLD}%)"');
		lines.push("exit 0");
	} else if (goalLower.includes("clean") || goalLower.includes("delete") || goalLower.includes("prune")) {
		lines.push("# Deterministic cleanup probe");
		lines.push(`echo "[INFO] Running scheduled cleanup rule: ${plan.goal}"`);
		lines.push("find /tmp -type f -mtime +7 -delete 2>/dev/null || true");
		lines.push('echo "[OK] Cleanup completed successfully"');
		lines.push("exit 0");
	} else {
		lines.push("# Generic operational health check");
		if (plan.verification && plan.verification.length > 0) {
			for (const v of plan.verification) {
				lines.push(`if ! ${v}; then`);
				lines.push(`  echo "[ANOMALY] Verification failed: ${v}" >&2`);
				lines.push("  exit 1");
				lines.push("fi");
			}
			lines.push("");
		}
		lines.push('echo "[OK] Health verification checks passed"');
		lines.push("exit 0");
	}

	return lines.join("\n");
}

/**
 * Generates standalone verification script content.
 */
export function generateVerificationScriptContent(plan: TaskPlan): string {
	const lines: string[] = ["#!/usr/bin/env bash", "set -euo pipefail", ""];

	lines.push(`# Verification script for: ${plan.name}`);
	lines.push(`# Goal: ${plan.goal}`);
	lines.push("");

	if (plan.verification && plan.verification.length > 0) {
		for (const check of plan.verification) {
			lines.push(`if ! ${check}; then`);
			lines.push(`  echo "[FAIL] Verification check failed: ${check}" >&2`);
			lines.push("  exit 1");
			lines.push("fi");
		}
	} else {
		lines.push("# Default exit 0 verification");
		lines.push("exit 0");
	}

	lines.push("");
	lines.push('echo "[PASS] All post-remediation verification checks succeeded"');
	lines.push("exit 0");

	return lines.join("\n");
}

/**
 * Writes the full task bundle to disk.
 */
export function writeTaskBundle(plan: TaskPlan, baseDir?: string): TaskBundle {
	const dir = getTaskBundleDir(plan.name, baseDir);
	mkdirSync(dir, { recursive: true });

	const scriptPath = join(dir, "script.sh");
	const verificationPath = join(dir, "verification.sh");
	const manifestPath = join(dir, "manifest.json");
	const readmePath = join(dir, "README.md");

	// 1. Generate & Write fast-path script
	const scriptContent = generateFastPathScriptContent(plan);
	writeFileSync(scriptPath, scriptContent, "utf-8");
	try {
		chmodSync(scriptPath, 0o755);
	} catch {
		// ignore chmod on unsupported platforms
	}

	// 2. Generate & Write verification script
	const verificationContent = generateVerificationScriptContent(plan);
	writeFileSync(verificationPath, verificationContent, "utf-8");
	try {
		chmodSync(verificationPath, 0o755);
	} catch {
		// ignore
	}

	// 3. Build Manifest
	const manifest: TaskManifest = {
		version: 1,
		name: plan.name,
		goal: plan.goal,
		architecture: {
			strategy: plan.executionStrategy,
			scheduler: plan.scheduler,
			generated_by: "forge-ai-task-architect",
			generated_at: new Date().toISOString(),
			confidence: plan.confidence,
			explanation: {
				summary: plan.explanation?.summary ?? `Task for ${plan.goal}`,
				why_strategy: plan.explanation?.whyStrategy ?? "Selected based on requirement complexity",
				why_scheduler: plan.explanation?.whyScheduler ?? "Selected for runtime compatibility",
				estimated_ai_usage:
					plan.explanation?.estimatedAiUsage ?? (plan.executionStrategy === "deterministic" ? "Zero" : "Low"),
			},
		},
		fast_path:
			plan.executionStrategy === "ai_agent"
				? undefined
				: {
						type: "bash",
						script_path: scriptPath,
						timeout_seconds: 15,
						escalate_on: "non_zero_exit",
					},
		verification: plan.verification,
		profile: plan.profile,
		policy_mode: plan.policyMode,
		elevated: plan.elevated ?? false,
		schedule: plan.schedule
			? {
					type: plan.schedule.type,
					interval_seconds: plan.schedule.intervalSeconds,
					cron_expression: plan.schedule.cronExpression,
					at: plan.schedule.at,
				}
			: undefined,
		notifications: plan.notifications
			? {
					email: plan.notifications.email,
					webhook: plan.notifications.webhook,
				}
			: undefined,
	};

	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

	// 4. Generate README.md
	const readmeLines: string[] = [
		`# Task: ${plan.name}`,
		"",
		`**Goal:** ${plan.goal}`,
		"",
		"## Architecture Specification",
		`- **Execution Strategy:** ${plan.executionStrategy}`,
		`- **Scheduler:** ${plan.scheduler}`,
		`- **Profile:** ${plan.profile ?? "default"}`,
		`- **Safety Policy:** ${plan.policyMode}`,
		`- **Elevated Privileges:** ${plan.elevated ? "Required (sudo)" : "Standard"}`,
		`- **Estimated AI Usage:** ${manifest.architecture.explanation.estimated_ai_usage}`,
		"",
		"## Rationale",
		`- **Why Strategy:** ${manifest.architecture.explanation.why_strategy}`,
		`- **Why Scheduler:** ${manifest.architecture.explanation.why_scheduler}`,
		"",
		"## Bundle Structure",
		"- `manifest.json`: Full architecture metadata and operational parameters",
		"- `script.sh`: Local deterministic fast-path probe or check",
		"- `verification.sh`: Post-remediation verification probe",
		"",
		"## CLI Commands",
		"```bash",
		`forge task show ${plan.name}`,
		`forge task run ${plan.name}`,
		`forge task refine ${plan.name}`,
		"```",
	];

	writeFileSync(readmePath, readmeLines.join("\n"), "utf-8");

	return {
		dir,
		manifestPath,
		scriptPath,
		verificationPath,
		readmePath,
		manifest,
	};
}

/**
 * Loads an existing task bundle from disk if it exists.
 */
export function loadTaskBundle(taskName: string, baseDir?: string): TaskBundle | null {
	const dir = getTaskBundleDir(taskName, baseDir);
	const manifestPath = join(dir, "manifest.json");

	if (!existsSync(manifestPath)) {
		return null;
	}

	try {
		const manifestRaw = readFileSync(manifestPath, "utf-8");
		const manifest = JSON.parse(manifestRaw) as TaskManifest;
		const scriptPath = join(dir, "script.sh");
		const verificationPath = join(dir, "verification.sh");
		const readmePath = join(dir, "README.md");

		return {
			dir,
			manifestPath,
			scriptPath: existsSync(scriptPath) ? scriptPath : undefined,
			verificationPath: existsSync(verificationPath) ? verificationPath : undefined,
			readmePath,
			manifest,
		};
	} catch {
		return null;
	}
}
