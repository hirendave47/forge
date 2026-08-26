/**
 * Log Deduplication Processor (§12).
 *
 * Performs deterministic normalization and SHA-256 hashing of log errors.
 * Replaces repetitive raw log dumps with compact unique incident summaries,
 * capturing counts, timestamps, and surrounding context windows.
 */

import { createHash } from "node:crypto";
import type { Processor, ProcessorContext, ProcessorResult } from "./types.ts";

export interface LogDeduplicatorInput {
	lines: string[];
	/** Context window lines before and after an error (default: 3) */
	contextLines?: number;
	/** Optional regex pattern to filter lines of interest (e.g. HTTP 500, ERROR, Exception) */
	errorPattern?: RegExp | string;
}

export interface DedupIncident {
	hash: string;
	normalizedError: string;
	firstSeen: string;
	lastSeen: string;
	count: number;
	lastContext: string[];
	rawSample: string;
}

export interface LogDeduplicatorOutput {
	totalLinesProcessed: number;
	totalErrorLinesFound: number;
	uniqueIncidentsCount: number;
	incidents: DedupIncident[];
}

export class LogDeduplicatorProcessor implements Processor<LogDeduplicatorInput, LogDeduplicatorOutput> {
	readonly name = "log-deduplicator";
	readonly description = "Normalizes and deduplicates repetitive error lines into unique incidents";

	process(input: LogDeduplicatorInput, _context: ProcessorContext): ProcessorResult<LogDeduplicatorOutput> {
		const { lines } = input;
		const contextLinesCount = input.contextLines ?? 3;
		const errorRegex = input.errorPattern
			? typeof input.errorPattern === "string"
				? new RegExp(input.errorPattern, "i")
				: input.errorPattern
			: /(?:HTTP\/[0-9.]+\s+5\d\d|\b5\d\d\b|ERROR|CRITICAL|FATAL|Exception|Traceback|Panic|Failed|Timeout)/i;

		const incidentsMap = new Map<string, DedupIncident>();
		let totalErrorLines = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line || !errorRegex.test(line)) {
				continue;
			}

			totalErrorLines++;

			// 1. Normalize line (strip timestamps, IP addresses, PIDs, request IDs)
			const normalized = normalizeLogLine(line);
			const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);

			// Extract surrounding context (3 lines before, 3 lines after)
			const startIdx = Math.max(0, i - contextLinesCount);
			const endIdx = Math.min(lines.length, i + contextLinesCount + 1);
			const contextWindow = lines.slice(startIdx, endIdx);

			const timestamp = extractTimestamp(line) || new Date().toISOString();

			const existing = incidentsMap.get(hash);
			if (existing) {
				existing.count++;
				existing.lastSeen = timestamp;
				existing.lastContext = contextWindow;
			} else {
				incidentsMap.set(hash, {
					hash,
					normalizedError: normalized,
					firstSeen: timestamp,
					lastSeen: timestamp,
					count: 1,
					lastContext: contextWindow,
					rawSample: line,
				});
			}
		}

		const incidents = Array.from(incidentsMap.values()).sort((a, b) => b.count - a.count);

		// Format prompt contribution for LLM
		let promptContribution = "";
		if (incidents.length > 0) {
			promptContribution = formatIncidentsPrompt(incidents, totalErrorLines, lines.length);
		}

		return {
			data: {
				totalLinesProcessed: lines.length,
				totalErrorLinesFound: totalErrorLines,
				uniqueIncidentsCount: incidents.length,
				incidents,
			},
			promptContribution,
			metrics: {
				rawLinesRead: lines.length,
				uniqueIncidents: incidents.length,
			},
		};
	}
}

/**
 * Normalizes a log line by stripping ephemeral tokens (timestamps, PIDs, IPs, UUIDs).
 */
export function normalizeLogLine(line: string): string {
	return (
		line
			// Strip ISO / common date formats
			.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<TIME>")
			.replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+\d{2}:\d{2}:\d{2}\b/g, "<TIME>")
			.replace(/\b\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\b/g, "<TIME>")
			// Strip UUIDs
			.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
			// Strip IPv4 and IPv6
			.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, "<IP>")
			// Strip process / thread IDs like [pid 12345] or [12345:67890]
			.replace(/\[(?:pid\s*)?\d+(?::\d+)?\]/gi, "[PID]")
			// Strip random hex tokens / session hashes (8+ hex chars)
			.replace(/\b[0-9a-f]{8,}\b/gi, "<HEX>")
			// Collapse excess whitespace
			.replace(/\s+/g, " ")
			.trim()
	);
}

/**
 * Attempt to extract a timestamp string from a log line.
 */
function extractTimestamp(line: string): string | null {
	const isoMatch = line.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?/);
	if (isoMatch) return isoMatch[0];

	const syslogMatch = line.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+\d{2}:\d{2}:\d{2}/);
	if (syslogMatch) return syslogMatch[0];

	return null;
}

/**
 * Formats a clean markdown report of unique incidents for the LLM prompt.
 */
function formatIncidentsPrompt(incidents: DedupIncident[], totalErrors: number, totalLines: number): string {
	const parts: string[] = [
		`### Log Analysis & Deduplication Summary`,
		`Processed **${totalLines}** new log lines. Detected **${totalErrors}** error entries reduced to **${incidents.length}** unique incident(s):`,
		"",
	];

	for (let i = 0; i < incidents.length; i++) {
		const inc = incidents[i];
		parts.push(`#### Incident #${i + 1} (Occurrences: ${inc.count})`);
		parts.push(`- **Normalized Pattern**: \`${inc.normalizedError}\``);
		parts.push(`- **First Seen**: ${inc.firstSeen} | **Last Seen**: ${inc.lastSeen}`);
		parts.push(`- **Sample Line**: \`${inc.rawSample}\``);
		if (inc.lastContext.length > 0) {
			parts.push("- **Context Window (±3 lines)**:");
			parts.push("```text");
			parts.push(inc.lastContext.join("\n"));
			parts.push("```");
		}
		parts.push("");
	}

	return parts.join("\n");
}
