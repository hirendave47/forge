/**
 * CLI handler for `forge task` subcommands.
 *
 * Supports: create, list, show, status, runs, logs, run, pause, resume, cancel, doctor, cleanup.
 */

import chalk from "chalk";
import {
	type CreateTaskInput,
	type ModelTier,
	type OverlapPolicy,
	type PolicyMode,
	parseIntervalString,
	parseTaskConfig,
	type TaskConfigYAML,
	type TaskSchedule,
} from "../runtime/task-model.ts";
import { getExitCode, type ProgressEvent, TaskRuntime } from "../runtime/task-runtime.ts";
import { computeNextCronRun } from "../scheduler/cron.ts";
import { getDefaultTaskDbPath, TaskStore } from "../store/task-store.ts";

export async function handleTaskCommand(args: string[]): Promise<void> {
	const subcommand = args[0];

	if (!subcommand || subcommand === "--help" || subcommand === "-h") {
		printTaskHelp();
		return;
	}

	switch (subcommand) {
		case "wizard":
		case "interactive":
			await handleWizard(args.slice(1));
			break;
		case "create":
			await handleCreate(args.slice(1));
			break;
		case "template":
		case "templates":
			await handleTemplate(args.slice(1));
			break;
		case "sudoers":
		case "privilege":
		case "privileges": {
			const { handleSudoersCommand } = await import("../systemd/sudoers.ts");
			await handleSudoersCommand(args.slice(1));
			break;
		}
		case "explain": {
			const { handleExplain } = await import("./schedule-explainer.ts");
			await handleExplain(args.slice(1));
			break;
		}
		case "test": {
			const { handleTest } = await import("./task-tester.ts");
			await handleTest(args.slice(1));
			break;
		}
		case "audit": {
			const { handleAuditCommand } = await import("./audit-command.ts");
			await handleAuditCommand(args.slice(1));
			break;
		}
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
			await handleDoctor();
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

async function handleWizard(args: string[]): Promise<void> {
	const { runTaskWizard } = await import("./wizard/index.ts");
	let initialGoal: string | undefined;
	let smart: boolean | undefined;
	for (const arg of args) {
		if (arg === "--smart" || arg === "--ai") {
			smart = true;
		} else if (arg === "--no-smart" || arg === "--no-ai") {
			smart = false;
		} else if (!arg.startsWith("-") && !initialGoal) {
			initialGoal = arg;
		}
	}
	await runTaskWizard({ initialGoal, smart });
}

async function handleTemplate(args: string[]): Promise<void> {
	const { listTaskTemplates, getTaskTemplate } = await import("../templates/index.ts");
	const action = args[0] ?? "list";

	if (action === "list" || action === "ls") {
		const templates = listTaskTemplates();
		console.log();
		console.log(chalk.bold("Available Curated Task Templates:"));
		console.log();
		console.log(chalk.dim("  TEMPLATE ID                 CATEGORY    PROFILE     SCHEDULE        DESCRIPTION"));
		console.log(
			chalk.dim("  ─────────────────────────────────────────────────────────────────────────────────────────────"),
		);
		for (const t of templates) {
			const id = padRight(t.id, 27);
			const cat = padRight(t.category, 11);
			const prof = padRight(t.profile, 11);
			const sched = padRight(formatSchedule(t.schedule), 15);
			const desc = t.description.length > 50 ? `${t.description.slice(0, 47)}...` : t.description;
			console.log(`  ${chalk.cyan(id)} ${cat} ${prof} ${sched} ${desc}`);
		}
		console.log();
		console.log(chalk.dim("  To instantiate: forge task create --template <id> [--name <custom-name>]"));
		console.log(chalk.dim("  To view details: forge task template show <id>"));
		return;
	}

	if (action === "show" && args[1]) {
		const template = getTaskTemplate(args[1]);
		if (!template) {
			console.error(chalk.red(`Template not found: "${args[1]}"`));
			process.exitCode = 1;
			return;
		}
		console.log();
		console.log(`${chalk.bold("Template:")}     ${chalk.green(template.id)} (${template.title})`);
		console.log(`${chalk.bold("Category:")}     ${template.category}`);
		console.log(`${chalk.bold("Profile:")}      ${template.profile}`);
		console.log(`${chalk.bold("Schedule:")}     ${formatSchedule(template.schedule)}`);
		console.log(`${chalk.bold("Policy Mode:")}  ${template.policyMode}`);
		console.log(`${chalk.bold("Timeout:")}      ${template.timeoutSeconds}s`);
		if (template.retryPolicy) {
			console.log(
				`${chalk.bold("Retries:")}      max=${template.retryPolicy.maxRetries} delay=${template.retryPolicy.delaySeconds}s (${template.retryPolicy.strategy})`,
			);
		}
		if (template.toolsAllow) {
			console.log(`${chalk.bold("Tools Allow:")}  ${template.toolsAllow.join(", ")}`);
		}
		console.log();
		console.log(chalk.bold("Goal:"));
		console.log(chalk.dim(template.goal));
		console.log();
		console.log(chalk.dim(`To create task: forge task create --template ${template.id}`));
		return;
	}

	console.log(`${chalk.bold("forge task template")} — Manage curated task templates

${chalk.bold("Usage:")}
  forge task template list
  forge task template show <id>
  forge task create --template <id>`);
}

async function handleCreate(args: string[]): Promise<void> {
	let name: string | undefined;
	let goal: string | undefined;
	let profile: string | undefined;
	let every: string | undefined;
	let cron: string | undefined;
	let at: string | undefined;
	let showHelp = false;
	let fromFile: string | undefined;
	let templateName: string | undefined;
	let timeoutSeconds: number | undefined;
	let overlapPolicy: OverlapPolicy | undefined;
	let retries: number | undefined;
	let retryDelay: number | undefined;
	let retryStrategy: ("fixed" | "exponential") | undefined;
	let policyMode: PolicyMode | undefined;
	let modelTier: ModelTier | undefined;
	let elevated = false;
	let interactive = false;
	let smart: boolean | undefined;
	const toolsAllow: string[] = [];
	const toolsDeny: string[] = [];
	const skills: string[] = [];
	const notifyEmail: string[] = [];
	let notifyWebhook: string | undefined;
	let enabled = true;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			showHelp = true;
		} else if (arg === "--interactive" || arg === "-i") {
			interactive = true;
		} else if (arg === "--smart" || arg === "--ai") {
			interactive = true;
			smart = true;
		} else if (arg === "--no-smart" || arg === "--no-ai") {
			smart = false;
		} else if (arg === "--sudo" || arg === "--elevated") {
			elevated = true;
		} else if (arg === "--template" && i + 1 < args.length) {
			templateName = args[++i];
		} else if (arg === "--name" && i + 1 < args.length) {
			name = args[++i];
		} else if (arg === "--profile" && i + 1 < args.length) {
			profile = args[++i];
		} else if (arg === "--every" && i + 1 < args.length) {
			every = args[++i];
		} else if (arg === "--cron" && i + 1 < args.length) {
			cron = args[++i];
		} else if (arg === "--at" && i + 1 < args.length) {
			at = args[++i];
		} else if (arg === "--from" && i + 1 < args.length) {
			fromFile = args[++i];
		} else if (arg === "--timeout" && i + 1 < args.length) {
			const parsed = Number.parseInt(args[++i], 10);
			if (Number.isNaN(parsed) || parsed <= 0) {
				console.error(chalk.red(`Invalid timeout: "${args[i]}". Must be a positive integer.`));
				process.exitCode = 3;
				return;
			}
			timeoutSeconds = parsed;
		} else if (arg === "--overlap" && i + 1 < args.length) {
			const val = args[++i].toLowerCase();
			if (val !== "skip" && val !== "queue") {
				console.error(chalk.red(`Invalid overlap policy: "${val}". Expected "skip" or "queue".`));
				process.exitCode = 3;
				return;
			}
			overlapPolicy = val;
		} else if (arg === "--retries" && i + 1 < args.length) {
			const parsed = Number.parseInt(args[++i], 10);
			if (Number.isNaN(parsed) || parsed < 0) {
				console.error(chalk.red(`Invalid retries: "${args[i]}". Must be a non-negative integer.`));
				process.exitCode = 3;
				return;
			}
			retries = parsed;
		} else if (arg === "--retry-delay" && i + 1 < args.length) {
			const parsed = Number.parseInt(args[++i], 10);
			if (Number.isNaN(parsed) || parsed <= 0) {
				console.error(chalk.red(`Invalid retry delay: "${args[i]}". Must be a positive integer.`));
				process.exitCode = 3;
				return;
			}
			retryDelay = parsed;
		} else if (arg === "--retry-strategy" && i + 1 < args.length) {
			const val = args[++i].toLowerCase();
			if (val !== "fixed" && val !== "exponential") {
				console.error(chalk.red(`Invalid retry strategy: "${val}". Expected "fixed" or "exponential".`));
				process.exitCode = 3;
				return;
			}
			retryStrategy = val;
		} else if (arg === "--policy" && i + 1 < args.length) {
			const val = args[++i].toLowerCase();
			if (val !== "safe" && val !== "supervised" && val !== "autonomous") {
				console.error(chalk.red(`Invalid policy mode: "${val}". Expected "safe", "supervised", or "autonomous".`));
				process.exitCode = 3;
				return;
			}
			policyMode = val as PolicyMode;
		} else if (arg === "--model-tier" && i + 1 < args.length) {
			const val = args[++i].toLowerCase();
			if (val !== "fast" && val !== "default" && val !== "reasoning" && val !== "coding") {
				console.error(
					chalk.red(`Invalid model tier: "${val}". Expected "fast", "default", "reasoning", or "coding".`),
				);
				process.exitCode = 3;
				return;
			}
			modelTier = val as ModelTier;
		} else if ((arg === "--tools" || arg === "-t") && i + 1 < args.length) {
			toolsAllow.push(
				...args[++i]
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		} else if ((arg === "--exclude-tools" || arg === "--deny-tools" || arg === "-xt") && i + 1 < args.length) {
			toolsDeny.push(
				...args[++i]
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		} else if (arg === "--skills" && i + 1 < args.length) {
			skills.push(
				...args[++i]
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		} else if (arg === "--notify-email" && i + 1 < args.length) {
			notifyEmail.push(
				...args[++i]
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		} else if (arg === "--notify-webhook" && i + 1 < args.length) {
			notifyWebhook = args[++i];
		} else if (arg === "--disabled" || arg === "--no-enabled") {
			enabled = false;
		} else if (!arg.startsWith("-")) {
			goal = arg;
		}
	}

	if (showHelp) {
		console.log(`${chalk.bold("forge task create")} — Create a persistent task

${chalk.bold("Usage:")}
  forge task create "<goal>" [options]
  forge task create --from <file.yaml>
  forge task create --interactive

${chalk.bold("Schedule Options:")}
  --every <interval>        Repeat interval: 30s, 5m, 1h
  --cron <expression>       UTC 5-part cron: "*/15 * * * *"
  --at <datetime>           Run once at ISO datetime: "2026-08-30T15:00:00Z"

${chalk.bold("Operational & Execution Options:")}
  --name <name>             Unique task name (auto-slugged from goal if omitted)
  --profile <name>          Agent persona (sysadmin, devops, sre, software-engineer, security)
  --policy <mode>           Safety policy mode (safe, supervised, autonomous) [default: autonomous]
  --model-tier <tier>       Model routing (fast, default, reasoning, coding)
  --timeout <seconds>       Execution duration timeout in seconds [default: 120]
  --overlap <policy>        Overlap concurrency policy (skip, queue) [default: skip]
  --sudo, --elevated        Require root / passwordless sudo privileges for sysadmin commands
  --disabled                Create task in disabled state [default: enabled]
  --interactive, -i         Launch interactive guided wizard

${chalk.bold("Retry Options:")}
  --retries <n>             Maximum retry attempts on failure (default: 0)
  --retry-delay <seconds>   Delay between retries in seconds (default: 30)
  --retry-strategy <type>   Retry strategy: fixed, exponential (default: fixed)

${chalk.bold("Tools & Skills:")}
  --tools, -t <list>        Comma-separated allowlist of tools
  --exclude-tools, -xt <l>  Comma-separated denylist of tools
  --skills <list>           Comma-separated list of skill names

${chalk.bold("Notification Options:")}
  --notify-email <emails>   Comma-separated recipient emails
  --notify-webhook <url>    Notification webhook URL

${chalk.bold("File & General Options:")}
  --from <file>             Create from YAML task config file
  --template <name>         Create from curated task template (e.g. nginx-error-monitor)
  --help, -h                Show this help

${chalk.bold("Examples:")}
  forge task create --name disk-check --every 5m "Check disk usage and alert if >90%"
  forge task create --name nginx-monitor --cron "*/5 * * * *" --profile sysadmin "Monitor nginx errors"
  forge task create --template nginx-error-monitor --name prod-nginx-mon
  forge task create --interactive
  forge task create --from tasks/nginx-monitor.yaml`);
		return;
	}

	if (interactive || (args.length === 0 && Boolean(process.stdin.isTTY))) {
		const { runTaskWizard } = await import("./wizard/index.ts");
		await runTaskWizard({ initialGoal: goal, smart });
		return;
	}

	const store = new TaskStore(getDefaultTaskDbPath());

	try {
		// Handle curated template input
		if (templateName) {
			const { instantiateTemplate } = await import("../templates/index.ts");
			try {
				let overrideSchedule: TaskSchedule | undefined;
				if (every) {
					overrideSchedule = { type: "interval", seconds: parseIntervalString(every) };
				} else if (cron) {
					computeNextCronRun(cron);
					overrideSchedule = { type: "cron", expression: cron };
				} else if (at) {
					overrideSchedule = { type: "once", at: new Date(at).toISOString() };
				}

				const templateInput = instantiateTemplate(templateName, {
					name,
					goal,
					profile,
					schedule: overrideSchedule,
					policyMode,
					modelTier,
					timeoutSeconds,
					overlapPolicy,
					enabled,
					elevated,
					toolsAllow: toolsAllow.length > 0 ? toolsAllow : undefined,
					toolsDeny: toolsDeny.length > 0 ? toolsDeny : undefined,
					retryPolicy:
						retries !== undefined
							? { maxRetries: retries, delaySeconds: retryDelay ?? 30, strategy: retryStrategy ?? "fixed" }
							: undefined,
					notifications:
						notifyEmail.length > 0 || notifyWebhook
							? {
									email: notifyEmail.length > 0 ? { to: notifyEmail } : undefined,
									webhook: notifyWebhook ? { url: notifyWebhook } : undefined,
								}
							: undefined,
				});
				const task = store.createTask(templateInput);
				console.log(chalk.green(`✓ Task created from template "${templateName}": ${task.id}`));
				console.log(chalk.dim(`  Name: ${task.name}`));
				if (task.schedule) {
					console.log(chalk.dim(`  Schedule: ${formatSchedule(task.schedule)}`));
					const { isDaemonRunning } = await import("../systemd/installer.ts");
					const daemonStatus = isDaemonRunning();
					if (!daemonStatus.running) {
						console.log();
						console.log(
							chalk.yellow("⚠️  Note: Background scheduler daemon (forge-taskd) is not currently running."),
						);
						console.log(chalk.dim('  To start it now: "forge task service start" (or "forge task daemon")'));
					} else {
						console.log(chalk.green(`  Scheduler: Active (${daemonStatus.details})`));
					}
				}
				return;
			} catch (err: any) {
				console.error(chalk.red(`Template error: ${err.message}`));
				process.exitCode = 1;
				return;
			}
		}

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
			console.error(chalk.dim('Usage: forge task create "<goal>" [options]'));
			process.exitCode = 3;
			return;
		}

		// Validate schedule mutual exclusivity
		const scheduleCount = (every ? 1 : 0) + (cron ? 1 : 0) + (at ? 1 : 0);
		if (scheduleCount > 1) {
			console.error(chalk.red("Error: Cannot specify multiple schedules. Choose one of: --every, --cron, --at."));
			process.exitCode = 3;
			return;
		}

		let schedule: TaskSchedule | undefined;
		if (every) {
			try {
				const seconds = parseIntervalString(every);
				schedule = { type: "interval", seconds };
			} catch (err: any) {
				console.error(chalk.red(`Error: ${err.message}`));
				process.exitCode = 3;
				return;
			}
		} else if (cron) {
			try {
				computeNextCronRun(cron);
				schedule = { type: "cron", expression: cron };
			} catch (err: any) {
				console.error(chalk.red(`Invalid cron expression "${cron}": ${err.message}`));
				process.exitCode = 3;
				return;
			}
		} else if (at) {
			const target = new Date(at);
			if (Number.isNaN(target.getTime())) {
				console.error(
					chalk.red(`Invalid datetime format for --at: "${at}". Use ISO 8601 format (e.g. 2026-08-30T15:00:00Z).`),
				);
				process.exitCode = 3;
				return;
			}
			schedule = { type: "once", at: target.toISOString() };
		}

		// Auto-generate name from goal if not provided
		const taskName = name ?? generateTaskName(goal);

		let retryPolicy: CreateTaskInput["retryPolicy"];
		if (retries !== undefined || retryDelay !== undefined || retryStrategy !== undefined) {
			retryPolicy = {
				maxRetries: retries,
				delaySeconds: retryDelay,
				strategy: retryStrategy,
			};
		}

		let notifications: CreateTaskInput["notifications"];
		if (notifyEmail.length > 0 || notifyWebhook) {
			notifications = {
				email: notifyEmail.length > 0 ? { to: notifyEmail } : undefined,
				webhook: notifyWebhook ? { url: notifyWebhook } : undefined,
			};
		}

		const input: CreateTaskInput = {
			name: taskName,
			goal,
			profile,
			schedule,
			enabled,
			overlapPolicy,
			timeoutSeconds,
			retryPolicy,
			policyMode,
			toolsAllow: toolsAllow.length > 0 ? toolsAllow : undefined,
			toolsDeny: toolsDeny.length > 0 ? toolsDeny : undefined,
			skills: skills.length > 0 ? skills : undefined,
			modelTier,
			elevated,
			notifications,
		};

		const task = store.createTask(input);
		console.log(chalk.green(`✓ Task created: ${task.id}`));
		console.log(chalk.dim(`  Name: ${task.name}`));
		if (task.schedule) {
			console.log(chalk.dim(`  Schedule: ${formatSchedule(task.schedule)}`));
		}
		if (task.profile) {
			console.log(chalk.dim(`  Profile: ${task.profile}`));
		}
		if (task.policyMode) {
			console.log(chalk.dim(`  Policy: ${task.policyMode}`));
		}
		if (task.elevated) {
			console.log(chalk.dim("  Privilege: elevated (sudo)"));
			const { checkPrivilegeLevel } = await import("../systemd/sudoers.ts");
			const priv = checkPrivilegeLevel();
			if (priv.level === "unprivileged") {
				console.log(
					chalk.yellow(
						"  ⚠️  Warning: Current user does not have passwordless sudo. This task may fail in background.",
					),
				);
				console.log(
					chalk.dim('      To configure sudo: "forge task sudoers show" (or "sudo forge task sudoers install")'),
				);
			}
		}
		console.log(chalk.dim(`  Enabled: ${task.enabled}`));
		if (task.schedule && task.enabled) {
			const { isDaemonRunning } = await import("../systemd/installer.ts");
			const daemonStatus = isDaemonRunning();
			if (!daemonStatus.running) {
				console.log();
				console.log(chalk.yellow("⚠️  Note: Background scheduler daemon (forge-taskd) is not currently running."));
				console.log(chalk.dim('  To start it now: "forge task service start" (or "forge task daemon")'));
			} else {
				console.log(chalk.green(`  Scheduler: Active (${daemonStatus.details})`));
			}
		}
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

		const nameColWidth = Math.max(24, ...tasks.map((t) => t.name.length));
		const schedColWidth = Math.max(14, ...tasks.map((t) => (t.schedule ? formatSchedule(t.schedule).length : 6)));

		// Print table header
		const header = [
			padRight("ID", 10),
			padRight("NAME", nameColWidth),
			padRight("STATUS", 10),
			padRight("SCHEDULE", schedColWidth),
			padRight("LAST RUN", 20),
		].join("  ");
		console.log(chalk.bold(header));
		console.log(chalk.dim("─".repeat(header.length)));

		for (const task of tasks) {
			const statusColor = task.enabled ? chalk.green : chalk.yellow;
			const row = [
				padRight(task.id.slice(0, 8), 10),
				padRight(task.name, nameColWidth),
				statusColor(padRight(task.enabled ? "enabled" : "disabled", 10)),
				padRight(task.schedule ? formatSchedule(task.schedule) : "manual", schedColWidth),
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
		if (task.notifications?.email) console.log(`  Notify Email: ${task.notifications.email.to.join(", ")}`);
		if (task.notifications?.webhook) console.log(`  Notify Hook:  ${task.notifications.webhook.url}`);
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
		console.log(`  Schedule:   ${task.schedule ? formatSchedule(task.schedule) : "manual"}`);
		console.log(`  Next Run:   ${task.nextRunAt ? chalk.cyan(task.nextRunAt) : chalk.dim("none")}`);
		console.log(`  Last Run:   ${task.lastRunAt ? chalk.cyan(task.lastRunAt) : chalk.dim("never")}`);
		console.log(`  Privilege:  ${task.elevated ? chalk.red("elevated (sudo)") : chalk.green("standard")}`);
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

async function handleDoctor(): Promise<void> {
	const store = new TaskStore(getDefaultTaskDbPath());
	try {
		console.log(chalk.bold("forge task doctor"));
		console.log();

		// 1. Check Privilege Level
		const { checkPrivilegeLevel } = await import("../systemd/sudoers.ts");
		const priv = checkPrivilegeLevel();
		console.log(chalk.bold("Privilege Status:"));
		console.log(`  User:                 ${chalk.cyan(priv.username)}`);
		console.log(`  Root (UID 0):         ${priv.isRoot ? chalk.green("YES") : chalk.yellow("NO")}`);
		console.log(
			`  Passwordless Sudo:    ${priv.hasPasswordlessSudo ? chalk.green("ENABLED") : chalk.red("DISABLED")}`,
		);
		console.log(`  Operational Level:    ${chalk.magenta(priv.level.toUpperCase())}`);
		console.log();

		// 2. Check Daemon Status
		const { isDaemonRunning } = await import("../systemd/installer.ts");
		const daemon = isDaemonRunning();
		console.log(chalk.bold("Scheduler Daemon:"));
		if (daemon.running) {
			console.log(chalk.green(`  Status:               ACTIVE (${daemon.details})`));
		} else {
			console.log(chalk.yellow("  Status:               INACTIVE (not running)"));
			console.log(chalk.dim('  To start:             "forge task service start" (or "forge task daemon")'));
		}
		console.log();

		// 3. Check for stale leases
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

		// 4. Check task stats & elevated tasks
		const tasks = store.listTasks();
		const enabled = tasks.filter((t) => t.enabled).length;
		const disabled = tasks.filter((t) => !t.enabled).length;
		const elevatedCount = tasks.filter((t) => t.elevated).length;
		console.log(
			`\nTasks: ${tasks.length} total (${enabled} enabled, ${disabled} disabled, ${elevatedCount} elevated)`,
		);

		if (elevatedCount > 0 && priv.level === "unprivileged") {
			console.log(
				chalk.yellow(
					`\n⚠️  Warning: ${elevatedCount} task(s) require elevated privileges, but passwordless sudo is not configured.`,
				),
			);
			console.log(chalk.dim('  Run "sudo forge task sudoers install" to enable required permissions.'));
		}
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
	const { installService, uninstallService, startDaemonService, stopDaemonService, getServiceStatus, isRootUser } =
		await import("../systemd/installer.ts");

	if (action === "install") {
		const res = installService();
		const modeStr = isRootUser() ? "system service" : "user service";
		console.log(chalk.green(`✓ Installed systemd ${modeStr} unit: ${res.unitPath}`));
		console.log(chalk.dim('To enable and start: "forge task service start"'));
	} else if (action === "uninstall") {
		const removed = uninstallService();
		if (removed) {
			console.log(chalk.green("✓ Uninstalled forge-taskd.service."));
		} else {
			console.log(chalk.yellow("No installed service unit found."));
		}
	} else if (action === "start") {
		const res = startDaemonService();
		if (res.started) {
			console.log(
				chalk.green(`✓ Started forge-taskd (${res.mode === "systemd" ? "systemd service" : `PID ${res.pid}`}).`),
			);
		} else {
			console.error(chalk.red(`Failed to start daemon: ${res.error}`));
			process.exitCode = 1;
		}
	} else if (action === "stop") {
		stopDaemonService();
		console.log(chalk.yellow("✓ Stopped forge-taskd daemon and service."));
	} else if (action === "restart") {
		stopDaemonService();
		const res = startDaemonService();
		if (res.started) {
			console.log(
				chalk.green(`✓ Restarted forge-taskd (${res.mode === "systemd" ? "systemd service" : `PID ${res.pid}`}).`),
			);
		} else {
			console.error(chalk.red(`Failed to restart daemon: ${res.error}`));
			process.exitCode = 1;
		}
	} else if (action === "status") {
		const status = getServiceStatus();
		console.log(status);
	} else {
		console.error(
			chalk.red(`Unknown service action: ${action}. Use: install, uninstall, start, stop, restart, status`),
		);
	}
}

// ================================================================
// Helpers
// ================================================================

function resolveTask(store: TaskStore, ref: string): ReturnType<TaskStore["getTask"]> {
	return store.resolveTask(ref);
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
	if (str.length >= len) return str;
	return str + " ".repeat(len - str.length);
}

function printTaskHelp(): void {
	console.log(`${chalk.bold("forge task")} — Manage persistent autonomous tasks

${chalk.bold("Usage:")}
  forge task <command> [options]

${chalk.bold("Commands:")}
  create "<goal>"           Create a new persistent task
  wizard                    Launch interactive task creation wizard
  template [list|show]      Manage curated task templates
  sudoers [show|install]    Configure & verify sudoers privilege rules
  explain <schedule|task>   Explain cron/interval schedule & timeline
  test <task|goal>          Safe dry-run task simulation
  audit <task|run-id>       Forensic audit trail, tool traces & export
  list                      List all tasks
  show <task>               Show task details
  status <task>             Show task status with recent runs
  runs <task>               List execution history
  logs <task>               Show event log
  run <task>                Manually trigger a task execution
  pause <task>              Disable a task
  resume <task>             Re-enable a task
  cancel <task>             Cancel a task and release its lease
  doctor                    Diagnose issues (privileges, daemon, stale leases)
  cleanup [--days N]        Remove old completed runs (default: 30 days)
  daemon                    Run task scheduler in foreground
  service <action>          Manage systemd user service (install, start, stop, status, uninstall)

${chalk.bold("Task references:")}
  Tasks can be referenced by name, full UUID, or UUID prefix.

${chalk.bold("Examples:")}
  forge task wizard
  forge task template list
  forge task create --template nginx-error-monitor
  forge task explain "*/15 * * * *"
  forge task test "Check memory usage"
  forge task audit nginx-monitor
  forge task audit export nginx-monitor --format md
  forge task create --name nginx-monitor --every 30s "Monitor nginx error log"
  forge task create --name db-vacuum --cron "0 2 * * *" "Vacuum database"
  forge task list
  forge task status nginx-monitor
  forge task doctor`);
}
