/**
 * Audit and Forensics CLI Engine for Forge Linux Agent (§8, §14).
 *
 * Provides chronological execution timelines, step-by-step tool call inspection,
 * host metadata audit, and compliance export formats (Markdown, JSON, JSONL).
 */

import { writeFileSync } from "node:fs";
import chalk from "chalk";
import type { Task, TaskRun } from "../runtime/task-model.ts";
import { getDefaultTaskDbPath, TaskStore } from "../store/task-store.ts";

export async function handleAuditCommand(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printAuditHelp();
		return;
	}

	const subcommand = args[0];

	if (subcommand === "show") {
		const runRef = args[1];
		if (!runRef) {
			console.error(chalk.red("Error: Run ID required. Usage: forge task audit show <run-id>"));
			process.exitCode = 1;
			return;
		}
		handleShowRunAudit(runRef);
		return;
	}

	if (subcommand === "export") {
		const targetRef = args[1];
		if (!targetRef) {
			console.error(
				chalk.red("Error: Task name or Run ID required. Usage: forge task audit export <task|run-id> [options]"),
			);
			process.exitCode = 1;
			return;
		}

		let format: "md" | "json" | "jsonl" = "md";
		let outFile: string | undefined;

		for (let i = 2; i < args.length; i++) {
			if (args[i] === "--format" && i + 1 < args.length) {
				const f = args[++i].toLowerCase();
				if (f === "json" || f === "jsonl" || f === "md" || f === "markdown") {
					format = f === "markdown" ? "md" : (f as "md" | "json" | "jsonl");
				}
			} else if (args[i] === "--out" && i + 1 < args.length) {
				outFile = args[++i];
			}
		}

		handleExportAudit(targetRef, format, outFile);
		return;
	}

	// Default: `forge task audit <task-or-run-ref>`
	handleGeneralAudit(subcommand);
}

function handleGeneralAudit(targetRef: string): void {
	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		// 1. Check if targetRef is a Task
		const task = resolveTask(store, targetRef);
		if (task) {
			displayTaskAuditOverview(store, task);
			return;
		}

		// 2. Check if targetRef is a Run ID
		const run = store.getRun(targetRef);
		if (run) {
			displayRunAuditDetail(store, run);
			return;
		}

		console.error(chalk.red(`Error: Task or Run ID not found: "${targetRef}"`));
		process.exitCode = 1;
	} finally {
		store.close();
	}
}

function handleShowRunAudit(runRef: string): void {
	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const run = store.getRun(runRef);
		if (!run) {
			console.error(chalk.red(`Error: Run ID not found: "${runRef}"`));
			process.exitCode = 1;
			return;
		}
		displayRunAuditDetail(store, run);
	} finally {
		store.close();
	}
}

function displayTaskAuditOverview(store: TaskStore, task: Task): void {
	const runs = store.listRuns(task.id, 10);

	console.log();
	console.log(chalk.bold.cyan("┌────────────────────────────────────────────────────────┐"));
	console.log(chalk.bold.cyan(`│             AUDIT TRAIL: ${padRight(task.name, 28)} │`));
	console.log(chalk.bold.cyan("└────────────────────────────────────────────────────────┘"));
	console.log();
	console.log(`  ${chalk.bold("Task ID:")}    ${task.id}`);
	console.log(`  ${chalk.bold("Goal:")}       ${task.goal}`);
	console.log(`  ${chalk.bold("Profile:")}    ${task.profile ?? "default"} | Policy: ${task.policyMode}`);
	console.log(
		`  ${chalk.bold("Privilege:")}  ${task.elevated ? chalk.bold.red("ELEVATED (ROOT/SUDO)") : chalk.green("STANDARD")}`,
	);
	console.log(`  ${chalk.bold("Created:")}    ${task.createdAt} | Updated: ${task.updatedAt}`);
	console.log();

	if (runs.length === 0) {
		console.log(chalk.yellow("  No execution runs recorded yet."));
		return;
	}

	console.log(chalk.bold("Recent Execution Runs:"));
	console.log(chalk.dim("  ID        Started              Status     Trigger   Duration  Steps  Tokens"));
	console.log(chalk.dim("  ──────────────────────────────────────────────────────────────────────────"));

	for (const r of runs) {
		const statusColor = getStatusColor(r.status);
		const durStr = r.durationMs !== undefined ? `${(r.durationMs / 1000).toFixed(1)}s` : "-";
		const tokensStr = (r.inputTokens + r.outputTokens).toLocaleString();
		const triggerStr = padRight(r.triggerType ?? "schedule", 9);
		console.log(
			`  ${chalk.cyan(r.id.slice(0, 8))}  ${r.startedAt.slice(0, 19).replace("T", " ")}  ${statusColor(padRight(r.status, 9))}  ${triggerStr} ${padRight(durStr, 8)}  ${padRight(String(r.toolCalls), 5)}  ${tokensStr}`,
		);
	}
	console.log();

	// Show step-by-step trace of the latest run
	const latestRun = runs[0];
	console.log(chalk.bold(`Latest Run Forensic Step Trace (${latestRun.id.slice(0, 8)}):`));
	renderRunStepLogs(store, latestRun.id);
	console.log();
	console.log(chalk.dim(`To inspect another run: "forge task audit show <run-id>"`));
	console.log(chalk.dim(`To export compliance report: "forge task audit export ${task.name} --format md"`));
}

function displayRunAuditDetail(store: TaskStore, run: TaskRun): void {
	const task = store.getTask(run.taskId);
	const statusColor = getStatusColor(run.status);

	console.log();
	console.log(chalk.bold.cyan("┌────────────────────────────────────────────────────────┐"));
	console.log(chalk.bold.cyan(`│             RUN AUDIT: ${padRight(run.id.slice(0, 8), 30)} │`));
	console.log(chalk.bold.cyan("└────────────────────────────────────────────────────────┘"));
	console.log();
	console.log(`  ${chalk.bold("Run ID:")}       ${chalk.cyan(run.id)}`);
	console.log(`  ${chalk.bold("Task:")}         ${task ? `${task.name} (${task.id})` : run.taskId}`);
	console.log(`  ${chalk.bold("Status:")}       ${statusColor(run.status)}`);
	console.log(`  ${chalk.bold("Trigger:")}      ${run.triggerType ?? "schedule"}`);
	console.log(
		`  ${chalk.bold("Host Context:")} ${run.hostUser ?? "unknown"}@${run.hostName ?? "localhost"} (Elevated: ${run.elevated ? "YES" : "NO"})`,
	);
	console.log(
		`  ${chalk.bold("Timing:")}       ${run.startedAt} → ${run.finishedAt ?? "running"} (${run.durationMs !== undefined ? `${(run.durationMs / 1000).toFixed(2)}s` : "-"})`,
	);
	console.log(
		`  ${chalk.bold("Tokens:")}       Input=${run.inputTokens.toLocaleString()} Output=${run.outputTokens.toLocaleString()} Total=${(run.inputTokens + run.outputTokens).toLocaleString()}`,
	);
	if (run.exitReason) {
		console.log(`  ${chalk.bold("Exit Reason:")}  ${run.exitReason}`);
	}
	if (run.error) {
		console.log(`  ${chalk.bold.red("Error:")}        ${run.error}`);
	}
	console.log();

	console.log(chalk.bold("Granular Step Execution Trace:"));
	renderRunStepLogs(store, run.id);

	if (run.resultSummary) {
		console.log();
		console.log(chalk.bold("Run Result Summary:"));
		console.log(chalk.dim("─────────────────────────────────────────────────────────────"));
		console.log(run.resultSummary);
		console.log(chalk.dim("─────────────────────────────────────────────────────────────"));
	}
}

function renderRunStepLogs(store: TaskStore, runId: string): void {
	const steps = store.listStepLogs(runId);

	if (steps.length === 0) {
		console.log(chalk.dim("  No individual tool call steps recorded for this run."));
		return;
	}

	for (const step of steps) {
		const statusBadge = step.isError ? chalk.bgRed.white(" FAIL ") : chalk.bgGreen.black(" OK ");
		const durStr = step.durationMs !== undefined ? chalk.dim(` (${step.durationMs}ms)`) : "";
		const timeStr = chalk.dim(step.timestamp.slice(11, 19));

		console.log();
		console.log(
			`  ${timeStr} ${statusBadge} ${chalk.bold.yellow(`Step ${step.stepIndex}`)}: ${chalk.bold.cyan(step.toolName)}${durStr}`,
		);

		// Format Tool Arguments
		if (step.toolArgs) {
			const argsObj = typeof step.toolArgs === "string" ? JSON.parse(step.toolArgs) : step.toolArgs;
			if (step.toolName === "bash" && argsObj.command) {
				console.log(`    ${chalk.dim("$")} ${chalk.green(argsObj.command)}`);
			} else if (step.toolName === "read" && argsObj.path) {
				console.log(`    ${chalk.dim("path:")} ${chalk.blue(argsObj.path)}`);
			} else if (step.toolName === "edit" && argsObj.path) {
				console.log(`    ${chalk.dim("edit path:")} ${chalk.blue(argsObj.path)}`);
			} else {
				console.log(`    ${chalk.dim("args:")} ${chalk.dim(JSON.stringify(argsObj))}`);
			}
		}

		// Format Tool Result
		if (step.toolResult) {
			const lines = step.toolResult.trim().split("\n");
			const previewLines = lines.slice(0, 8);
			for (const line of previewLines) {
				console.log(`    ${chalk.dim("│")} ${chalk.dim(line)}`);
			}
			if (lines.length > 8) {
				console.log(`    ${chalk.dim(`│ ... (${lines.length - 8} more lines)`)}`);
			}
		}
	}
}

function handleExportAudit(targetRef: string, format: "md" | "json" | "jsonl", outFile?: string): void {
	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, targetRef);
		const run = !task ? store.getRun(targetRef) : undefined;

		if (!task && !run) {
			console.error(chalk.red(`Error: Task or Run ID not found: "${targetRef}"`));
			process.exitCode = 1;
			return;
		}

		let outputContent = "";

		if (format === "json") {
			const data = task ? buildTaskAuditJSON(store, task) : buildRunAuditJSON(store, run!);
			outputContent = JSON.stringify(data, null, 2);
		} else if (format === "jsonl") {
			const data = task ? buildTaskAuditJSON(store, task) : buildRunAuditJSON(store, run!);
			outputContent = `${JSON.stringify(data)}\n`;
		} else {
			// Markdown
			outputContent = task ? buildTaskAuditMarkdown(store, task) : buildRunAuditMarkdown(store, run!);
		}

		if (outFile) {
			writeFileSync(outFile, outputContent, "utf-8");
			console.log(chalk.green(`✓ Exported audit report (${format.toUpperCase()}) to: ${outFile}`));
		} else {
			console.log(outputContent);
		}
	} finally {
		store.close();
	}
}

function buildTaskAuditJSON(store: TaskStore, task: Task): Record<string, unknown> {
	const runs = store.listRuns(task.id, 50);
	const events = store.listEvents(task.id, 50);
	const stepLogs = store.listTaskStepLogs(task.id, 100);

	return {
		task,
		runs: runs.map((r) => ({
			...r,
			steps: store.listStepLogs(r.id),
		})),
		events,
		recentStepLogs: stepLogs,
		exportedAt: new Date().toISOString(),
	};
}

function buildRunAuditJSON(store: TaskStore, run: TaskRun): Record<string, unknown> {
	const steps = store.listStepLogs(run.id);
	const task = store.getTask(run.taskId);

	return {
		task,
		run,
		steps,
		exportedAt: new Date().toISOString(),
	};
}

function buildTaskAuditMarkdown(store: TaskStore, task: Task): string {
	const runs = store.listRuns(task.id, 20);
	const lines: string[] = [
		`# Audit Report: Task "${task.name}"`,
		``,
		`- **Task ID**: \`${task.id}\``,
		`- **Goal**: ${task.goal}`,
		`- **Profile**: ${task.profile ?? "default"} | **Policy Mode**: ${task.policyMode}`,
		`- **Elevated Privileges**: ${task.elevated ? "YES (ROOT/SUDO)" : "NO (Standard)"}`,
		`- **Created**: ${task.createdAt} | **Updated**: ${task.updatedAt}`,
		`- **Report Generated**: ${new Date().toISOString()}`,
		``,
		`## Execution Runs (${runs.length})`,
		``,
		`| Run ID | Started (UTC) | Status | Trigger | Duration | Tool Calls | Tokens |`,
		`|---|---|---|---|---|---|---|`,
	];

	for (const r of runs) {
		const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "-";
		const tokens = (r.inputTokens + r.outputTokens).toLocaleString();
		lines.push(
			`| \`${r.id.slice(0, 8)}\` | ${r.startedAt} | ${r.status} | ${r.triggerType ?? "schedule"} | ${dur} | ${r.toolCalls} | ${tokens} |`,
		);
	}

	if (runs.length > 0) {
		const latest = runs[0];
		const steps = store.listStepLogs(latest.id);
		lines.push(``, `## Latest Run Details (\`${latest.id.slice(0, 8)}\`)`, ``);
		lines.push(`- **Status**: ${latest.status} (${latest.exitReason ?? "completed"})`);
		lines.push(`- **Host**: \`${latest.hostUser ?? "unknown"}@${latest.hostName ?? "localhost"}\``);
		if (latest.resultSummary) {
			lines.push(``, `### Result Summary`, ``, latest.resultSummary, ``);
		}

		if (steps.length > 0) {
			lines.push(`### Step-by-Step Tool Trace`, ``);
			for (const step of steps) {
				const statusStr = step.isError ? "FAILED" : "SUCCESS";
				lines.push(`#### Step ${step.stepIndex}: \`${step.toolName}\` (${statusStr} - ${step.durationMs ?? 0}ms)`);
				if (step.toolArgs) {
					lines.push("```json", JSON.stringify(step.toolArgs, null, 2), "```");
				}
				if (step.toolResult) {
					lines.push("```text", step.toolResult.slice(0, 1024), "```");
				}
			}
		}
	}

	return lines.join("\n");
}

function buildRunAuditMarkdown(store: TaskStore, run: TaskRun): string {
	const task = store.getTask(run.taskId);
	const steps = store.listStepLogs(run.id);

	const lines: string[] = [
		`# Audit Report: Run \`${run.id}\``,
		``,
		`- **Task**: ${task ? `${task.name} (\`${task.id}\`)` : `\`${run.taskId}\``}`,
		`- **Status**: ${run.status} (${run.exitReason ?? "completed"})`,
		`- **Trigger**: ${run.triggerType ?? "schedule"}`,
		`- **Host**: \`${run.hostUser ?? "unknown"}@${run.hostName ?? "localhost"}\` (Elevated: ${run.elevated ? "YES" : "NO"})`,
		`- **Duration**: ${run.durationMs ? `${(run.durationMs / 1000).toFixed(2)}s` : "-"}`,
		`- **Tokens**: Input=${run.inputTokens.toLocaleString()} | Output=${run.outputTokens.toLocaleString()}`,
		`- **Report Generated**: ${new Date().toISOString()}`,
		``,
	];

	if (run.resultSummary) {
		lines.push(`## Result Summary`, ``, run.resultSummary, ``);
	}

	if (steps.length > 0) {
		lines.push(`## Step Execution Trace (${steps.length} steps)`, ``);
		for (const step of steps) {
			const statusStr = step.isError ? "FAILED" : "SUCCESS";
			lines.push(`### Step ${step.stepIndex}: \`${step.toolName}\` (${statusStr} - ${step.durationMs ?? 0}ms)`);
			if (step.toolArgs) {
				lines.push("```json", JSON.stringify(step.toolArgs, null, 2), "```");
			}
			if (step.toolResult) {
				lines.push("```text", step.toolResult.slice(0, 2048), "```");
			}
		}
	}

	return lines.join("\n");
}

function resolveTask(store: TaskStore, ref: string): ReturnType<TaskStore["getTask"]> {
	const byName = store.getTaskByName(ref);
	if (byName) return byName;
	const byId = store.getTask(ref);
	if (byId) return byId;
	const all = store.listTasks();
	return all.find((t) => t.id.startsWith(ref));
}

function getStatusColor(status: string): (text: string) => string {
	switch (status) {
		case "SUCCEEDED":
			return chalk.green;
		case "FAILED":
			return chalk.red;
		case "RUNNING":
		case "ACQUIRING":
			return chalk.cyan;
		case "SKIPPED":
			return chalk.yellow;
		case "TIMED_OUT":
			return chalk.magenta;
		default:
			return chalk.dim;
	}
}

function padRight(str: string, len: number): string {
	if (str.length >= len) return str.slice(0, len);
	return str + " ".repeat(len - str.length);
}

function printAuditHelp(): void {
	console.log(`${chalk.bold("forge task audit")} — Forensic audit trails and step-by-step logs

${chalk.bold("Usage:")}
  forge task audit <task|run-id>                      View task runs & step trace overview
  forge task audit show <run-id>                      Deep dive into specific run step logs
  forge task audit export <task|run-id> [options]     Export full report (Markdown / JSON / JSONL)

${chalk.bold("Export Options:")}
  --format <md|json|jsonl>   Output format [default: md]
  --out <file>               Write report to file path

${chalk.bold("Examples:")}
  forge task audit nginx-monitor
  forge task audit show 98c06897-6a4a-42c2-8418-874e0d7c181b
  forge task audit export nginx-monitor --format md --out report.md
  forge task audit export nginx-monitor --format json > audit.json`);
}
