/**
 * Unit tests for Host Environment Inspector.
 */

import { describe, expect, it } from "vitest";
import { formatHostSummary, type HostInfo, inspectHost } from "../src/cli/wizard/host-inspector.ts";

describe("Host Inspector", () => {
	it("should inspect local host and return structured HostInfo", () => {
		const info = inspectHost({ timeoutMs: 1500 });

		expect(info).toBeDefined();
		expect(typeof info.osName).toBe("string");
		expect(info.osName.length).toBeGreaterThan(0);
		expect(typeof info.kernel).toBe("string");
		expect(Array.isArray(info.activeServices)).toBe(true);
		expect(Array.isArray(info.highUsageDisks)).toBe(true);
		expect(Array.isArray(info.discoveredLogFiles)).toBe(true);
		expect(Array.isArray(info.listeningPorts)).toBe(true);
	});

	it("should format HostInfo into a concise summary string", () => {
		const sampleHost: HostInfo = {
			osName: "Ubuntu",
			osVersion: "24.04",
			kernel: "6.8.0-generic",
			activeServices: ["nginx", "docker", "redis-server"],
			highUsageDisks: [
				{
					filesystem: "/dev/sda1",
					mountPoint: "/",
					total: "100G",
					used: "82G",
					available: "18G",
					usePercentage: 82,
				},
			],
			discoveredLogFiles: ["/var/log/syslog", "/var/log/nginx/error.log"],
			listeningPorts: [22, 80, 443, 6379],
		};

		const summary = formatHostSummary(sampleHost);
		expect(summary).toContain("OS: Ubuntu 24.04");
		expect(summary).toContain("Active Services: nginx, docker, redis-server");
		expect(summary).toContain("Disk Usage: / (82% used, 18G free)");
		expect(summary).toContain("Prominent Logs: /var/log/syslog, /var/log/nginx/error.log");
		expect(summary).toContain("Listening TCP Ports: 22, 80, 443, 6379");
	});
});
