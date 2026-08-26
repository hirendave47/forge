/**
 * Verification Engine for Forge Linux Agent (§24).
 *
 * Implements automated verification routines for operational actions (syntax checks,
 * service status checks, endpoint health checks). Prevents false success reporting.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface VerificationResult {
	passed: boolean;
	ruleName: string;
	message: string;
	output?: string;
	durationMs: number;
}

export interface VerificationRule {
	name: string;
	description: string;
	canVerify(action: string, target?: string): boolean;
	verify(action: string, target?: string): Promise<VerificationResult>;
}

/**
 * Nginx configuration verification rule (nginx -t).
 */
export const NGINX_CONFIG_RULE: VerificationRule = {
	name: "nginx-config-check",
	description: "Validates nginx configuration syntax with nginx -t",
	canVerify(action, target) {
		const targetStr = (target || "").toLowerCase();
		return targetStr.includes("nginx") || targetStr.endsWith(".conf") || action.includes("nginx");
	},
	async verify() {
		const start = Date.now();
		try {
			const { stdout, stderr } = await execAsync("nginx -t 2>&1");
			const output = (stdout || stderr).trim();
			const passed = output.includes("syntax is ok") && output.includes("test is successful");
			return {
				passed,
				ruleName: this.name,
				message: passed ? "Nginx configuration syntax is valid" : "Nginx configuration test failed",
				output,
				durationMs: Date.now() - start,
			};
		} catch (err: any) {
			return {
				passed: false,
				ruleName: this.name,
				message: `Nginx syntax check failed: ${err.message || err}`,
				output: err.stdout || err.stderr,
				durationMs: Date.now() - start,
			};
		}
	},
};

/**
 * Systemd service status verification rule (systemctl is-active <service>).
 */
export const SYSTEMD_STATUS_RULE: VerificationRule = {
	name: "systemd-status-check",
	description: "Verifies that a service is actively running with systemctl is-active",
	canVerify(action, target) {
		return action.includes("systemctl") || (target?.endsWith(".service") ?? false);
	},
	async verify(_action, target) {
		const start = Date.now();
		const serviceName = extractServiceName(target || _action);
		if (!serviceName) {
			return {
				passed: false,
				ruleName: this.name,
				message: "Could not determine service name for verification",
				durationMs: Date.now() - start,
			};
		}

		try {
			const { stdout } = await execAsync(`systemctl is-active ${serviceName}`);
			const status = stdout.trim();
			const passed = status === "active";
			return {
				passed,
				ruleName: this.name,
				message: passed ? `Service "${serviceName}" is active` : `Service "${serviceName}" is ${status}`,
				output: status,
				durationMs: Date.now() - start,
			};
		} catch (err: any) {
			return {
				passed: false,
				ruleName: this.name,
				message: `Service "${serviceName}" is inactive or failed`,
				output: err.stdout || err.stderr,
				durationMs: Date.now() - start,
			};
		}
	},
};

/**
 * SSH configuration verification rule (sshd -t).
 */
export const SSHD_CONFIG_RULE: VerificationRule = {
	name: "sshd-config-check",
	description: "Validates sshd_config syntax with sshd -t",
	canVerify(_action, target) {
		const targetStr = (target || "").toLowerCase();
		return targetStr.includes("sshd_config") || targetStr.includes("sshd");
	},
	async verify() {
		const start = Date.now();
		try {
			const { stderr } = await execAsync("sshd -t 2>&1");
			const output = (stderr || "").trim();
			const passed = output.length === 0;
			return {
				passed,
				ruleName: this.name,
				message: passed ? "SSHD configuration syntax is valid" : `SSHD configuration warning: ${output}`,
				output,
				durationMs: Date.now() - start,
			};
		} catch (err: any) {
			return {
				passed: false,
				ruleName: this.name,
				message: `SSHD configuration test failed: ${err.message || err}`,
				output: err.stdout || err.stderr,
				durationMs: Date.now() - start,
			};
		}
	},
};

export class VerificationEngine {
	private readonly rules: VerificationRule[] = [NGINX_CONFIG_RULE, SYSTEMD_STATUS_RULE, SSHD_CONFIG_RULE];

	registerRule(rule: VerificationRule): void {
		this.rules.push(rule);
	}

	/**
	 * Find matching rules and execute verification for an operational action.
	 */
	async verifyAction(action: string, target?: string): Promise<VerificationResult[]> {
		const results: VerificationResult[] = [];

		for (const rule of this.rules) {
			if (rule.canVerify(action, target)) {
				const result = await rule.verify(action, target);
				results.push(result);
			}
		}

		return results;
	}
}

function extractServiceName(input: string): string | null {
	const match = input.match(/\b([a-zA-Z0-9_-]+(?:\.service)?)\b/);
	if (match) {
		const name = match[1];
		if (name !== "systemctl" && name !== "restart" && name !== "start" && name !== "status") {
			return name;
		}
	}
	return null;
}

export const defaultVerificationEngine = new VerificationEngine();
