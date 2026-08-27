/**
 * systemd & Background Daemon Management for Forge Linux Agent.
 *
 * Supports both root (/etc/systemd/system) and non-root (~/.config/systemd/user)
 * systemd service configurations with automated linger and detached process fallback.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DaemonStatus {
	running: boolean;
	mode: "systemd" | "process" | "none";
	pid?: number;
	details?: string;
}

export interface StartDaemonResult {
	started: boolean;
	mode: "systemd" | "process" | "none";
	pid?: number;
	error?: string;
}

/**
 * Returns true if running as root (UID 0).
 */
export function isRootUser(): boolean {
	return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * Returns the appropriate systemd unit directory based on root vs non-root privilege.
 */
export function getSystemdDir(): string {
	if (isRootUser()) {
		return "/etc/systemd/system";
	}
	return join(homedir(), ".config", "systemd", "user");
}

/**
 * Returns the path to forge-taskd.service unit file.
 */
export function getServiceUnitPath(): string {
	return join(getSystemdDir(), "forge-taskd.service");
}

/**
 * Returns the PID file path for detached daemon fallback.
 */
export function getDaemonPidPath(): string {
	return join(homedir(), ".forge", "agent", "forge-taskd.pid");
}

/**
 * Returns the log file path for detached daemon fallback.
 */
export function getDaemonLogPath(): string {
	return join(homedir(), ".forge", "agent", "forge-taskd.log");
}

/**
 * Generate systemd unit content for forge-taskd.service.
 */
export function generateServiceUnit(forgeBinPath?: string): string {
	const binPath = forgeBinPath || findForgeBinPath();
	const isRoot = isRootUser();
	const home = homedir();

	const agentDir = isRoot ? `${home}/.forge/agent` : "%h/.forge/agent";
	const userPath = isRoot
		? `${home}/.local/bin:/usr/local/bin:/usr/bin:/bin`
		: "%h/.local/bin:/usr/local/bin:/usr/bin:/bin";
	const target = isRoot ? "multi-user.target" : "default.target";

	return `[Unit]
Description=Forge Autonomous Task Scheduler Daemon (forge-taskd)
Documentation=https://github.com/hirendave47/forge
After=network.target

[Service]
Type=simple
ExecStart=${binPath} task daemon
Restart=always
RestartSec=5s
Environment=NODE_ENV=production
Environment=FORGE_CODING_AGENT_DIR=${agentDir}
Environment=PATH=${userPath}
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=${target}
`;
}

/**
 * Install the systemd service (root or user mode) and enable linger if applicable.
 */
export function installService(forgeBinPath?: string): { unitPath: string; installed: boolean } {
	const unitDir = getSystemdDir();
	if (!existsSync(unitDir)) {
		mkdirSync(unitDir, { recursive: true });
	}

	const unitPath = getServiceUnitPath();
	const unitContent = generateServiceUnit(forgeBinPath);
	writeFileSync(unitPath, unitContent, "utf-8");

	// Reload systemd daemon
	try {
		const reloadCmd = isRootUser() ? "systemctl daemon-reload" : "systemctl --user daemon-reload";
		execSync(reloadCmd, { stdio: "ignore" });
	} catch {
		// Ignore if systemd is not running in test/container environment
	}

	// Enable linger for non-root users if loginctl is available
	if (!isRootUser()) {
		try {
			const username = process.env.USER || process.env.LOGNAME;
			if (username) {
				execSync(`loginctl enable-linger ${username}`, { stdio: "ignore" });
			}
		} catch {
			// Best-effort
		}
	}

	return { unitPath, installed: true };
}

/**
 * Enable and start the systemd service.
 */
export function startService(): void {
	const startCmd = isRootUser()
		? "systemctl enable --now forge-taskd.service"
		: "systemctl --user enable --now forge-taskd.service";
	execSync(startCmd, { stdio: "pipe" });
}

/**
 * Stop the systemd service.
 */
export function stopService(): void {
	const stopCmd = isRootUser() ? "systemctl stop forge-taskd.service" : "systemctl --user stop forge-taskd.service";
	execSync(stopCmd, { stdio: "pipe" });
}

/**
 * Check if the background scheduler daemon is currently running.
 */
export function isDaemonRunning(): DaemonStatus {
	// 1. Check systemd service status
	try {
		const checkCmd = isRootUser()
			? "systemctl is-active forge-taskd.service"
			: "systemctl --user is-active forge-taskd.service";
		const output = execSync(checkCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		if (output === "active") {
			return { running: true, mode: "systemd", details: "active (systemd service)" };
		}
	} catch {
		// Service not active or systemd unavailable
	}

	// 2. Check fallback PID file
	const pidPath = getDaemonPidPath();
	if (existsSync(pidPath)) {
		try {
			const rawPid = readFileSync(pidPath, "utf-8").trim();
			const pid = Number.parseInt(rawPid, 10);
			if (!Number.isNaN(pid) && pid > 0) {
				// Signal 0 tests if process exists
				process.kill(pid, 0);
				return { running: true, mode: "process", pid, details: `running (PID ${pid})` };
			}
		} catch {
			// Process is not running; clean up stale PID file
			try {
				unlinkSync(pidPath);
			} catch {}
		}
	}

	return { running: false, mode: "none" };
}

/**
 * Start the daemon as a systemd service, or fallback to a detached background process.
 */
export function startDaemonService(forgeBinPath?: string): StartDaemonResult {
	// Check if already running
	const current = isDaemonRunning();
	if (current.running) {
		return { started: true, mode: current.mode, pid: current.pid };
	}

	// 1. Try systemd first
	try {
		installService(forgeBinPath);
		startService();
		const check = isDaemonRunning();
		if (check.running) {
			return { started: true, mode: "systemd" };
		}
	} catch {
		// Systemd failed or unavailable; fall back to detached background process
	}

	// 2. Fallback to detached process
	try {
		const agentDir = join(homedir(), ".forge", "agent");
		if (!existsSync(agentDir)) {
			mkdirSync(agentDir, { recursive: true });
		}

		const logPath = getDaemonLogPath();
		const pidPath = getDaemonPidPath();
		const logFd = openSync(logPath, "a");
		const bin = forgeBinPath || findForgeBinPath();

		const child = spawn(bin, ["task", "daemon"], {
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env: { ...process.env, NODE_ENV: "production" },
		});
		child.unref();

		if (child.pid) {
			writeFileSync(pidPath, String(child.pid), "utf-8");
			return { started: true, mode: "process", pid: child.pid };
		}
	} catch (err: any) {
		return { started: false, mode: "none", error: err.message };
	}

	return { started: false, mode: "none", error: "Failed to start daemon via systemd or detached process" };
}

/**
 * Stop the daemon (systemd service and/or detached process).
 */
export function stopDaemonService(): void {
	// 1. Stop systemd
	try {
		stopService();
	} catch {}

	// 2. Stop detached process if present
	const pidPath = getDaemonPidPath();
	if (existsSync(pidPath)) {
		try {
			const pid = Number.parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
			if (!Number.isNaN(pid) && pid > 0) {
				process.kill(pid, "SIGTERM");
			}
		} catch {}
		try {
			unlinkSync(pidPath);
		} catch {}
	}
}

/**
 * Get detailed status string of the scheduler service.
 */
export function getServiceStatus(): string {
	const status = isDaemonRunning();
	const lines: string[] = [];

	if (status.running) {
		lines.push(`Status: ${status.details}`);
	} else {
		lines.push("Status: inactive (daemon is not running)");
	}

	// Systemd status output if available
	try {
		const statusCmd = isRootUser()
			? "systemctl status forge-taskd.service"
			: "systemctl --user status forge-taskd.service";
		const output = execSync(statusCmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
		lines.push();
		lines.push("Systemd Unit Details:");
		lines.push(output.trim());
	} catch (err: any) {
		if (err.stdout) {
			lines.push();
			lines.push("Systemd Unit Details:");
			lines.push(err.stdout.trim());
		}
	}

	return lines.join("\n");
}

/**
 * Uninstall the systemd service.
 */
export function uninstallService(): boolean {
	const unitPath = getServiceUnitPath();
	if (existsSync(unitPath)) {
		try {
			const disableCmd = isRootUser()
				? "systemctl disable --now forge-taskd.service"
				: "systemctl --user disable --now forge-taskd.service";
			execSync(disableCmd, { stdio: "ignore" });
		} catch {}
		unlinkSync(unitPath);
		try {
			const reloadCmd = isRootUser() ? "systemctl daemon-reload" : "systemctl --user daemon-reload";
			execSync(reloadCmd, { stdio: "ignore" });
		} catch {}
		return true;
	}
	return false;
}

/**
 * Backward compatibility aliases
 */
export const getSystemdUserDir = getSystemdDir;
export const installUserService = installService;
export const startUserService = startService;
export const stopUserService = stopService;
export const getUserServiceStatus = getServiceStatus;
export const uninstallUserService = uninstallService;

export function findForgeBinPath(): string {
	if (process.env.FORGE_BIN && existsSync(process.env.FORGE_BIN)) {
		return process.env.FORGE_BIN;
	}
	if (process.execPath.endsWith("forge")) {
		return process.execPath;
	}
	if (existsSync("/usr/local/bin/forge")) {
		return "/usr/local/bin/forge";
	}
	// If executed via node / tsx / script
	if (process.argv[1] && existsSync(process.argv[1]) && process.argv[1].endsWith("forge")) {
		return process.argv[1];
	}
	return "forge";
}
