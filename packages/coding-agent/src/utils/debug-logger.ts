import chalk from "chalk";

/**
 * Format a date to `YYYY-MM-DD HH:mm:ss.SSS` timestamp string.
 */
export function formatDebugTimestamp(date = new Date()): string {
	const pad = (n: number, z = 2) => String(n).padStart(z, "0");
	const Y = date.getFullYear();
	const M = pad(date.getMonth() + 1);
	const D = pad(date.getDate());
	const h = pad(date.getHours());
	const m = pad(date.getMinutes());
	const s = pad(date.getSeconds());
	const ms = pad(date.getMilliseconds(), 3);
	return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`;
}

export interface TokenUsageStats {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
}

/**
 * Format token stats into a readable debug summary string.
 */
export function formatTokenSummary(usage: TokenUsageStats): string {
	const inTokens = usage.input ?? 0;
	const outTokens = usage.output ?? 0;
	const cacheRead = usage.cacheRead ?? 0;
	const cacheWrite = usage.cacheWrite ?? 0;
	const total = usage.totalTokens ?? inTokens + outTokens;

	const parts: string[] = [`Input=${inTokens.toLocaleString()}`, `Output=${outTokens.toLocaleString()}`];
	if (cacheRead > 0) {
		parts.push(`CacheRead=${cacheRead.toLocaleString()}`);
	}
	if (cacheWrite > 0) {
		parts.push(`CacheWrite=${cacheWrite.toLocaleString()}`);
	}
	parts.push(`Total=${total.toLocaleString()}`);
	return parts.join(", ");
}

/**
 * Print a structured debug log line to stderr with a timestamp.
 */
export function logDebug(category: string, message: string, data?: unknown): void {
	const time = formatDebugTimestamp();
	const prefix = chalk.cyan(`[${time}] [DEBUG] [${category}]`);
	if (data !== undefined) {
		const extra = typeof data === "string" ? data : JSON.stringify(data);
		console.error(`${prefix} ${message} — ${extra}`);
	} else {
		console.error(`${prefix} ${message}`);
	}
}
