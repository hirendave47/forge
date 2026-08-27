/**
 * Unit tests for Task Templates library.
 */

import { describe, expect, it } from "vitest";
import { getTaskTemplate, instantiateTemplate, listTaskTemplates } from "../src/templates/task-templates.ts";

describe("Task Templates", () => {
	it("should list all curated production templates", () => {
		const templates = listTaskTemplates();
		expect(templates.length).toBe(8);
		expect(templates.map((t) => t.id)).toEqual([
			"nginx-error-monitor",
			"disk-space-cleaner",
			"systemd-service-watchdog",
			"memory-leak-detector",
			"postgres-nightly-backup",
			"ssl-cert-expiry-check",
			"docker-unhealthy-pruner",
			"security-port-auditor",
		]);
	});

	it("should find template by ID or case-insensitive search", () => {
		const t1 = getTaskTemplate("nginx-error-monitor");
		expect(t1).toBeDefined();
		expect(t1?.profile).toBe("sysadmin");
		expect(t1?.schedule).toEqual({ type: "interval", seconds: 30 });

		const t2 = getTaskTemplate("postgres");
		expect(t2).toBeDefined();
		expect(t2?.id).toBe("postgres-nightly-backup");
		expect(t2?.schedule).toEqual({ type: "cron", expression: "0 2 * * *" });
	});

	it("should instantiate CreateTaskInput from a template with default values", () => {
		const input = instantiateTemplate("ssl-cert-expiry-check");
		expect(input.name).toBe("ssl-cert-expiry-check");
		expect(input.profile).toBe("security");
		expect(input.schedule).toEqual({ type: "cron", expression: "0 8 * * *" });
		expect(input.policyMode).toBe("safe");
		expect(input.enabled).toBe(true);
		expect(input.toolsAllow).toEqual(["bash", "read", "send_notification"]);
	});

	it("should apply parameter overrides when instantiating template", () => {
		const input = instantiateTemplate("nginx-error-monitor", {
			name: "prod-nginx-errors",
			schedule: { type: "interval", seconds: 15 },
			timeoutSeconds: 45,
			policyMode: "supervised",
		});

		expect(input.name).toBe("prod-nginx-errors");
		expect(input.schedule).toEqual({ type: "interval", seconds: 15 });
		expect(input.timeoutSeconds).toBe(45);
		expect(input.policyMode).toBe("supervised");
		expect(input.profile).toBe("sysadmin");
	});

	it("should throw error when unknown template is requested", () => {
		expect(() => instantiateTemplate("nonexistent-template")).toThrow(/Template not found/);
	});
});
