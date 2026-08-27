import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadLogTool } from "../src/core/tools/read-log.ts";

describe("Read Log Tool (read_log)", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "forge-read-log-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("should define valid tool parameters schema", () => {
		const tool = createReadLogTool(tempDir);
		expect(tool.name).toBe("read_log");
		expect(tool.parameters).toBeDefined();
	});

	it("should tail the last N lines of a log file", async () => {
		const logFile = join(tempDir, "app.log");
		const lines = Array.from({ length: 50 }, (_, i) => `2026-08-27 12:00:${i < 10 ? `0${i}` : i} Line ${i + 1}`);
		writeFileSync(logFile, lines.join("\n"), "utf-8");

		const tool = createReadLogTool(tempDir);
		const result = await tool.execute("call-1", { path: "app.log", tail: 5 });

		const firstContent = result.content[0];
		expect(firstContent?.type).toBe("text");
		if (firstContent?.type === "text") {
			expect(firstContent.text).toContain("Last 5 lines");
			expect(firstContent.text).toContain("Line 50");
			expect(firstContent.text).toContain("Line 46");
			expect(firstContent.text).not.toContain("Line 10");
		}
	});

	it("should incrementally read with offset tracking and deduplicate errors", async () => {
		const logFile = join(tempDir, "error.log");
		const logContent = [
			"2026-08-27 10:00:01 [info] Server started on port 8080",
			"2026-08-27 10:00:02 [warn] High memory usage detected",
			"2026-08-27 10:00:03 [error] Connection timeout to database 192.168.1.5:5432",
			"2026-08-27 10:00:04 [error] Connection timeout to database 192.168.1.5:5432",
			"2026-08-27 10:00:05 [error] Connection timeout to database 192.168.1.5:5432",
			"2026-08-27 10:00:06 [info] Request completed in 20ms",
		].join("\n");
		writeFileSync(logFile, logContent, "utf-8");

		const tool = createReadLogTool(tempDir);
		const result = await tool.execute("call-2", { path: "error.log", offset: 0, deduplicate: true });

		const firstContent = result.content[0];
		expect(firstContent?.type).toBe("text");
		if (firstContent?.type === "text") {
			expect(firstContent.text).toContain("### Log Stream: error.log");
			expect(firstContent.text).toContain("Deduplicated Incidents");
			expect(firstContent.text).toContain("Occurrences: 3");
			expect(firstContent.text).toContain("**Next Offset**:");
		}
	});

	it("should return error message when file does not exist", async () => {
		const tool = createReadLogTool(tempDir);
		const result = await tool.execute("call-3", { path: "missing.log" });

		const firstContent = result.content[0];
		expect(firstContent?.type).toBe("text");
		if (firstContent?.type === "text") {
			expect(firstContent.text).toContain("Log file not found");
		}
	});
});
