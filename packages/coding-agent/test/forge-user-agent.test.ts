import { describe, expect, it } from "vitest";
import { getForgeUserAgent } from "../src/utils/forge-user-agent.ts";

describe("getForgeUserAgent", () => {
	it("formats the user agent expected by forge", () => {
		const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
		const userAgent = getForgeUserAgent("1.2.3");

		expect(userAgent).toBe(`forge/1.2.3 (${process.platform}; ${runtime}; ${process.arch})`);
		expect(userAgent).toMatch(/^forge\/[^\s()]+ \([^;()]+;\s*[^;()]+;\s*[^()]+\)$/);
	});
});
