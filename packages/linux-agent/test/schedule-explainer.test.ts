/**
 * Unit tests for Schedule Explainer & Timeline Visualizer.
 */

import { describe, expect, it } from "vitest";
import { calculateTimeline, explainSchedule, formatTimelineTable } from "../src/cli/schedule-explainer.ts";
import type { TaskSchedule } from "../src/runtime/task-model.ts";

describe("Schedule Explainer", () => {
	describe("explainSchedule", () => {
		it("should explain interval schedules in plain English", () => {
			expect(explainSchedule({ type: "interval", seconds: 30 })).toBe("Every 30 seconds");
			expect(explainSchedule({ type: "interval", seconds: 300 })).toBe("Every 5 minutes");
			expect(explainSchedule({ type: "interval", seconds: 3600 })).toBe("Every 1 hour");
			expect(explainSchedule({ type: "interval", seconds: 7200 })).toBe("Every 2 hours");
		});

		it("should explain standard cron schedules in plain English", () => {
			expect(explainSchedule({ type: "cron", expression: "* * * * *" })).toBe("Every minute");
			expect(explainSchedule({ type: "cron", expression: "*/15 * * * *" })).toBe(
				"Every 15 minutes past the hour (UTC)",
			);
			expect(explainSchedule({ type: "cron", expression: "0 * * * *" })).toBe("Every hour on the hour (UTC)");
			expect(explainSchedule({ type: "cron", expression: "0 */2 * * *" })).toBe("Every 2 hours (UTC)");
			expect(explainSchedule({ type: "cron", expression: "0 2 * * *" })).toBe("Daily at 02:00 UTC");
			expect(explainSchedule({ type: "cron", expression: "0 8 * * 1-5" })).toBe(
				"Every weekday (Monday through Friday) at 08:00 UTC",
			);
			expect(explainSchedule({ type: "cron", expression: "0 0 * * 0" })).toBe("Every Sunday at 00:00 UTC");
		});

		it("should explain once and manual schedules", () => {
			const dateStr = "2026-08-30T15:00:00.000Z";
			expect(explainSchedule({ type: "once", at: dateStr })).toContain("One-time execution scheduled");
		});
	});

	describe("calculateTimeline", () => {
		it("should compute N sequential timestamps for interval schedule", () => {
			const schedule: TaskSchedule = { type: "interval", seconds: 60 };
			const baseDate = new Date("2026-08-27T12:00:00.000Z");
			const timeline = calculateTimeline(schedule, 3, baseDate);

			expect(timeline.length).toBe(3);
			expect(timeline[0].index).toBe(1);
			expect(timeline[0].date.getTime()).toBe(baseDate.getTime() + 60000);
			expect(timeline[1].index).toBe(2);
			expect(timeline[1].date.getTime()).toBe(baseDate.getTime() + 120000);
			expect(timeline[2].index).toBe(3);
			expect(timeline[2].date.getTime()).toBe(baseDate.getTime() + 180000);
		});

		it("should compute next triggers for cron schedule", () => {
			const schedule: TaskSchedule = { type: "cron", expression: "0 * * * *" };
			const baseDate = new Date("2026-08-27T12:15:00.000Z");
			const timeline = calculateTimeline(schedule, 3, baseDate);

			expect(timeline.length).toBe(3);
			expect(timeline[0].utcTime).toContain("13:00:00 UTC");
			expect(timeline[1].utcTime).toContain("14:00:00 UTC");
			expect(timeline[2].utcTime).toContain("15:00:00 UTC");
		});
	});

	describe("formatTimelineTable", () => {
		it("should produce formatted table output with explanation", () => {
			const schedule: TaskSchedule = { type: "cron", expression: "*/10 * * * *" };
			const output = formatTimelineTable(schedule, 3);

			expect(output).toContain("FORGE SCHEDULE EXPLAINER");
			expect(output).toContain("Every 10 minutes past the hour (UTC)");
			expect(output).toContain("Upcoming Execution Timeline:");
		});
	});
});
