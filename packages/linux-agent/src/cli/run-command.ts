/**
 * CLI handler for `forge run "<goal>"`.
 *
 * One-shot execution: parse goal, create ephemeral run, execute agent, print result, exit.
 * Uses the TaskRuntime.executeOneShot() which invokes createAgentSession() directly.
 */

import { renderTerminalMarkdown } from "@earendil-works/forge-coding-agent";
import chalk from "chalk";
import { getExitCode, type ProgressEvent, TaskRuntime } from "../runtime/task-runtime.ts";

export async function handleRunCommand(args: string[]): Promise<void> {
	// Parse arguments
	let goal: string | undefined;
	let profile: string | undefined;
	let timeoutSeconds: number | undefined;
	let pretty: boolean | undefined;
	const tools: string[] = [];
	const excludeTools: string[] = [];
	const appendSystemPrompt: string[] = [];
	let showHelp = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			showHelp = true;
		} else if (arg === "--pretty") {
			pretty = true;
		} else if (arg === "--plain" || arg === "--no-pretty") {
			pretty = false;
		} else if (arg === "--profile" && i + 1 < args.length) {
			profile = args[++i];
		} else if (arg === "--timeout" && i + 1 < args.length) {
			timeoutSeconds = Number.parseInt(args[++i], 10);
		} else if ((arg === "--tools" || arg === "-t") && i + 1 < args.length) {
			tools.push(
				...args[++i]
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		} else if ((arg === "--exclude-tools" || arg === "-xt") && i + 1 < args.length) {
			excludeTools.push(
				...args[++i]
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0),
			);
		} else if (arg === "--append-system-prompt" && i + 1 < args.length) {
			appendSystemPrompt.push(args[++i]);
		} else if (!arg.startsWith("-")) {
			goal = arg;
		}
	}

	if (showHelp) {
		printRunHelp();
		return;
	}

	if (!goal) {
		console.error(chalk.red("Error: No goal specified."));
		console.error(chalk.dim('Usage: forge run "<goal>" [--profile NAME] [--timeout SECONDS] [--pretty]'));
		process.exitCode = 3;
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
		const result = await runtime.executeOneShot(goal, {
			profile,
			tools: tools.length > 0 ? tools : undefined,
			excludeTools: excludeTools.length > 0 ? excludeTools : undefined,
			timeoutSeconds,
			appendSystemPrompt: appendSystemPrompt.length > 0 ? appendSystemPrompt : undefined,
		});

		if (result.resultSummary) {
			const shouldPretty = pretty ?? Boolean(process.stdout.isTTY);
			if (shouldPretty) {
				const rendered = renderTerminalMarkdown(result.resultSummary);
				process.stdout.write(`${rendered}\n`);
			} else {
				process.stdout.write(`${result.resultSummary}\n`);
			}
		}

		if (result.error) {
			console.error(chalk.red(`Error: ${result.error}`));
		}

		process.exitCode = getExitCode(result.status);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Runtime error: ${message}`));
		process.exitCode = 5;
	} finally {
		runtime.close();
	}
}

function printRunHelp(): void {
	console.log(`${chalk.bold("forge run")} — Execute a one-shot autonomous task

${chalk.bold("Usage:")}
  forge run "<goal>" [options]

${chalk.bold("Options:")}
  --profile <name>          Agent profile: sysadmin, devops, sre, software-engineer, security
  --timeout <seconds>       Execution timeout (default: 120)
  --pretty                  Format output with terminal markdown styling (default when running in TTY)
  --plain, --no-pretty      Output raw markdown without styling
  --tools, -t <tools>       Comma-separated allowlist of tool names
  --exclude-tools, -xt      Comma-separated denylist of tool names
  --append-system-prompt    Additional system prompt text
  --help, -h                Show this help

${chalk.bold("Examples:")}
  forge run "Investigate system memory usage, identify top 5 processes"
  forge run --pretty "Check disk usage across all mountpoints"
  forge run --plain "List active docker containers"
  forge run --profile sysadmin "Why is nginx returning HTTP 502?"
  forge run --timeout 300 "Audit /etc/ssh/sshd_config for security issues"

${chalk.bold("Exit Codes:")}
  0  Success
  1  Agent/task failure
  2  Policy rejection
  3  Invalid task
  4  Timeout
  5  Infrastructure/runtime failure`);
}
