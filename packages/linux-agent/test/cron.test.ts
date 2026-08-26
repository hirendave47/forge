/**
 * Unit tests for Schedule calculation and Cron parsing.
 */

import { describe, expect, it } from "vitest";
import type { TaskSchedule } from "../src/runtime/task-model.ts";
import { computeNextCronRun, computeNextRun, parseCronField } from "../src/scheduler/cron.ts";

describe("Schedule & Cron Calculator", () => {
	describe("Interval schedules", () => {
		it("should calculate next run for 30s interval", () => {
			const ref = new Date("2026-08-26T12:00:00.000Z");
			const schedule: TaskSchedule = { type: "interval", seconds: 30 };
			const next = computeNextRun(schedule, ref);
			expect(next).toEqual(new Date("2026-08-26T12:00:30.000Z"));
		});

		it("should calculate next run for 1h interval", () => {
			const ref = new Date("2026-08-26T12:00:00.000Z");
			const schedule: TaskSchedule = { type: "interval", seconds: 3600 };
			const next = computeNextRun(schedule, ref);
			expect(next).toEqual(new Date("2026-08-26T13:00:00.000Z"));
		});

		it("should throw for zero or negative interval seconds", () => {
			const ref = new Date();
			expect(() => computeNextRun({ type: "interval", seconds: 0 }, ref)).toThrow();
			expect(() => computeNextRun({ type: "interval", seconds: -10 }, ref)).toThrow();
		});
	});

	describe("Once schedules", () => {
		it("should return target date if in the future", () => {
			const ref = new Date("2026-08-26T12:00:00.000Z");
			const targetStr = "2026-08-26T15:00:00.000Z";
			const schedule: TaskSchedule = { type: "once", at: targetStr };
			const next = computeNextRun(schedule, ref);
			expect(next).toEqual(new Date(targetStr));
		});

		it("should return null if target date is in the past", () => {
			const ref = new Date("2026-08-26T12:00:00.000Z");
			const targetStr = "2026-08-26T10:00:00.000Z";
			const schedule: TaskSchedule = { type: "once", at: targetStr };
			const next = computeNextRun(schedule, ref);
			expect(next).toBeNull();
		});

		it("should throw for invalid date string", () => {
			const ref = new Date();
			expect(() => computeNextRun({ type: "once", at: "not-a-date" }, ref)).toThrow();
		});
	});

	describe("Cron parsing & calculation", () => {
		it("should parse wildcard (*)", () => {
			const minutes = parseCronField("*", 0, 59);
			expect(minutes.length).toBe(60);
			expect(minutes[0]).toBe(0);
			expect(minutes[59]).toBe(59);
		});

		it("should parse step (*/15)", () => {
			const minutes = parseCronField("*/15", 0, 59);
			expect(minutes).toEqual([0, 15, 30, 45]);
		});

		it("should parse range (1-5)", () => {
			const days = parseCronField("1-5", 0, 7);
			expect(days).toEqual([1, 2, 3, 4, 5]);
		});

		it("should parse list (0,30)", () => {
			const mins = parseCronField("0,30", 0, 59);
			expect(mins).toEqual([0, 30]);
		});

		it("should compute next minute for * * * * *", () => {
			const ref = new Date("2026-08-26T12:00:30.000Z");
			const next = computeNextCronRun("* * * * *", ref);
			expect(next).toEqual(new Date("2026-08-26T12:01:00.000Z"));
		});

		it("should compute next 15-minute interval for */15 * * * *", () => {
			const ref = new Date("2026-08-26T12:05:00.000Z");
			const next = computeNextCronRun("*/15 * * * *", ref);
			expect(next).toEqual(new Date("2026-08-26T12:15:00.000Z"));
		});

		it("should compute daily midnight run for 0 0 * * *", () => {
			const ref = new Date("2026-08-26T12:00:00.000Z");
			const next = computeNextCronRun("0 0 * * *", ref);
			expect(next).toEqual(new Date("2026-08-27T00:00:00.000Z"));
		});

		it("should compute weekday 9am run for 0 9 * * 1-5", () => {
			// 2026-08-28 is Friday
			const friday = new Date("2026-08-28T10:00:00.000Z");
			const next = computeNextCronRun("0 9 * * 1-5", friday);
			// Next weekday 9am UTC should be Monday 2026-08-31
			expect(next.getUTCDay()).toBe(1); // Monday
			expect(next.getUTCHours()).toBe(9);
			expect(next.getUTCMinutes()).toBe(0);
		});

		it("should throw for invalid cron field count", () => {
			expect(() => computeNextCronRun("* * *", new Date())).toThrow();
		});

		it("should throw for out-of-range cron values", () => {
			expect(() => parseCronField("60", 0, 59)).toThrow();
		});
	});
});
