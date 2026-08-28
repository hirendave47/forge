/**
 * Progressive Host Discovery Planner and Safe Inspector.
 *
 * Executes non-destructive inspection requests emitted by the AI Task Architect
 * during the conversational design loop.
 */

import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DiscoveryRequest, DiscoveryResult } from "./schemas.ts";

/**
 * Executes a list of safe discovery requests.
 */
export function executeDiscoveryRequests(
	requests: DiscoveryRequest[],
	options: { timeoutMs?: number } = {},
): DiscoveryResult[] {
	const results: DiscoveryResult[] = [];
	for (const req of requests) {
		results.push(executeDiscoveryRequest(req, options));
	}
	return results;
}

/**
 * Executes a single discovery check safely with guardrails.
 */
export function executeDiscoveryRequest(req: DiscoveryRequest, options: { timeoutMs?: number } = {}): DiscoveryResult {
	const timeout = options.timeoutMs ?? 1500;
	const target = req.target?.trim();

	try {
		switch (req.checkType) {
			case "service":
				return inspectService(target, timeout, req);
			case "port":
				return inspectPort(target, timeout, req);
			case "log":
				return inspectLog(target, timeout, req);
			case "disk":
				return inspectDisk(target, timeout, req);
			case "process":
				return inspectProcess(target, timeout, req);
			case "command":
				return inspectCommand(target, timeout, req);
			default:
				return {
					check: req,
					found: false,
					summary: `Unknown discovery check type: ${req.checkType}`,
				};
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			check: req,
			found: false,
			summary: `Inspection failed safely: ${message}`,
		};
	}
}

// ============================================================
// Internal Safe Inspectors
// ============================================================

function sanitizeTarget(target?: string): string {
	if (!target) return "";
	// Strip shell metacharacters for safety
	return target.replace(/[;&|`$(){}<>\\]/g, "").trim();
}

function inspectService(target: string | undefined, timeout: number, req: DiscoveryRequest): DiscoveryResult {
	const cleanTarget = sanitizeTarget(target);
	if (!cleanTarget) {
		return {
			check: req,
			found: false,
			summary: "No service target provided",
		};
	}

	const unitName = cleanTarget.endsWith(".service") ? cleanTarget : `${cleanTarget}.service`;
	try {
		const stdout = execSync(`systemctl is-active "${unitName}"`, {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const _isActive = stdout === "active";
		return {
			check: req,
			found: true,
			summary: `Service ${unitName} is ${stdout}`,
			details: { unit: unitName, state: stdout },
		};
	} catch {
		// systemctl is-active exits with non-zero if inactive/failed/not-found
		try {
			const status = execSync(`systemctl list-unit-files "${unitName}" --no-legend --no-pager`, {
				timeout,
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();

			if (status.length > 0) {
				return {
					check: req,
					found: true,
					summary: `Service ${unitName} is installed (${status.split(/\s+/)[1] ?? "inactive"})`,
					details: { unit: unitName, unitFileState: status },
				};
			}
		} catch {
			// fallback
		}

		return {
			check: req,
			found: false,
			summary: `Service ${unitName} not found or inactive`,
		};
	}
}

function inspectPort(target: string | undefined, timeout: number, req: DiscoveryRequest): DiscoveryResult {
	const cleanTarget = sanitizeTarget(target);
	const portNum = cleanTarget ? Number.parseInt(cleanTarget, 10) : undefined;

	try {
		const stdout = execSync("ss -tlpn", {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});

		if (portNum && !Number.isNaN(portNum)) {
			const regex = new RegExp(`:${portNum}\\b`);
			const matchingLine = stdout.split("\n").find((l) => regex.test(l));
			if (matchingLine) {
				return {
					check: req,
					found: true,
					summary: `Port ${portNum} is listening (${matchingLine.trim().slice(0, 80)})`,
					details: { port: portNum, line: matchingLine.trim() },
				};
			}
			return {
				check: req,
				found: false,
				summary: `Port ${portNum} is not listening`,
			};
		}

		return {
			check: req,
			found: true,
			summary: `Found ${stdout.split("\n").length - 1} listening sockets`,
		};
	} catch {
		return {
			check: req,
			found: false,
			summary: "Could not inspect network sockets",
		};
	}
}

function inspectLog(target: string | undefined, _timeout: number, req: DiscoveryRequest): DiscoveryResult {
	const cleanTarget = sanitizeTarget(target);
	if (!cleanTarget) {
		return {
			check: req,
			found: false,
			summary: "No log target provided",
		};
	}

	try {
		if (existsSync(cleanTarget)) {
			const st = statSync(cleanTarget);
			const sizeKb = Math.round(st.size / 1024);
			return {
				check: req,
				found: true,
				summary: `Log file exists: ${cleanTarget} (${sizeKb} KB, modified: ${st.mtime.toLocaleTimeString()})`,
				details: { path: cleanTarget, sizeKb, mtime: st.mtime },
			};
		}

		// Try globbing under /var/log/
		if (!cleanTarget.startsWith("/")) {
			const candidate = join("/var/log", cleanTarget);
			if (existsSync(candidate)) {
				const st = statSync(candidate);
				return {
					check: req,
					found: true,
					summary: `Found log file: ${candidate} (${Math.round(st.size / 1024)} KB)`,
					details: { path: candidate },
				};
			}
		}

		return {
			check: req,
			found: false,
			summary: `Log file ${cleanTarget} does not exist`,
		};
	} catch (_err: unknown) {
		return {
			check: req,
			found: false,
			summary: `Could not access log ${cleanTarget}`,
		};
	}
}

function inspectDisk(target: string | undefined, timeout: number, req: DiscoveryRequest): DiscoveryResult {
	const cleanTarget = sanitizeTarget(target) || "/";

	try {
		const stdout = execSync(`df -Pkh "${cleanTarget}"`, {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});

		const lines = stdout.trim().split("\n");
		if (lines.length >= 2) {
			const parts = lines[1].trim().split(/\s+/);
			return {
				check: req,
				found: true,
				summary: `Mount ${parts[5] ?? cleanTarget}: ${parts[4]} used (${parts[3]} free of ${parts[1]})`,
				details: { mount: parts[5], usedPct: parts[4], free: parts[3], total: parts[1] },
			};
		}
	} catch {
		// ignore
	}

	return {
		check: req,
		found: false,
		summary: `Mountpoint ${cleanTarget} not found`,
	};
}

function inspectProcess(target: string | undefined, timeout: number, req: DiscoveryRequest): DiscoveryResult {
	const cleanTarget = sanitizeTarget(target);
	if (!cleanTarget) {
		return {
			check: req,
			found: false,
			summary: "No process target provided",
		};
	}

	try {
		const stdout = execSync(`pgrep -l -f "${cleanTarget}"`, {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		const lines = stdout ? stdout.split("\n") : [];
		if (lines.length > 0) {
			return {
				check: req,
				found: true,
				summary: `Found ${lines.length} matching process(es): ${lines.slice(0, 3).join(", ")}`,
				details: { count: lines.length, processes: lines.slice(0, 5) },
			};
		}

		return {
			check: req,
			found: false,
			summary: `No processes matching '${cleanTarget}' are running`,
		};
	} catch {
		return {
			check: req,
			found: false,
			summary: `No processes matching '${cleanTarget}' are running`,
		};
	}
}

function inspectCommand(target: string | undefined, timeout: number, req: DiscoveryRequest): DiscoveryResult {
	const cleanTarget = sanitizeTarget(target);
	if (!cleanTarget) {
		return {
			check: req,
			found: false,
			summary: "No command target provided",
		};
	}

	try {
		const stdout = execSync(`which "${cleanTarget}"`, {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		if (stdout.length > 0) {
			return {
				check: req,
				found: true,
				summary: `Command '${cleanTarget}' is installed at ${stdout}`,
				details: { path: stdout },
			};
		}
	} catch {
		// not found
	}

	return {
		check: req,
		found: false,
		summary: `Command '${cleanTarget}' is not installed in PATH`,
	};
}
