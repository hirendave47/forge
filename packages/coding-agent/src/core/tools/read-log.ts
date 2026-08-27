import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentTool } from "@earendil-works/forge-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const readLogSchema = Type.Object({
	path: Type.String({ description: "Path to the log file (e.g. /var/log/syslog, app.log)" }),
	offset: Type.Optional(
		Type.Number({ description: "Byte offset to resume reading from (from a previous read_log call). Default: 0" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to return. Default: 500" })),
	tail: Type.Optional(
		Type.Number({ description: "Read only the last N lines of the log file (ignores offset). Default: undefined" }),
	),
	filter: Type.Optional(Type.String({ description: "Optional regex or substring to filter matching lines" })),
	deduplicate: Type.Optional(
		Type.Boolean({
			description: "If true, group and deduplicate recurring error/warning lines with context. Default: true",
		}),
	),
	contextLines: Type.Optional(
		Type.Number({ description: "Number of context lines surrounding error lines when deduplicating. Default: 3" }),
	),
});

export type ReadLogToolInput = Static<typeof readLogSchema>;

const DEFAULT_CHUNK_BYTES = 512 * 1024; // 512 KB per read
const DEFAULT_LIMIT_LINES = 500;
const ERROR_PATTERN =
	/(?:HTTP\/[0-9.]+\s+5\d\d|\b5\d\d\b|ERROR|CRITICAL|FATAL|Exception|Traceback|Panic|Failed|Timeout|WARN|WARNING)/i;

function normalizeLine(line: string): string {
	return line
		.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<TIME>")
		.replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+\d{2}:\d{2}:\d{2}\b/g, "<TIME>")
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<UUID>")
		.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, "<IP>")
		.replace(/\[(?:pid\s*)?\d+(?::\d+)?\]/gi, "[PID]")
		.replace(/\s+/g, " ")
		.trim();
}

interface Incident {
	pattern: string;
	count: number;
	sample: string;
	context: string[];
}

export function createReadLogToolDefinition(
	cwd: string = process.cwd(),
): ToolDefinition<typeof readLogSchema, undefined> {
	return {
		name: "read_log",
		label: "read_log",
		description:
			"Efficiently ingest and inspect log files with bounded chunking, offset tracking, rotation detection, and error deduplication.",
		promptSnippet: "Read log files with bounded chunking, line offsets, and error deduplication",
		promptGuidelines: [
			"Use read_log instead of reading large log files all at once. Pass the returned nextOffset to poll for new log entries.",
		],
		parameters: readLogSchema,
		async execute(
			_toolCallId,
			{ path: logPath, offset = 0, limit = DEFAULT_LIMIT_LINES, tail, filter, deduplicate = true, contextLines = 3 },
			_signal,
		) {
			const absolutePath = resolve(cwd, logPath);
			if (!existsSync(absolutePath)) {
				return {
					content: [{ type: "text", text: `Log file not found: ${absolutePath}` }],
					details: undefined,
					isError: true,
				};
			}

			const stat = statSync(absolutePath);
			const fileSize = stat.size;
			const currentInode = stat.ino.toString();

			// Tail mode: read from end of file
			if (tail !== undefined && tail > 0) {
				const maxBytesToRead = Math.min(fileSize, Math.max(DEFAULT_CHUNK_BYTES, tail * 500));
				const startPos = Math.max(0, fileSize - maxBytesToRead);
				const buffer = Buffer.alloc(fileSize - startPos);

				const fd = openSync(absolutePath, "r");
				try {
					readSync(fd, buffer, 0, buffer.length, startPos);
				} finally {
					closeSync(fd);
				}

				const rawText = buffer.toString("utf-8");
				let lines = rawText.split("\n");
				if (lines.length > tail) {
					lines = lines.slice(lines.length - tail);
				}

				if (filter) {
					const filterRegex = new RegExp(filter, "i");
					lines = lines.filter((l) => filterRegex.test(l));
				}

				const summary = [
					`### Log Tail: ${logPath} (Last ${lines.length} lines, File size: ${(fileSize / 1024).toFixed(1)} KB, inode: ${currentInode})`,
					`Next offset for streaming: ${fileSize}`,
					"",
					"```text",
					lines.join("\n"),
					"```",
				].join("\n");

				return {
					content: [{ type: "text", text: summary }],
					details: undefined,
				};
			}

			// Incremental offset reading
			let startOffset = offset;
			let rotated = false;
			if (startOffset > fileSize) {
				// File was truncated or rotated
				rotated = true;
				startOffset = 0;
			}

			if (startOffset >= fileSize) {
				return {
					content: [
						{
							type: "text",
							text: `No new log entries in ${logPath}. Current offset: ${fileSize} (EOF reached). Use wait_interval before next check.`,
						},
					],
					details: undefined,
				};
			}

			const bytesToRead = Math.min(fileSize - startOffset, DEFAULT_CHUNK_BYTES);
			const buffer = Buffer.alloc(bytesToRead);

			const fd = openSync(absolutePath, "r");
			let actualBytesRead = 0;
			try {
				actualBytesRead = readSync(fd, buffer, 0, bytesToRead, startOffset);
			} finally {
				closeSync(fd);
			}

			const content = buffer.toString("utf-8", 0, actualBytesRead);
			let rawLines = content.split("\n");
			const nextOffset = startOffset + actualBytesRead;

			if (rawLines.length > limit) {
				rawLines = rawLines.slice(0, limit);
			}

			let filteredLines = rawLines;
			if (filter) {
				const filterRegex = new RegExp(filter, "i");
				filteredLines = rawLines.filter((l) => filterRegex.test(l));
			}

			const outputSections: string[] = [
				`### Log Stream: ${logPath}`,
				`- **Bytes Read**: ${actualBytesRead} bytes (${(actualBytesRead / 1024).toFixed(1)} KB)`,
				`- **Offset Range**: ${startOffset} → ${nextOffset} (Total file size: ${(fileSize / 1024).toFixed(1)} KB)`,
				`- **Lines Extracted**: ${filteredLines.length}${rotated ? " (⚠️ Log file rotation detected)" : ""}`,
				`- **Next Offset**: \`${nextOffset}\``,
				"",
			];

			if (deduplicate) {
				const incidentsMap = new Map<string, Incident>();
				let totalErrors = 0;

				for (let i = 0; i < filteredLines.length; i++) {
					const line = filteredLines[i];
					if (ERROR_PATTERN.test(line)) {
						totalErrors++;
						const norm = normalizeLine(line);
						const start = Math.max(0, i - contextLines);
						const end = Math.min(filteredLines.length, i + contextLines + 1);
						const ctx = filteredLines.slice(start, end);

						const existing = incidentsMap.get(norm);
						if (existing) {
							existing.count++;
							existing.context = ctx;
						} else {
							incidentsMap.set(norm, {
								pattern: norm,
								count: 1,
								sample: line,
								context: ctx,
							});
						}
					}
				}

				if (incidentsMap.size > 0) {
					outputSections.push(
						`#### Deduplicated Incidents (${totalErrors} error lines collapsed into ${incidentsMap.size} unique patterns):`,
					);
					let idx = 1;
					for (const inc of Array.from(incidentsMap.values()).sort((a, b) => b.count - a.count)) {
						outputSections.push(`**[#${idx++}] Pattern (Occurrences: ${inc.count})**: \`${inc.pattern}\``);
						outputSections.push(`Sample: \`${inc.sample}\``);
						if (inc.context.length > 0) {
							outputSections.push("Context:");
							outputSections.push("```text");
							outputSections.push(inc.context.join("\n"));
							outputSections.push("```\n");
						}
					}
				}
			}

			outputSections.push("#### Raw Log Content:");
			outputSections.push("```text");
			outputSections.push(filteredLines.join("\n"));
			outputSections.push("```");

			return {
				content: [{ type: "text", text: outputSections.join("\n") }],
				details: undefined,
			};
		},
	};
}

export function createReadLogTool(cwd: string = process.cwd()): AgentTool<typeof readLogSchema> {
	return wrapToolDefinition(createReadLogToolDefinition(cwd));
}
