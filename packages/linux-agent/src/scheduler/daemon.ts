/**
 * Daemon runner for the Forge Linux Agent task scheduler.
 *
 * Runs as a long-running service (supervised by systemd or run in foreground).
 * Handles UNIX signals (SIGTERM, SIGINT, SIGHUP) for graceful shutdown.
 */

import chalk from "chalk";
import { TaskScheduler, type TaskSchedulerOptions } from "./scheduler.ts";

export async function startDaemon(options: TaskSchedulerOptions = {}): Promise<void> {
	console.log(chalk.bold("══════════════════════════════════════════════════════════════"));
	console.log(chalk.bold("        Forge Autonomous Task Scheduler Daemon (forge-taskd)  "));
	console.log(chalk.bold("══════════════════════════════════════════════════════════════"));

	const scheduler = new TaskScheduler(options);

	let shuttingDown = false;
	const shutdown = async (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(chalk.yellow(`\nReceived ${signal}. Gracefully stopping scheduler...`));
		try {
			await scheduler.stop(10000);
			console.log(chalk.green("✓ Scheduler stopped cleanly."));
			process.exit(0);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(chalk.red(`Error during shutdown: ${msg}`));
			process.exit(1);
		}
	};

	process.on("SIGTERM", () => shutdown("SIGTERM"));
	process.on("SIGINT", () => shutdown("SIGINT"));
	if (process.platform !== "win32") {
		process.on("SIGHUP", () => shutdown("SIGHUP"));
	}

	await scheduler.start();

	// Keep event loop alive
	await new Promise<void>(() => {});
}
