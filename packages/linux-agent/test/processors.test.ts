/**
 * Unit & Integration tests for Processors (§10, §11, §12).
 */

import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogDeduplicatorProcessor, normalizeLogLine } from "../src/processors/log-deduplicator.ts";
import { LogReaderProcessor } from "../src/processors/log-reader.ts";
import { SystemHealthProcessor } from "../src/processors/system-health.ts";
import type { ProcessorContext } from "../src/processors/types.ts";
import { TaskStore } from "../src/store/task-store.ts";

const TEST_DIR = join(import.meta.dirname ?? ".", ".test-processors");

describe("Deterministic Processors", () => {
	let store: TaskStore;
	let dbPath: string;
	let logPath: string;
	let context: ProcessorContext;

	beforeEach(() => {
		if (!existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true });
		}
		dbPath = join(TEST_DIR, `test-store-${Date.now()}.db`);
		logPath = join(TEST_DIR, `app-${Date.now()}.log`);
		store = new TaskStore(dbPath);
		const task = store.createTask({ name: "proc-task", goal: "Test processors" });
		context = {
			taskId: task.id,
			store,
		};
	});

	afterEach(() => {
		store.close();
		try {
			rmSync(TEST_DIR, { recursive: true, force: true });
		} catch {}
	});

	describe("LogReaderProcessor (§11)", () => {
		it("should read initial log file and produce checkpoint update", () => {
			writeFileSync(logPath, "line 1\nline 2\nline 3\n");

			const reader = new LogReaderProcessor();
			const result = reader.process({ filePath: logPath }, context);

			expect(result.data.lines).toEqual(["line 1", "line 2", "line 3", ""]);
			expect(result.data.bytesRead).toBeGreaterThan(0);
			expect(result.checkpoint).toBeDefined();
			expect(result.checkpoint!.byteOffset).toBe(result.data.bytesRead);
			expect(result.checkpoint!.inode).toBeDefined();
		});

		it("should read only newly appended lines using saved checkpoint", () => {
			writeFileSync(logPath, "line 1\nline 2\n");

			const reader = new LogReaderProcessor();
			const firstResult = reader.process({ filePath: logPath }, context);

			// Commit checkpoint to store
			context.store.upsertCheckpoint({
				taskId: context.taskId,
				checkpointKey: logPath,
				byteOffset: firstResult.checkpoint!.byteOffset,
				lineOffset: firstResult.checkpoint!.lineOffset,
				device: firstResult.checkpoint!.device,
				inode: firstResult.checkpoint!.inode,
			});

			// Append new line
			appendFileSync(logPath, "line 3: new entry\n");

			const secondResult = reader.process({ filePath: logPath }, context);
			expect(secondResult.data.lines).toEqual(["line 3: new entry", ""]);
			expect(secondResult.data.bytesRead).toBe("line 3: new entry\n".length);
		});

		it("should return empty lines when no new data has been written", () => {
			writeFileSync(logPath, "line 1\n");

			const reader = new LogReaderProcessor();
			const result1 = reader.process({ filePath: logPath }, context);

			context.store.upsertCheckpoint({
				taskId: context.taskId,
				checkpointKey: logPath,
				byteOffset: result1.checkpoint!.byteOffset,
				lineOffset: result1.checkpoint!.lineOffset,
				inode: result1.checkpoint!.inode,
			});

			const result2 = reader.process({ filePath: logPath }, context);
			expect(result2.data.lines).toEqual([]);
			expect(result2.data.bytesRead).toBe(0);
		});

		it("should detect log rotation when file shrinks or inode changes", () => {
			writeFileSync(logPath, "first long log line with lots of data\n");

			const reader = new LogReaderProcessor();
			const result1 = reader.process({ filePath: logPath }, context);

			context.store.upsertCheckpoint({
				taskId: context.taskId,
				checkpointKey: logPath,
				byteOffset: result1.checkpoint!.byteOffset,
				lineOffset: result1.checkpoint!.lineOffset,
				inode: "999999999", // Different inode simulates rotated file
			});

			writeFileSync(logPath, "new truncated file line\n");

			const result2 = reader.process({ filePath: logPath }, context);
			expect(result2.data.rotated).toBe(true);
			expect(result2.data.lines).toContain("new truncated file line");
		});
	});

	describe("LogDeduplicatorProcessor (§12)", () => {
		it("should normalize timestamps, PIDs, and IPs", () => {
			const raw = "2026-08-26 14:03:20 [pid 12345] 192.168.1.50 HTTP/1.1 500 Internal Server Error";
			const normalized = normalizeLogLine(raw);
			expect(normalized).toBe("<TIME> [PID] <IP> HTTP/1.1 500 Internal Server Error");
		});

		it("should deduplicate 10 repeated HTTP 500 errors into 1 unique incident with count=10", () => {
			const lines = [
				"2026-08-26 14:00:00 INFO Server starting",
				"2026-08-26 14:01:00 INFO Worker ready",
				"2026-08-26 14:02:01 [101] 10.0.0.1 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:05 [102] 10.0.0.2 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:10 [103] 10.0.0.3 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:15 [104] 10.0.0.4 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:20 [105] 10.0.0.5 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:25 [106] 10.0.0.6 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:30 [107] 10.0.0.7 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:35 [108] 10.0.0.8 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:40 [109] 10.0.0.9 HTTP/1.1 500 upstream timeout at /api/users",
				"2026-08-26 14:02:45 [110] 10.0.0.10 HTTP/1.1 500 upstream timeout at /api/users",
			];

			const deduplicator = new LogDeduplicatorProcessor();
			const result = deduplicator.process({ lines }, context);

			expect(result.data.totalLinesProcessed).toBe(12);
			expect(result.data.totalErrorLinesFound).toBe(10);
			expect(result.data.uniqueIncidentsCount).toBe(1);

			const incident = result.data.incidents[0];
			expect(incident.count).toBe(10);
			expect(incident.normalizedError).toContain("500 upstream timeout at /api/users");
			expect(incident.lastContext.length).toBeGreaterThan(0);

			// Check prompt contribution
			expect(result.promptContribution).toBeDefined();
			expect(result.promptContribution).toContain("Log Analysis & Deduplication Summary");
			expect(result.promptContribution).toContain("Occurrences: 10");
		});

		it("should distinguish different types of errors into separate incidents", () => {
			const lines = [
				"2026-08-26 14:00:00 [1] 10.0.0.1 HTTP 500 database connection pool exhausted",
				"2026-08-26 14:00:01 [2] 10.0.0.1 HTTP 500 database connection pool exhausted",
				"2026-08-26 14:00:05 [3] 10.0.0.2 HTTP 502 bad gateway from backend",
			];

			const deduplicator = new LogDeduplicatorProcessor();
			const result = deduplicator.process({ lines }, context);

			expect(result.data.uniqueIncidentsCount).toBe(2);
			expect(result.data.incidents[0].count).toBe(2);
			expect(result.data.incidents[1].count).toBe(1);
		});
	});

	describe("SystemHealthProcessor (§10)", () => {
		it("should capture memory and load metrics", () => {
			const healthProc = new SystemHealthProcessor();
			const result = healthProc.process(undefined, context);

			expect(result.data.memory.totalMb).toBeGreaterThan(0);
			expect(result.data.memory.freeMb).toBeGreaterThanOrEqual(0);
			expect(result.data.loadAverage.length).toBe(3);
			expect(result.promptContribution).toContain("Current System Health Snapshot");
			expect(result.promptContribution).toContain("Memory");
		});
	});
});
