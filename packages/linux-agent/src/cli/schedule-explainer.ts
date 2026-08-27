/**
 * Schedule Explainer & Timeline Visualizer for Forge CLI.
 *
 * Converts cron and interval expressions into natural English and
 * visualizes the upcoming execution timeline with humanized countdowns.
 */

import chalk from "chalk";
import { parseIntervalString, type TaskSchedule } from "../runtime/task-model.ts";
import { computeNextCronRun } from "../scheduler/cron.ts";
import { getDefaultTaskDbPath, TaskStore } from "../store/task-store.ts";

export interface TimelineEntry {
	index: number;
	date: Date;
	localTime: string;
	utcTime: string;
	countdown: string;
}

/**
 * Translates a TaskSchedule into human-readable plain English.
 */
export function explainSchedule(schedule: TaskSchedule): string {
	if (schedule.type === "interval") {
		const s = schedule.seconds;
		if (s < 60) return `Every ${s} second${s === 1 ? "" : "s"}`;
		if (s % 3600 === 0) {
			const h = s / 3600;
			return `Every ${h} hour${h === 1 ? "" : "s"}`;
		}
		if (s % 60 === 0) {
			const m = s / 60;
			return `Every ${m} minute${m === 1 ? "" : "s"}`;
		}
		return `Every ${s} seconds (${Math.floor(s / 60)}m ${s % 60}s)`;
	}

	if (schedule.type === "once") {
		const d = new Date(schedule.at);
		return `One-time execution scheduled for ${d.toUTCString()}`;
	}

	if (schedule.type === "cron") {
		return explainCronExpression(schedule.expression);
	}

	return "Manual trigger only (on-demand via CLI)";
}

/**
 * Calculates the next N scheduled trigger timestamps.
 */
export function calculateTimeline(schedule: TaskSchedule, count = 5, fromDate: Date = new Date()): TimelineEntry[] {
	const entries: TimelineEntry[] = [];
	let current = fromDate;

	for (let i = 1; i <= count; i++) {
		let nextDate: Date | null = null;

		if (schedule.type === "interval") {
			nextDate = new Date(current.getTime() + schedule.seconds * 1000);
		} else if (schedule.type === "cron") {
			nextDate = computeNextCronRun(schedule.expression, current);
		} else if (schedule.type === "once") {
			if (i === 1) {
				nextDate = new Date(schedule.at);
			} else {
				break;
			}
		}

		if (!nextDate) break;

		entries.push({
			index: i,
			date: nextDate,
			localTime: nextDate.toLocaleString(),
			utcTime: nextDate
				.toISOString()
				.replace("T", " ")
				.replace(/\.\d+Z$/, " UTC"),
			countdown: formatCountdown(nextDate.getTime() - fromDate.getTime()),
		});

		current = nextDate;
	}

	return entries;
}

/**
 * Formats a visual timeline table for terminal output.
 */
export function formatTimelineTable(schedule: TaskSchedule, count = 5): string {
	const explanation = explainSchedule(schedule);
	const timeline = calculateTimeline(schedule, count);

	const lines: string[] = [];
	lines.push(chalk.bold.cyan("┌────────────────────────────────────────────────────────┐"));
	lines.push(chalk.bold.cyan("│             FORGE SCHEDULE EXPLAINER                   │"));
	lines.push(chalk.bold.cyan("└────────────────────────────────────────────────────────┘"));
	lines.push();
	lines.push(`  ${chalk.bold("Schedule:")}    ${formatScheduleExpression(schedule)}`);
	lines.push(`  ${chalk.bold("Explanation:")} ${chalk.green(explanation)}`);
	lines.push();
	lines.push(chalk.bold("  Upcoming Execution Timeline:"));
	lines.push(chalk.dim("  #   Local Time                 UTC Time                 Countdown"));
	lines.push(chalk.dim("  ───────────────────────────────────────────────────────────────────"));

	for (const item of timeline) {
		const num = String(item.index).padEnd(3);
		const local = item.localTime.padEnd(26);
		const utc = item.utcTime.padEnd(24);
		const countdown = chalk.cyan(item.countdown);
		lines.push(`  ${num} ${local} ${utc} ${countdown}`);
	}

	return lines.join("\n");
}

/**
 * Subcommand handler for `forge task explain <schedule|task>`.
 */
export async function handleExplain(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		console.log(`${chalk.bold("forge task explain")} — Natural language schedule explainer & timeline

${chalk.bold("Usage:")}
  forge task explain "<schedule>"
  forge task explain <task-name-or-id>
  forge task explain --cron "*/15 * * * *"
  forge task explain --every 5m

${chalk.bold("Examples:")}
  forge task explain "*/10 * * * *"
  forge task explain "0 2 * * 1-5"
  forge task explain "every 30s"
  forge task explain "30s"
  forge task explain nginx-monitor`);
		return;
	}

	const rawInput = args[0];
	let schedule: TaskSchedule | undefined;

	// Check if flag was passed e.g. --cron "*/10 * * * *" or --every 5m
	if (rawInput === "--cron" && args[1]) {
		schedule = { type: "cron", expression: args[1] };
	} else if (rawInput === "--every" && args[1]) {
		schedule = { type: "interval", seconds: parseIntervalString(args[1]) };
	} else if (rawInput.startsWith("every ")) {
		schedule = { type: "interval", seconds: parseIntervalString(rawInput.slice(6)) };
	} else if (/^\d+[smhd]$/i.test(rawInput)) {
		schedule = { type: "interval", seconds: parseIntervalString(rawInput) };
	} else if (rawInput.split(/\s+/).length === 5) {
		// 5-part cron
		schedule = { type: "cron", expression: rawInput };
	} else {
		// Try resolving as task from SQLite store
		const store = new TaskStore(getDefaultTaskDbPath());
		try {
			const task = store.resolveTask(rawInput);
			if (task) {
				if (!task.schedule) {
					console.log(chalk.yellow(`Task "${task.name}" is configured for manual execution only.`));
					return;
				}
				schedule = task.schedule;
			}
		} finally {
			store.close();
		}
	}

	if (!schedule) {
		console.error(chalk.red(`Could not parse schedule expression or resolve task: "${rawInput}"`));
		console.error(chalk.dim("Provide a 5-part cron (e.g. '*/15 * * * *'), interval ('5m'), or existing task name."));
		process.exitCode = 1;
		return;
	}

	try {
		const output = formatTimelineTable(schedule, 5);
		console.log(output);
	} catch (err: any) {
		console.error(chalk.red(`Invalid schedule expression: ${err.message}`));
		process.exitCode = 1;
	}
}

function explainCronExpression(expr: string): string {
	const parts = expr.trim().split(/\s+/);
	if (parts.length !== 5) {
		return `Custom 5-part cron: "${expr}"`;
	}

	const [min, hr, dom, mon, dow] = parts;

	// Common patterns
	if (expr === "* * * * *") return "Every minute";
	if (min.startsWith("*/") && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
		return `Every ${min.slice(2)} minutes past the hour (UTC)`;
	}
	if (min === "0" && hr === "*" && dom === "*" && mon === "*" && dow === "*") {
		return "Every hour on the hour (UTC)";
	}
	if (min === "0" && hr.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
		return `Every ${hr.slice(2)} hours (UTC)`;
	}
	if (dom === "*" && mon === "*" && dow === "*") {
		return `Daily at ${padZero(hr)}:${padZero(min)} UTC`;
	}
	if (dom === "*" && mon === "*" && (dow === "1-5" || dow === "1,2,3,4,5")) {
		return `Every weekday (Monday through Friday) at ${padZero(hr)}:${padZero(min)} UTC`;
	}
	if (dom === "*" && mon === "*" && (dow === "0" || dow === "7")) {
		return `Every Sunday at ${padZero(hr)}:${padZero(min)} UTC`;
	}

	return `5-part cron expression (${expr}) evaluated in UTC`;
}

function padZero(str: string): string {
	return str.length === 1 ? `0${str}` : str;
}

function formatScheduleExpression(schedule: TaskSchedule): string {
	if (schedule.type === "interval") return `every ${schedule.seconds}s`;
	if (schedule.type === "cron") return schedule.expression;
	if (schedule.type === "once") return `once at ${schedule.at}`;
	return "manual";
}

function formatCountdown(diffMs: number): string {
	if (diffMs <= 0) return "now";
	const sec = Math.floor(diffMs / 1000);
	if (sec < 60) return `in ${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `in ${min}m`;
	const hr = Math.floor(min / 60);
	const remMin = min % 60;
	if (hr < 24) return remMin > 0 ? `in ${hr}h ${remMin}m` : `in ${hr}h`;
	const days = Math.floor(hr / 24);
	return `in ${days}d`;
}
