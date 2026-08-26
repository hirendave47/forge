/**
 * System Health Snapshot Processor (§10).
 *
 * Deterministically collects key Linux operating metrics (memory, load, top processes, disk)
 * without requiring the LLM to waste tool calls running basic inspection commands.
 */

import { execSync } from "node:child_process";
import { freemem, loadavg, totalmem } from "node:os";
import type { Processor, ProcessorContext, ProcessorResult } from "./types.ts";

export interface SystemHealthOutput {
	memory: {
		totalMb: number;
		freeMb: number;
		usedMb: number;
		usedPercent: number;
	};
	loadAverage: [number, number, number];
	topProcesses: Array<{
		pid: string;
		user: string;
		cpuPercent: string;
		memPercent: string;
		command: string;
	}>;
	diskUsage: string[];
}

export class SystemHealthProcessor implements Processor<void, SystemHealthOutput> {
	readonly name = "system-health";
	readonly description = "Captures memory usage, load average, top consuming processes, and disk utilization";

	process(_input: undefined, _context: ProcessorContext): ProcessorResult<SystemHealthOutput> {
		const totalBytes = totalmem();
		const freeBytes = freemem();
		const usedBytes = totalBytes - freeBytes;

		const totalMb = Math.round(totalBytes / (1024 * 1024));
		const freeMb = Math.round(freeBytes / (1024 * 1024));
		const usedMb = Math.round(usedBytes / (1024 * 1024));
		const usedPercent = Math.round((usedBytes / totalBytes) * 100);

		const loads = loadavg() as [number, number, number];

		// Collect top 5 consuming processes via ps
		const topProcesses: SystemHealthOutput["topProcesses"] = [];
		try {
			const psOutput = execSync("ps -eo pid,user,%cpu,%mem,comm --sort=-%mem | head -n 6", {
				encoding: "utf-8",
				timeout: 2000,
			});
			const lines = psOutput.trim().split("\n").slice(1);
			for (const line of lines) {
				const [pid, user, cpu, mem, ...cmd] = line.trim().split(/\s+/);
				if (pid) {
					topProcesses.push({
						pid,
						user: user || "unknown",
						cpuPercent: cpu || "0",
						memPercent: mem || "0",
						command: cmd.join(" "),
					});
				}
			}
		} catch {
			// Fallback if ps command unavailable
		}

		// Collect disk usage via df
		const diskUsage: string[] = [];
		try {
			const dfOutput = execSync("df -h -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | head -n 5", {
				encoding: "utf-8",
				timeout: 2000,
			});
			diskUsage.push(...dfOutput.trim().split("\n"));
		} catch {
			// Fallback
		}

		const data: SystemHealthOutput = {
			memory: { totalMb, freeMb, usedMb, usedPercent },
			loadAverage: loads,
			topProcesses,
			diskUsage,
		};

		const promptContribution = formatSystemHealthPrompt(data);

		return {
			data,
			promptContribution,
		};
	}
}

function formatSystemHealthPrompt(health: SystemHealthOutput): string {
	const parts: string[] = [
		`### Current System Health Snapshot`,
		`- **Memory**: ${health.memory.usedMb}MB used / ${health.memory.totalMb}MB total (${health.memory.usedPercent}% utilized)`,
		`- **Load Average (1m, 5m, 15m)**: ${health.loadAverage.map((l) => l.toFixed(2)).join(", ")}`,
	];

	if (health.topProcesses.length > 0) {
		parts.push(`- **Top Memory Processes**:`);
		for (const p of health.topProcesses.slice(0, 5)) {
			parts.push(`  - PID ${p.pid} (${p.user}): ${p.memPercent}% MEM, ${p.cpuPercent}% CPU — \`${p.command}\``);
		}
	}

	if (health.diskUsage.length > 1) {
		parts.push(`- **Disk Partitions**:`);
		parts.push("```text");
		parts.push(health.diskUsage.join("\n"));
		parts.push("```");
	}

	parts.push("");
	return parts.join("\n");
}
