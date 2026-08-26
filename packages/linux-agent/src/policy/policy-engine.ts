/**
 * Policy Engine for Forge Linux Agent (§22).
 *
 * Implements a policy layer independent of the LLM.
 * Classifies operations by risk level (READ, LOW_RISK, MODIFY, HIGH_RISK, DESTRUCTIVE)
 * and enforces safety constraints based on the active PolicyMode (safe, supervised, autonomous).
 */

import type { PolicyMode } from "../runtime/task-model.ts";

export type OperationRisk = "READ" | "LOW_RISK" | "MODIFY" | "HIGH_RISK" | "DESTRUCTIVE";

export interface PolicyDecision {
	allowed: boolean;
	risk: OperationRisk;
	reason?: string;
}

// Strictly blocked destructive patterns across all modes
const DESTRUCTIVE_SHELL_PATTERNS = [
	/\b(?:reboot|poweroff|shutdown|halt|init\s+[06])\b/i,
	/\bsystemctl\s+(?:reboot|poweroff|halt)\b/i,
	/\bkill(?:all)?\s+(?:-9\s+)?(?:1|init|systemd)\b/i,
	/\bmkfs(?:\.\w+)?\b/i,
	/\bwipefs\b/i,
	/\bdd\s+.*of=\/dev\/(?:sd|nvme|vd|hd|loop|null|zero)\w*\b/i,
	/\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+(?:\/|\/\*|~\/?|\$HOME\/?)(?:\s|$)/i,
	/\biptables\s+-F(?:\s|$)/i,
	/\bufw\s+disable\b/i,
	/\bip\s+link\s+set\s+\w+\s+down\b/i,
];

// High risk patterns (package management, firewall, user management)
const HIGH_RISK_SHELL_PATTERNS = [
	/\b(?:apt|apt-get|yum|dnf|pacman|zypper)\s+(?:install|remove|purge|erase)\b/i,
	/\biptables\b/i,
	/\bufw\b/i,
	/\b(?:useradd|userdel|usermod|groupadd|groupdel|passwd)\b/i,
	/\bchmod\s+(?:-R\s+)?[07]{3,4}\s+\/(?:etc|bin|sbin|usr|var|root)\b/i,
	/\bchown\s+(?:-R\s+)?\w+\s+\/(?:etc|bin|sbin|usr|var|root)\b/i,
];

// Modifying patterns (restarting services, editing system configs)
const MODIFY_SHELL_PATTERNS = [
	/\bsystemctl\s+(?:restart|start|stop|reload|enable|disable)\b/i,
	/\bservice\s+\w+\s+(?:restart|start|stop|reload)\b/i,
	/\b(?:cp|mv|rm|sed\s+-i|truncate)\b/i,
	/>(?:>)?\s*\/(?:etc|var|usr|opt)\b/i,
];

export class PolicyEngine {
	/**
	 * Classify the risk level of a tool call or shell command.
	 */
	classify(toolName: string, args: Record<string, unknown>): OperationRisk {
		if (toolName === "bash" || toolName === "powershell") {
			const command = String(args.command || "");
			return this.classifyShellCommand(command);
		}

		if (toolName === "edit" || toolName === "write") {
			const filePath = String(args.path || args.filePath || "");
			// System files are MODIFY or HIGH_RISK
			if (filePath.startsWith("/etc/") || filePath.startsWith("/usr/") || filePath.startsWith("/lib/")) {
				return "MODIFY";
			}
			return "LOW_RISK";
		}

		if (
			toolName === "read" ||
			toolName === "grep" ||
			toolName === "find" ||
			toolName === "ls" ||
			toolName === "wait_interval" ||
			toolName === "send_notification"
		) {
			return "READ";
		}

		return "LOW_RISK";
	}

	/**
	 * Classify the risk level of a raw shell command string.
	 */
	classifyShellCommand(command: string): OperationRisk {
		// 1. Check destructive
		for (const pattern of DESTRUCTIVE_SHELL_PATTERNS) {
			if (pattern.test(command)) {
				return "DESTRUCTIVE";
			}
		}

		// 2. Check high risk
		for (const pattern of HIGH_RISK_SHELL_PATTERNS) {
			if (pattern.test(command)) {
				return "HIGH_RISK";
			}
		}

		// 3. Check modify
		for (const pattern of MODIFY_SHELL_PATTERNS) {
			if (pattern.test(command)) {
				return "MODIFY";
			}
		}

		return "READ";
	}

	/**
	 * Evaluate whether an operation is allowed under the given policy mode.
	 */
	evaluate(policyMode: PolicyMode, toolName: string, args: Record<string, unknown>): PolicyDecision {
		const risk = this.classify(toolName, args);

		// DESTRUCTIVE operations are ALWAYS blocked regardless of policy mode
		if (risk === "DESTRUCTIVE") {
			return {
				allowed: false,
				risk,
				reason: `Operation is classified as DESTRUCTIVE and strictly blocked by production guardrails: ${toolName}`,
			};
		}

		if (policyMode === "safe") {
			if (risk === "MODIFY" || risk === "HIGH_RISK") {
				return {
					allowed: false,
					risk,
					reason: `Operation is classified as ${risk} and blocked by 'safe' policy mode. Only READ and LOW_RISK actions allowed.`,
				};
			}
		}

		if (policyMode === "supervised") {
			if (risk === "HIGH_RISK") {
				return {
					allowed: false,
					risk,
					reason: `Operation is classified as HIGH_RISK and requires interactive approval under 'supervised' policy mode.`,
				};
			}
		}

		return {
			allowed: true,
			risk,
		};
	}
}

export const defaultPolicyEngine = new PolicyEngine();
