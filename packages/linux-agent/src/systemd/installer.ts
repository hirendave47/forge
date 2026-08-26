/**
 * systemd User Service Management for Forge Linux Agent (§29).
 *
 * Generates and manages ~/.config/systemd/user/forge-taskd.service.
 * Allows non-root background daemon operation with journald logging and auto-restart.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getSystemdUserDir(): string {
	return join(homedir(), ".config", "systemd", "user");
}

export function getServiceUnitPath(): string {
	return join(getSystemdUserDir(), "forge-taskd.service");
}

/**
 * Generate systemd unit content for forge-taskd.service.
 */
export function generateServiceUnit(forgeBinPath?: string): string {
	const binPath = forgeBinPath || findForgeBinPath();

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
Environment=FORGE_CODING_AGENT_DIR=%h/.forge/agent
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=default.target
`;
}

/**
 * Auto-install the systemd user service and enable linger if possible.
 */
export function installUserService(forgeBinPath?: string): { unitPath: string; installed: boolean } {
	const unitDir = getSystemdUserDir();
	if (!existsSync(unitDir)) {
		mkdirSync(unitDir, { recursive: true });
	}

	const unitPath = getServiceUnitPath();
	const unitContent = generateServiceUnit(forgeBinPath);
	writeFileSync(unitPath, unitContent, "utf-8");

	// Reload systemd daemon
	try {
		execSync("systemctl --user daemon-reload", { stdio: "ignore" });
	} catch {
		// Ignore if systemd is not running in test/container environment
	}

	return { unitPath, installed: true };
}

/**
 * Enable and start the systemd user service.
 */
export function startUserService(): void {
	execSync("systemctl --user enable --now forge-taskd.service");
}

/**
 * Stop the systemd user service.
 */
export function stopUserService(): void {
	execSync("systemctl --user stop forge-taskd.service");
}

/**
 * Get status of the systemd user service.
 */
export function getUserServiceStatus(): string {
	try {
		const output = execSync("systemctl --user status forge-taskd.service", { encoding: "utf-8" });
		return output;
	} catch (err: any) {
		return err.stdout || err.stderr || "Service not running or not installed.";
	}
}

/**
 * Uninstall the systemd user service.
 */
export function uninstallUserService(): boolean {
	const unitPath = getServiceUnitPath();
	if (existsSync(unitPath)) {
		try {
			execSync("systemctl --user disable --now forge-taskd.service", { stdio: "ignore" });
		} catch {}
		unlinkSync(unitPath);
		try {
			execSync("systemctl --user daemon-reload", { stdio: "ignore" });
		} catch {}
		return true;
	}
	return false;
}

function findForgeBinPath(): string {
	if (process.execPath.endsWith("forge")) {
		return process.execPath;
	}
	if (existsSync("/usr/local/bin/forge")) {
		return "/usr/local/bin/forge";
	}
	return "forge";
}
