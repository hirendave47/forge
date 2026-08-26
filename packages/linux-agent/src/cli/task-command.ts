/**
 * CLI handler for `forge task` subcommands.
 *
 * Supports: create, list, show, status, runs, logs, run, pause, resume, cancel, doctor, cleanup.
 */

import chalk from "chalk";
import {
	type CreateTaskInput,
	parseIntervalString,
	parseTaskConfig,
	type TaskConfigYAML,
	type TaskSchedule,
} from "../runtime/task-model.ts";
import { getExitCode, type ProgressEvent, TaskRuntime } from "../runtime/task-runtime.ts";
import { getDefaultTaskDbPath, TaskStore } from "../store/task-store.ts";

export async function handleTaskCommand(args: string[]): Promise<void> {
	const subcommand = args[0];

	if (!subcommand || subcommand === "--help" || subcommand === "-h") {
		printTaskHelp();
		return;
	}

	switch (subcommand) {
		case "create":
			await handleCreate(args.slice(1));
			break;
		case "list":
		case "ls":
			handleList();
			break;
		case "show":
			handleShow(args.slice(1));
			break;
		case "status":
			handleStatus(args.slice(1));
			break;
		case "runs":
			handleRuns(args.slice(1));
			break;
		case "logs":
			handleLogs(args.slice(1));
			break;
		case "run":
			await handleRun(args.slice(1));
			break;
		case "pause":
			handlePause(args.slice(1));
			break;
		case "resume":
			handleResume(args.slice(1));
			break;
		case "cancel":
			handleCancel(args.slice(1));
			break;
		case "doctor":
			handleDoctor();
			break;
		case "cleanup":
			handleCleanup(args.slice(1));
			break;
		case "daemon":
			await handleDaemon();
			break;
		case "service":
			await handleService(args.slice(1));
			break;
		default:
			console.error(chalk.red(`Unknown task subcommand: ${subcommand}`));
			console.error(chalk.dim("Run 'forge task --help' for available commands."));
			process.exitCode = 1;
	}
}

// ================================================================
// Subcommand implementations
// ================================================================

async function handleCreate(args: string[]): Promise<void> {
	let name: string | undefined;
	let goal: string | undefined;
	let profile: string | undefined;
	let every: string | undefined;
	let showHelp = false;
	let fromFile: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			showHelp = true;
		} else if (arg === "--name" && i + 1 < args.length) {
			name = args[++i];
		} else if (arg === "--profile" && i + 1 < args.length) {
			profile = args[++i];
		} else if (arg === "--every" && i + 1 < args.length) {
			every = args[++i];
		} else if (arg === "--from" && i + 1 < args.length) {
			fromFile = args[++i];
		} else if (!arg.startsWith("-")) {
			goal = arg;
		}
	}

	if (showHelp) {
		console.log(`${chalk.bold("forge task create")} — Create a persistent task

${chalk.bold("Usage:")}
  forge task create "<goal>" [options]
  forge task create --from <file.yaml>

${chalk.bold("Options:")}
  --name <name>             Task name (auto-generated if not provided)
  --every <interval>        Repeat interval: 30s, 5m, 1h
  --profile <name>          Agent profile: sysadmin, devops, sre, software-engineer, security
  --from <file>             Create from YAML task config file
  --help, -h                Show this help

${chalk.bold("Examples:")}
  forge task create --name disk-check --every 5m "Check disk usage and alert if >90%"
  forge task create --name nginx-monitor --every 30s --profile sysadmin "Monitor nginx errors"
  forge task create --from tasks/nginx-monitor.yaml`);
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());

	try {
		// Handle YAML file input
		if (fromFile) {
			const { readFileSync } = await import("node:fs");
			const { parse } = await import("yaml");
			const content = readFileSync(fromFile, "utf-8");
			const config = parse(content) as TaskConfigYAML;
			const input = parseTaskConfig(config);
			const task = store.createTask(input);
			console.log(chalk.green(`✓ Task created: ${task.id}`));
			console.log(chalk.dim(`  Name: ${task.name}`));
			if (task.schedule) {
				console.log(chalk.dim(`  Schedule: ${formatSchedule(task.schedule)}`));
			}
			return;
		}

		if (!goal) {
			console.error(chalk.red("Error: No goal specified."));
			console.error(chalk.dim('Usage: forge task create "<goal>" [--name NAME] [--every INTERVAL]'));
			process.exitCode = 3;
			return;
		}

		// Auto-generate name from goal if not provided
		const taskName = name ?? generateTaskName(goal);

		let schedule: TaskSchedule | undefined;
		if (every) {
			const seconds = parseIntervalString(every);
			schedule = { type: "interval", seconds };
		}

		const input: CreateTaskInput = {
			name: taskName,
			goal,
			profile,
			schedule,
		};

		const task = store.createTask(input);
		console.log(chalk.green(`✓ Task created: ${task.id}`));
		console.log(chalk.dim(`  Name: ${task.name}`));
		if (task.schedule) {
			console.log(chalk.dim(`  Schedule: ${formatSchedule(task.schedule)}`));
		}
		console.log(chalk.dim(`  Enabled: ${task.enabled}`));
	} finally {
		store.close();
	}
}

function handleList(): void {
	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const tasks = store.listTasks();
		if (tasks.length === 0) {
			console.log(chalk.dim("No tasks found. Create one with 'forge task create'."));
			return;
		}

		// Print table header
		const header = [
			padRight("ID", 10),
			padRight("NAME", 24),
			padRight("STATUS", 10),
			padRight("SCHEDULE", 14),
			padRight("LAST RUN", 20),
		].join("  ");
		console.log(chalk.bold(header));
		console.log(chalk.dim("─".repeat(header.length)));

		for (const task of tasks) {
			const statusColor = task.enabled ? chalk.green : chalk.yellow;
			const row = [
				padRight(task.id.slice(0, 8), 10),
				padRight(task.name.slice(0, 24), 24),
				statusColor(padRight(task.enabled ? "enabled" : "disabled", 10)),
				padRight(task.schedule ? formatSchedule(task.schedule) : "manual", 14),
				padRight(task.lastRunAt ? formatTimeAgo(task.lastRunAt) : "never", 20),
			].join("  ");
			console.log(row);
		}
	} finally {
		store.close();
	}
}

function handleShow(args: string[]): void {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}

		console.log(chalk.bold(`Task: ${task.name}`));
		console.log(`  ID:           ${task.id}`);
		console.log(`  Goal:         ${task.goal.split("\n")[0]}`);
		console.log(`  Enabled:      ${task.enabled}`);
		console.log(`  Profile:      ${task.profile ?? "default"}`);
		console.log(`  Schedule:     ${task.schedule ? formatSchedule(task.schedule) : "manual"}`);
		console.log(`  Overlap:      ${task.overlapPolicy}`);
		console.log(`  Timeout:      ${task.timeoutSeconds}s`);
		console.log(
			`  Retry:        max=${task.retryPolicy.maxRetries} delay=${task.retryPolicy.delaySeconds}s strategy=${task.retryPolicy.strategy}`,
		);
		console.log(`  Policy:       ${task.policyMode}`);
		console.log(`  Model Tier:   ${task.modelTier ?? "default"}`);
		if (task.toolsAllow) console.log(`  Tools Allow:  ${task.toolsAllow.join(", ")}`);
		if (task.toolsDeny) console.log(`  Tools Deny:   ${task.toolsDeny.join(", ")}`);
		if (task.skills) console.log(`  Skills:       ${task.skills.join(", ")}`);
		console.log(`  Created:      ${task.createdAt}`);
		console.log(`  Updated:      ${task.updatedAt}`);
		if (task.lastRunAt) console.log(`  Last Run:     ${task.lastRunAt}`);
		if (task.lastSuccessAt) console.log(`  Last Success: ${task.lastSuccessAt}`);
		if (task.nextRunAt) console.log(`  Next Run:     ${task.nextRunAt}`);
	} finally {
		store.close();
	}
}

function handleStatus(args: string[]): void {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}

		const activeRun = store.getActiveRun(task.id);
		const lease = store.getLease(task.id);
		const recentRuns = store.listRuns(task.id, 5);

		console.log(chalk.bold(`Status: ${task.name}`));
		console.log(`  Enabled:    ${task.enabled ? chalk.green("yes") : chalk.yellow("no")}`);
		console.log(
			`  Active Run: ${activeRun ? `${chalk.cyan(activeRun.id.slice(0, 8))} (${activeRun.status})` : chalk.dim("none")}`,
		);
		console.log(
			`  Lease:      ${lease ? chalk.cyan(`held by ${lease.owner_id}, expires ${lease.expires_at}`) : chalk.dim("none")}`,
		);

		if (recentRuns.length > 0) {
			console.log(`\n  Recent runs:`);
			for (const run of recentRuns) {
				const statusColor =
					run.status === "SUCCEEDED" ? chalk.green : run.status === "FAILED" ? chalk.red : chalk.yellow;
				console.log(
					`    ${run.id.slice(0, 8)}  ${statusColor(padRight(run.status, 12))}  ${run.startedAt}  ${run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : ""}`,
				);
			}
		}
	} finally {
		store.close();
	}
}

function handleRuns(args: string[]): void {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}

		const runs = store.listRuns(task.id, 50);
		if (runs.length === 0) {
			console.log(chalk.dim("No runs found."));
			return;
		}

		const header = [
			padRight("RUN ID", 10),
			padRight("STATUS", 12),
			padRight("STARTED", 20),
			padRight("DURATION", 10),
			padRight("EXIT REASON", 20),
		].join("  ");
		console.log(chalk.bold(header));
		console.log(chalk.dim("─".repeat(header.length)));

		for (const run of runs) {
			const statusColor =
				run.status === "SUCCEEDED" ? chalk.green : run.status === "FAILED" ? chalk.red : chalk.yellow;
			console.log(
				[
					padRight(run.id.slice(0, 8), 10),
					statusColor(padRight(run.status, 12)),
					padRight(run.startedAt.slice(0, 19), 20),
					padRight(run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : "-", 10),
					padRight(run.exitReason ?? "-", 20),
				].join("  "),
			);
		}
	} finally {
		store.close();
	}
}

function handleLogs(args: string[]): void {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}

		const events = store.listEvents(task.id, 200);
		if (events.length === 0) {
			console.log(chalk.dim("No events found."));
			return;
		}

		// Print in chronological order (listEvents returns newest first)
		for (const event of events.reverse()) {
			const time = event.timestamp.slice(0, 19).replace("T", " ");
			const runTag = event.runId ? chalk.dim(` [${event.runId.slice(0, 8)}]`) : "";
			const detailStr = event.details ? chalk.dim(` ${JSON.stringify(event.details)}`) : "";
			console.log(`${chalk.dim(time)}${runTag} ${event.eventType}${detailStr}`);
		}
	} finally {
		store.close();
	}
}

async function handleRun(args: string[]): Promise<void> {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const runtime = new TaskRuntime({
		cwd: process.cwd(),
		onProgress: (event: ProgressEvent) => {
			const time = new Date(event.timestamp).toLocaleTimeString();
			console.error(chalk.dim(`[${time}] ${event.message}`));
		},
	});

	try {
		const store = runtime.getStore();
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}

		const result = await runtime.executeTask(task.id);

		if (result.resultSummary) {
			process.stdout.write(`${result.resultSummary}\n`);
		}

		if (result.error) {
			console.error(chalk.red(`Error: ${result.error}`));
		}

		process.exitCode = getExitCode(result.status);
	} finally {
		runtime.close();
	}
}

function handlePause(args: string[]): void {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}
		store.updateTaskEnabled(task.id, false);
		console.log(chalk.yellow(`⏸ Task "${task.name}" paused.`));
	} finally {
		store.close();
	}
}

function handleResume(args: string[]): void {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}
		store.updateTaskEnabled(task.id, true);
		console.log(chalk.green(`▶ Task "${task.name}" resumed.`));
	} finally {
		store.close();
	}
}

function handleCancel(args: string[]): void {
	const taskRef = args[0];
	if (!taskRef) {
		console.error(chalk.red("Error: Task ID or name required."));
		process.exitCode = 1;
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const task = resolveTask(store, taskRef);
		if (!task) {
			console.error(chalk.red(`Task not found: ${taskRef}`));
			process.exitCode = 1;
			return;
		}
		store.updateTaskEnabled(task.id, false);
		store.releaseLease(task.id);
		store.recordEvent(task.id, undefined, "run_cancelled");
		console.log(chalk.red(`✕ Task "${task.name}" cancelled.`));
	} finally {
		store.close();
	}
}

function handleDoctor(): void {
	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		console.log(chalk.bold("forge task doctor"));
		console.log();

		// Check for stale leases
		const recovered = store.recoverStaleLeases();
		if (recovered.length > 0) {
			console.log(chalk.yellow(`⚠ Recovered ${recovered.length} stale lease(s):`));
			for (const taskId of recovered) {
				const task = store.getTask(taskId);
				console.log(`  ${taskId.slice(0, 8)} — ${task?.name ?? "unknown"}`);
			}
		} else {
			console.log(chalk.green("✓ No stale leases found."));
		}

		// Check task stats
		const tasks = store.listTasks();
		const enabled = tasks.filter((t) => t.enabled).length;
		const disabled = tasks.filter((t) => !t.enabled).length;
		console.log(`\nTasks: ${tasks.length} total (${enabled} enabled, ${disabled} disabled)`);
	} finally {
		store.close();
	}
}

function handleCleanup(args: string[]): void {
	let days = 30;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--days" && i + 1 < args.length) {
			days = Number.parseInt(args[++i], 10);
		}
	}

	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		const removed = store.cleanupOldRuns(days);
		console.log(chalk.green(`✓ Cleaned up ${removed} completed run(s) older than ${days} days.`));
	} finally {
		store.close();
	}
}

async function handleDaemon(): Promise<void> {
	const { startDaemon } = await import("../scheduler/daemon.ts");
	await startDaemon();
}

async function handleService(args: string[]): Promise<void> {
	const action = args[0] || "status";
	const { installUserService, uninstallUserService, startUserService, stopUserService, getUserServiceStatus } =
		await import("../systemd/installer.ts");

	if (action === "install") {
		const res = installUserService();
		console.log(chalk.green(`✓ Installed systemd user service unit: ${res.unitPath}`));
		console.log(chalk.dim("To enable and start: forge task service start"));
	} else if (action === "uninstall") {
		const removed = uninstallUserService();
		if (removed) {
			console.log(chalk.green("✓ Uninstalled forge-taskd.service."));
		} else {
			console.log(chalk.yellow("No installed service unit found."));
		}
	} else if (action === "start") {
		try {
			startUserService();
			console.log(chalk.green("✓ Started forge-taskd.service via systemctl --user."));
		} catch (e: any) {
			console.error(chalk.red(`Failed to start service: ${e.message}`));
		}
	} else if (action === "stop") {
		try {
			stopUserService();
			console.log(chalk.yellow("✓ Stopped forge-taskd.service."));
		} catch (e: any) {
			console.error(chalk.red(`Failed to stop service: ${e.message}`));
		}
	} else if (action === "status") {
		const status = getUserServiceStatus();
		console.log(status);
	} else {
		console.error(chalk.red(`Unknown service action: ${action}. Use: install, uninstall, start, stop, status`));
	}
}

// ================================================================
// Helpers
// ================================================================

function resolveTask(store: TaskStore, ref: string): ReturnType<TaskStore["getTask"]> {
	// Try by name first, then by full ID, then by partial ID prefix
	const byName = store.getTaskByName(ref);
	if (byName) return byName;

	const byId = store.getTask(ref);
	if (byId) return byId;

	// Try partial UUID match
	const all = store.listTasks();
	const match = all.find((t) => t.id.startsWith(ref));
	return match;
}

function generateTaskName(goal: string): string {
	// Take first few meaningful words and slugify
	const words = goal
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 2)
		.slice(0, 4);
	return words.join("-") || `task-${Date.now()}`;
}

function formatSchedule(schedule: NonNullable<import("../runtime/task-model.ts").Task["schedule"]>): string {
	if (schedule.type === "interval") {
		if (schedule.seconds >= 3600) return `every ${schedule.seconds / 3600}h`;
		if (schedule.seconds >= 60) return `every ${schedule.seconds / 60}m`;
		return `every ${schedule.seconds}s`;
	}
	if (schedule.type === "cron") return schedule.expression;
	if (schedule.type === "once") return `once at ${schedule.at}`;
	return "unknown";
}

function formatTimeAgo(isoDate: string): string {
	const diffMs = Date.now() - new Date(isoDate).getTime();
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function padRight(str: string, len: number): string {
	if (str.length >= len) return str.slice(0, len);
	return str + " ".repeat(len - str.length);
}

function printTaskHelp(): void {
	console.log(`${chalk.bold("forge task")} — Manage persistent autonomous tasks

${chalk.bold("Usage:")}
  forge task <command> [options]

${chalk.bold("Commands:")}
  create "<goal>"           Create a new persistent task
  list                      List all tasks
  show <task>               Show task details
  status <task>             Show task status with recent runs
  runs <task>               List execution history
  logs <task>               Show event log
  run <task>                Manually trigger a task execution
  pause <task>              Disable a task
  resume <task>             Re-enable a task
  cancel <task>             Cancel a task and release its lease
  doctor                    Diagnose issues (stale leases, etc.)
  cleanup [--days N]        Remove old completed runs (default: 30 days)
  daemon                    Run task scheduler in foreground
  service <action>          Manage systemd user service (install, start, stop, status, uninstall)

${chalk.bold("Task references:")}
  Tasks can be referenced by name, full UUID, or UUID prefix.

${chalk.bold("Examples:")}
  forge task create --name nginx-monitor --every 30s "Monitor nginx error log"
  forge task list
  forge task status nginx-monitor
  forge task runs nginx-monitor
  forge task logs nginx-monitor
  forge task service install
  forge task service start
  forge task doctor`);
}
