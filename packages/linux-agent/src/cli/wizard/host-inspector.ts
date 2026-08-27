/**
 * Host Environment Inspector for Forge CLI Wizard.
 *
 * Non-destructive discovery of host operating system details, active systemd
 * services, disk mount usage, accessible log files, and listening ports.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { release, type } from "node:os";
import { join } from "node:path";

export interface DiskUsageInfo {
	filesystem: string;
	mountPoint: string;
	total: string;
	used: string;
	available: string;
	usePercentage: number;
}

export interface HostInfo {
	osName: string;
	osVersion: string;
	kernel: string;
	activeServices: string[];
	highUsageDisks: DiskUsageInfo[];
	discoveredLogFiles: string[];
	listeningPorts: number[];
}

/**
 * Perform non-destructive inspection of local host environment.
 */
export function inspectHost(options: { timeoutMs?: number } = {}): HostInfo {
	const timeout = options.timeoutMs ?? 1500;

	return {
		...getOsInfo(),
		activeServices: getActiveServices(timeout),
		highUsageDisks: getDiskUsage(timeout),
		discoveredLogFiles: getDiscoveredLogs(),
		listeningPorts: getListeningPorts(timeout),
	};
}

/**
 * Formats HostInfo into a concise summary string for LLM prompting or CLI display.
 */
export function formatHostSummary(info: HostInfo): string {
	const lines: string[] = [];
	lines.push(`OS: ${info.osName} ${info.osVersion} (Kernel: ${info.kernel})`);

	if (info.activeServices.length > 0) {
		lines.push(`Active Services: ${info.activeServices.slice(0, 8).join(", ")}`);
	}

	if (info.highUsageDisks.length > 0) {
		const diskSummary = info.highUsageDisks
			.map((d) => `${d.mountPoint} (${d.usePercentage}% used, ${d.available} free)`)
			.join(", ");
		lines.push(`Disk Usage: ${diskSummary}`);
	}

	if (info.discoveredLogFiles.length > 0) {
		lines.push(`Prominent Logs: ${info.discoveredLogFiles.slice(0, 6).join(", ")}`);
	}

	if (info.listeningPorts.length > 0) {
		lines.push(`Listening TCP Ports: ${info.listeningPorts.slice(0, 10).join(", ")}`);
	}

	return lines.join("\n");
}

function getOsInfo(): { osName: string; osVersion: string; kernel: string } {
	let osName = type();
	let osVersion = "";
	const kernel = release();

	try {
		if (existsSync("/etc/os-release")) {
			const content = readFileSync("/etc/os-release", "utf-8");
			for (const line of content.split("\n")) {
				if (line.startsWith("NAME=")) {
					osName = line.replace(/^NAME=["']?/, "").replace(/["']?$/, "");
				} else if (line.startsWith("VERSION_ID=")) {
					osVersion = line.replace(/^VERSION_ID=["']?/, "").replace(/["']?$/, "");
				} else if (line.startsWith("PRETTY_NAME=") && !osName) {
					osName = line.replace(/^PRETTY_NAME=["']?/, "").replace(/["']?$/, "");
				}
			}
		}
	} catch {
		// Fallback to os module values
	}

	return { osName, osVersion, kernel };
}

function getActiveServices(timeout: number): string[] {
	try {
		const stdout = execSync("systemctl list-units --type=service --state=running --no-legend --no-pager", {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});

		const services: string[] = [];
		for (const line of stdout.split("\n")) {
			const match = line.trim().match(/^([a-zA-Z0-9@_-]+)\.service/);
			if (match) {
				const serviceName = match[1];
				// Filter out internal systemd units
				if (!serviceName.startsWith("systemd-") && !serviceName.startsWith("user@")) {
					services.push(serviceName);
				}
			}
		}
		return services;
	} catch {
		return [];
	}
}

function getDiskUsage(timeout: number): DiskUsageInfo[] {
	try {
		const stdout = execSync("df -Pkh", {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});

		const results: DiskUsageInfo[] = [];
		const lines = stdout.split("\n");

		for (let i = 1; i < lines.length; i++) {
			const parts = lines[i].trim().split(/\s+/);
			if (parts.length >= 6) {
				const filesystem = parts[0];
				const total = parts[1];
				const used = parts[2];
				const available = parts[3];
				const capacityStr = parts[4].replace("%", "");
				const mountPoint = parts[5];
				const usePercentage = Number.parseInt(capacityStr, 10);

				if (!Number.isNaN(usePercentage)) {
					// Include root mount '/' or any filesystem >= 70% full
					if (mountPoint === "/" || usePercentage >= 70) {
						results.push({
							filesystem,
							mountPoint,
							total,
							used,
							available,
							usePercentage,
						});
					}
				}
			}
		}
		return results;
	} catch {
		return [];
	}
}

function getDiscoveredLogs(): string[] {
	const foundLogs: string[] = [];
	const commonPaths = [
		"/var/log/syslog",
		"/var/log/messages",
		"/var/log/auth.log",
		"/var/log/secure",
		"/var/log/dmesg",
		"/var/log/journal",
		"/var/log/nginx/error.log",
		"/var/log/nginx/access.log",
		"/var/log/apache2/error.log",
		"/var/log/httpd/error_log",
		"/var/log/mysql/error.log",
		"/var/log/postgresql/postgresql.log",
		"/var/log/redis/redis-server.log",
	];

	for (const p of commonPaths) {
		try {
			if (existsSync(p)) {
				foundLogs.push(p);
			}
		} catch {
			// Permission or filesystem error
		}
	}

	// Also discover subdirectories in /var/log
	try {
		if (existsSync("/var/log")) {
			const entries = readdirSync("/var/log");
			for (const entry of entries) {
				const full = join("/var/log", entry);
				if (entry.endsWith(".log") && !foundLogs.includes(full)) {
					try {
						const st = statSync(full);
						if (st.isFile()) {
							foundLogs.push(full);
						}
					} catch {
						// Ignore unreadable
					}
				}
			}
		}
	} catch {
		// Ignore /var/log readdir errors
	}

	return foundLogs.slice(0, 10);
}

function getListeningPorts(timeout: number): number[] {
	try {
		const stdout = execSync("ss -tln", {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});

		const ports = new Set<number>();
		for (const line of stdout.split("\n")) {
			const match = line.match(/:(\d+)\s+/);
			if (match) {
				const port = Number.parseInt(match[1], 10);
				if (!Number.isNaN(port) && port > 0 && port <= 65535) {
					ports.add(port);
				}
			}
		}
		return Array.from(ports).sort((a, b) => a - b);
	} catch {
		return [];
	}
}
