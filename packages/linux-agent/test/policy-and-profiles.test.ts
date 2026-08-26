/**
 * Unit tests for Profiles, Policy Engine, and Verification Engine (§15, §22, §24).
 */

import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../src/policy/policy-engine.ts";
import { formatProfileSystemPrompt, getProfile, listProfiles } from "../src/profiles/index.ts";
import { VerificationEngine } from "../src/verification/verification-engine.ts";

describe("Profiles, Policies & Verification", () => {
	describe("Agent Profiles (§15)", () => {
		it("should have all 5 built-in profiles registered", () => {
			const profiles = listProfiles();
			expect(profiles.length).toBe(5);

			const ids = profiles.map((p) => p.id);
			expect(ids).toContain("sysadmin");
			expect(ids).toContain("devops");
			expect(ids).toContain("sre");
			expect(ids).toContain("software-engineer");
			expect(ids).toContain("security");
		});

		it("should retrieve profile by case-insensitive ID", () => {
			const sysadmin = getProfile("SYSADMIN");
			expect(sysadmin).toBeDefined();
			expect(sysadmin!.name).toBe("Systems Administrator");
			expect(sysadmin!.operatingPrinciples.length).toBeGreaterThan(0);
			expect(sysadmin!.verificationExpectations.length).toBeGreaterThan(0);
		});

		it("should format compact profile system prompt", () => {
			const sre = getProfile("sre")!;
			const prompt = formatProfileSystemPrompt(sre);
			expect(prompt).toContain("## Profile: Site Reliability Engineer");
			expect(prompt).toContain("Operating Principles:");
			expect(prompt).toContain("Verification Expectations:");
		});
	});

	describe("Policy Engine (§22)", () => {
		const policy = new PolicyEngine();

		it("should classify DESTRUCTIVE commands", () => {
			expect(policy.classifyShellCommand("reboot")).toBe("DESTRUCTIVE");
			expect(policy.classifyShellCommand("shutdown -h now")).toBe("DESTRUCTIVE");
			expect(policy.classifyShellCommand("systemctl reboot")).toBe("DESTRUCTIVE");
			expect(policy.classifyShellCommand("kill -9 1")).toBe("DESTRUCTIVE");
			expect(policy.classifyShellCommand("rm -rf /")).toBe("DESTRUCTIVE");
			expect(policy.classifyShellCommand("mkfs.ext4 /dev/sda1")).toBe("DESTRUCTIVE");
			expect(policy.classifyShellCommand("iptables -F")).toBe("DESTRUCTIVE");
		});

		it("should classify HIGH_RISK commands", () => {
			expect(policy.classifyShellCommand("apt-get install nginx")).toBe("HIGH_RISK");
			expect(policy.classifyShellCommand("yum install -y curl")).toBe("HIGH_RISK");
			expect(policy.classifyShellCommand("useradd -m newuser")).toBe("HIGH_RISK");
			expect(policy.classifyShellCommand("chmod 777 /etc")).toBe("HIGH_RISK");
		});

		it("should classify MODIFY commands", () => {
			expect(policy.classifyShellCommand("systemctl restart nginx")).toBe("MODIFY");
			expect(policy.classifyShellCommand("service postgresql stop")).toBe("MODIFY");
			expect(policy.classifyShellCommand("cp file1.conf /etc/nginx/nginx.conf")).toBe("MODIFY");
			expect(policy.classify("edit", { path: "/etc/hosts" })).toBe("MODIFY");
		});

		it("should classify READ and LOW_RISK commands", () => {
			expect(policy.classifyShellCommand("ps aux | grep node")).toBe("READ");
			expect(policy.classifyShellCommand("df -h")).toBe("READ");
			expect(policy.classifyShellCommand("journalctl -u nginx --since '1 hour ago'")).toBe("READ");
			expect(policy.classify("read", { path: "/var/log/syslog" })).toBe("READ");
			expect(policy.classify("grep", { path: "/var/log" })).toBe("READ");
			expect(policy.classify("write", { path: "./report.md" })).toBe("LOW_RISK");
		});

		it("should enforce 'safe' policy mode (blocks MODIFY, HIGH_RISK, DESTRUCTIVE)", () => {
			expect(policy.evaluate("safe", "read", { path: "/etc/nginx/nginx.conf" }).allowed).toBe(true);
			expect(policy.evaluate("safe", "bash", { command: "ps -ef" }).allowed).toBe(true);

			const modify = policy.evaluate("safe", "bash", { command: "systemctl restart nginx" });
			expect(modify.allowed).toBe(false);
			expect(modify.risk).toBe("MODIFY");

			const highRisk = policy.evaluate("safe", "bash", { command: "apt install nginx" });
			expect(highRisk.allowed).toBe(false);
			expect(highRisk.risk).toBe("HIGH_RISK");

			const destructive = policy.evaluate("safe", "bash", { command: "reboot" });
			expect(destructive.allowed).toBe(false);
			expect(destructive.risk).toBe("DESTRUCTIVE");
		});

		it("should enforce 'supervised' policy mode (allows MODIFY, blocks HIGH_RISK)", () => {
			expect(policy.evaluate("supervised", "bash", { command: "systemctl restart nginx" }).allowed).toBe(true);

			const highRisk = policy.evaluate("supervised", "bash", { command: "apt-get install nginx" });
			expect(highRisk.allowed).toBe(false);
			expect(highRisk.risk).toBe("HIGH_RISK");

			const destructive = policy.evaluate("supervised", "bash", { command: "rm -rf /" });
			expect(destructive.allowed).toBe(false);
			expect(destructive.risk).toBe("DESTRUCTIVE");
		});

		it("should enforce 'autonomous' policy mode (allows HIGH_RISK, blocks DESTRUCTIVE)", () => {
			expect(policy.evaluate("autonomous", "bash", { command: "systemctl restart nginx" }).allowed).toBe(true);
			expect(policy.evaluate("autonomous", "bash", { command: "apt-get install -y curl" }).allowed).toBe(true);

			const destructive = policy.evaluate("autonomous", "bash", { command: "shutdown -h now" });
			expect(destructive.allowed).toBe(false);
			expect(destructive.risk).toBe("DESTRUCTIVE");
		});
	});

	describe("Verification Engine (§24)", () => {
		const verifier = new VerificationEngine();

		it("should match nginx verification rules for nginx actions", async () => {
			const results = await verifier.verifyAction("edit", "/etc/nginx/nginx.conf");
			expect(results.some((r) => r.ruleName === "nginx-config-check")).toBe(true);
		});

		it("should match systemd verification rules for systemctl actions", async () => {
			const results = await verifier.verifyAction("systemctl restart nginx.service", "nginx.service");
			expect(results.some((r) => r.ruleName === "systemd-status-check")).toBe(true);
		});
	});
});
