/**
 * Unit tests for Sudoers Management and Privilege Detection.
 */

import { describe, expect, it } from "vitest";
import {
	checkPrivilegeLevel,
	GRANULAR_SYSADMIN_COMMANDS,
	generateSudoersConfig,
	handleSudoersCommand,
} from "../src/systemd/sudoers.ts";

describe("Sudoers and Privilege Detection", () => {
	it("should inspect current host privilege level without error", () => {
		const priv = checkPrivilegeLevel();
		expect(priv).toBeDefined();
		expect(typeof priv.isRoot).toBe("boolean");
		expect(typeof priv.hasPasswordlessSudo).toBe("boolean");
		expect(typeof priv.username).toBe("string");
		expect(["root", "sudo_nopasswd", "unprivileged"]).toContain(priv.level);
	});

	it("should generate valid granular sudoers configuration for user", () => {
		const config = generateSudoersConfig({ username: "kvmadmin", mode: "granular" });
		expect(config).toContain("kvmadmin ALL=(ALL) NOPASSWD:");
		expect(config).toContain("/usr/bin/systemctl status *");
		expect(config).toContain("/usr/bin/journalctl *");
		expect(config).toContain("/usr/sbin/ss *");
		expect(config).toContain("/usr/bin/docker *");
		expect(config).toContain("/usr/bin/cat /var/log/*");
	});

	it("should generate valid full sudoers configuration for user", () => {
		const config = generateSudoersConfig({ username: "opsuser", mode: "full" });
		expect(config).toContain("opsuser ALL=(ALL) NOPASSWD: ALL");
	});

	it("should contain standard sysadmin commands in granular list", () => {
		expect(GRANULAR_SYSADMIN_COMMANDS.length).toBeGreaterThanOrEqual(15);
		expect(GRANULAR_SYSADMIN_COMMANDS).toContain("/usr/bin/systemctl restart *");
		expect(GRANULAR_SYSADMIN_COMMANDS).toContain("/usr/bin/systemctl reload *");
		expect(GRANULAR_SYSADMIN_COMMANDS).toContain("/usr/bin/df *");
		expect(GRANULAR_SYSADMIN_COMMANDS).toContain("/usr/bin/free *");
	});

	it("should execute handleSudoersCommand show and check without throwing", async () => {
		// Test check action
		await expect(handleSudoersCommand(["check"])).resolves.not.toThrow();

		// Test show action
		await expect(handleSudoersCommand(["show"])).resolves.not.toThrow();
	});
});
