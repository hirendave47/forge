/**
 * Schedule calculation utilities for Forge Linux Agent.
 *
 * Supports interval, once, and standard 5-part cron expressions (in UTC):
 * minute (0-59), hour (0-23), day of month (1-31), month (1-12), day of week (0-7, 0 and 7 = Sun).
 */

import type { TaskSchedule } from "../runtime/task-model.ts";

/**
 * Computes the next run time for a given schedule from a reference time.
 * Returns null if the schedule will never trigger again (e.g. past 'once' schedule).
 */
export function computeNextRun(schedule: TaskSchedule, fromDate: Date = new Date()): Date | null {
	if (schedule.type === "interval") {
		if (schedule.seconds <= 0) {
			throw new Error(`Interval seconds must be > 0, got ${schedule.seconds}`);
		}
		return new Date(fromDate.getTime() + schedule.seconds * 1000);
	}

	if (schedule.type === "once") {
		const target = new Date(schedule.at);
		if (Number.isNaN(target.getTime())) {
			throw new Error(`Invalid ISO date for once schedule: "${schedule.at}"`);
		}
		return target > fromDate ? target : null;
	}

	if (schedule.type === "cron") {
		return computeNextCronRun(schedule.expression, fromDate);
	}

	return null;
}

/**
 * Parse and compute next matching date in UTC for a standard 5-part cron expression.
 */
export function computeNextCronRun(expression: string, fromDate: Date = new Date()): Date {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) {
		throw new Error(`Invalid cron expression: "${expression}". Expected 5 fields: minute hour day month dayOfWeek`);
	}

	const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

	const minutes = parseCronField(minExpr, 0, 59);
	const hours = parseCronField(hourExpr, 0, 23);
	const daysOfMonth = parseCronField(domExpr, 1, 31);
	const months = parseCronField(monthExpr, 1, 12);
	const daysOfWeek = parseCronField(dowExpr, 0, 7).map((d) => (d === 7 ? 0 : d)); // 7 is Sunday, map to 0

	// Start searching from next minute: zero out seconds & ms, and add 1 minute
	const candidate = new Date(fromDate.getTime());
	candidate.setUTCSeconds(0, 0);
	candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

	// Limit search to 5 years (approx 2.6 million minutes max) to avoid infinite loops
	const maxIterations = 60 * 24 * 366 * 5;
	let iterations = 0;

	while (iterations < maxIterations) {
		const mon = candidate.getUTCMonth() + 1; // 1-12
		if (!months.includes(mon)) {
			// Advance to next month at 00:00:00
			candidate.setUTCMonth(candidate.getUTCMonth() + 1, 1);
			candidate.setUTCHours(0, 0, 0, 0);
			iterations++;
			continue;
		}

		const dom = candidate.getUTCDate();
		const dow = candidate.getUTCDay(); // 0-6
		const domMatch = daysOfMonth.includes(dom);
		const dowMatch = daysOfWeek.includes(dow);

		// Standard cron behavior: if both dom and dow are specified (not '*'), match either.
		const isDomRestricted = domExpr !== "*";
		const isDowRestricted = dowExpr !== "*";

		let dayMatch = false;
		if (isDomRestricted && isDowRestricted) {
			dayMatch = domMatch || dowMatch;
		} else if (isDomRestricted) {
			dayMatch = domMatch;
		} else if (isDowRestricted) {
			dayMatch = dowMatch;
		} else {
			dayMatch = true;
		}

		if (!dayMatch) {
			// Advance to next day at 00:00:00
			candidate.setUTCDate(candidate.getUTCDate() + 1);
			candidate.setUTCHours(0, 0, 0, 0);
			iterations++;
			continue;
		}

		const hr = candidate.getUTCHours();
		if (!hours.includes(hr)) {
			// Advance to next hour at :00:00
			candidate.setUTCHours(candidate.getUTCHours() + 1, 0, 0, 0);
			iterations++;
			continue;
		}

		const min = candidate.getUTCMinutes();
		if (!minutes.includes(min)) {
			// Advance to next minute
			candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0);
			iterations++;
			continue;
		}

		// All fields match!
		return candidate;
	}

	throw new Error(`Unable to find next run date for cron expression: "${expression}" within 5 years.`);
}

/**
 * Parse a single cron field with support for *, step (slash), range (dash), and list (comma).
 */
export function parseCronField(field: string, min: number, max: number): number[] {
	const values = new Set<number>();
	const parts = field.split(",");

	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed === "*") {
			for (let i = min; i <= max; i++) values.add(i);
		} else if (trimmed.startsWith("*/")) {
			const step = Number.parseInt(trimmed.slice(2), 10);
			if (Number.isNaN(step) || step <= 0) {
				throw new Error(`Invalid step in cron field: "${trimmed}"`);
			}
			for (let i = min; i <= max; i += step) values.add(i);
		} else if (trimmed.includes("/")) {
			const [rangePart, stepPart] = trimmed.split("/");
			const step = Number.parseInt(stepPart, 10);
			if (Number.isNaN(step) || step <= 0) {
				throw new Error(`Invalid step in cron field: "${trimmed}"`);
			}
			const [rMin, rMax] = rangePart.includes("-")
				? rangePart.split("-").map((v) => Number.parseInt(v, 10))
				: [Number.parseInt(rangePart, 10), max];
			for (let i = rMin; i <= rMax; i += step) {
				if (i >= min && i <= max) values.add(i);
			}
		} else if (trimmed.includes("-")) {
			const [start, end] = trimmed.split("-").map((v) => Number.parseInt(v, 10));
			if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < min || end > max) {
				throw new Error(`Invalid range in cron field: "${trimmed}"`);
			}
			for (let i = start; i <= end; i++) values.add(i);
		} else {
			const val = Number.parseInt(trimmed, 10);
			if (Number.isNaN(val) || val < min || val > max) {
				throw new Error(`Invalid value in cron field: "${trimmed}" (must be ${min}-${max})`);
			}
			values.add(val);
		}
	}

	return Array.from(values).sort((a, b) => a - b);
}
