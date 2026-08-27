/**
 * Task Dry-Run Tester for Forge CLI.
 *
 * Runs a safe, non-mutating one-shot simulation of a task or goal
 * to verify tool execution, exit criteria, and token consumption
 * before activating or scheduling.
 */

import chalk from "chalk";
import { type ExecutionResult, TaskRuntime } from "../runtime/task-runtime.ts";
import { getDefaultTaskDbPath, TaskStore } from "../store/task-store.ts";

export interface TaskTesterOptions {
	timeoutSeconds?: number;
	debug?: boolean;
	dbPath?: string;
}

/**
 * Executes a safe dry-run test for a task or goal string.
 */
export async function testTask(target: string, options: TaskTesterOptions = {}): Promise<ExecutionResult> {
	const dbPath = options.dbPath ?? getDefaultTaskDbPath();
	const timeoutSeconds = options.timeoutSeconds ?? 60;

	let goal = target;
	let profile: string | undefined;
	let toolsAllow: string[] | undefined;
	let taskName = "ephemeral-test";

	// Check if target matches existing task in store
	const store = new TaskStore(dbPath);
	try {
		const existing = store.getTaskByName(target) ?? store.getTask(target);
		if (existing) {
			goal = existing.goal;
			profile = existing.profile;
			toolsAllow = existing.toolsAllow;
			taskName = existing.name;
		}
	} finally {
		store.close();
	}

	console.log();
	console.log(chalk.bold.cyan("┌────────────────────────────────────────────────────────┐"));
	console.log(chalk.bold.cyan("│             FORGE TASK DRY-RUN SIMULATION              │"));
	console.log(chalk.bold.cyan("│        Safe non-mutating diagnostic execution          │"));
	console.log(chalk.bold.cyan("└────────────────────────────────────────────────────────┘"));
	console.log();
	console.log(`  ${chalk.bold("Task:")}    ${chalk.green(taskName)}`);
	console.log(`  ${chalk.bold("Goal:")}    ${goal}`);
	console.log(`  ${chalk.bold("Profile:")} ${profile ?? "default"}`);
	console.log(`  ${chalk.bold("Policy:")}  ${chalk.yellow("safe (read-only mode)")}`);
	console.log();

	const runtime = new TaskRuntime({
		dbPath,
		onProgress: (event) => {
			const phaseTag = chalk.dim(`[${event.phase}]`);
			console.log(`  ${phaseTag} ${event.message}`);
		},
	});

	const result = await runtime.executeOneShot(goal, {
		profile,
		tools: toolsAllow ?? ["read", "grep", "wait_interval"],
		timeoutSeconds,
		debug: options.debug,
	});

	console.log();
	if (result.status === "SUCCEEDED") {
		console.log(chalk.green(`✓ Simulation SUCCEEDED in ${(result.durationMs / 1000).toFixed(2)}s`));
		console.log(
			chalk.dim(
				`  Tokens: ${result.inputTokens.toLocaleString()} in / ${result.outputTokens.toLocaleString()} out | Tool Calls: ${result.toolCalls}`,
			),
		);
		if (result.resultSummary) {
			console.log();
			console.log(chalk.bold("Output Summary:"));
			console.log(chalk.dim(result.resultSummary.slice(0, 500)));
		}
	} else {
		console.log(chalk.red(`✕ Simulation FAILED: ${result.error ?? "Unknown error"}`));
		process.exitCode = 1;
	}

	return result;
}

/**
 * CLI subcommand handler for `forge task test <task|goal>`.
 */
export async function handleTest(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		console.log(`${chalk.bold("forge task test")} — Safe dry-run task simulation

${chalk.bold("Usage:")}
  forge task test <task-name> [options]
  forge task test "<goal>" [options]

${chalk.bold("Options:")}
  --timeout <seconds>       Execution duration limit (default: 60)
  --debug                   Enable detailed diagnostic logs

${chalk.bold("Examples:")}
  forge task test nginx-monitor
  forge task test "Check system memory usage"
  forge task test "Inspect /var/log/syslog for errors" --timeout 30`);
		return;
	}

	let target: string | undefined;
	let timeoutSeconds = 60;
	let debug = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--timeout" && i + 1 < args.length) {
			const parsed = Number.parseInt(args[++i], 10);
			if (!Number.isNaN(parsed) && parsed > 0) {
				timeoutSeconds = parsed;
			}
		} else if (arg === "--debug") {
			debug = true;
		} else if (!arg.startsWith("-") && !target) {
			target = arg;
		}
	}

	if (!target) {
		console.error(chalk.red("Please specify a task name or goal string to test."));
		process.exitCode = 1;
		return;
	}

	await testTask(target, { timeoutSeconds, debug });
}
