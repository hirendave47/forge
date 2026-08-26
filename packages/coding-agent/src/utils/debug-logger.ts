import chalk from "chalk";

const PAYLOAD_INDENT = "  ";

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

/**
 * Render a single content block to a human-readable string.
 * Used for tracing actual tokens sent/received by the LLM.
 */
function renderContentBlock(block: { type: string; [key: string]: unknown }): string {
	switch (block.type) {
		case "text":
			return String(block.text ?? "");
		case "toolCall": {
			const args =
				block.arguments !== undefined
					? typeof block.arguments === "string"
						? block.arguments
						: JSON.stringify(block.arguments, null, 2)
					: "{}";
			return `[tool_call id=${block.id} name=${block.name}]\n${args}`;
		}
		case "toolResult": {
			const parts = Array.isArray(block.content)
				? (block.content as Array<{ type: string; text?: string }>)
						.filter((c) => c.type === "text")
						.map((c) => c.text ?? "")
						.join("")
				: String(block.content ?? "");
			return `[tool_result id=${block.toolCallId} name=${block.toolName} isError=${block.isError}]\n${parts}`;
		}
		case "thinking":
			return `[thinking]\n${block.thinking ?? ""}`;
		default:
			return `[${block.type}] ${JSON.stringify(block)}`;
	}
}

/**
 * Print a multi-block payload (input context or output content) under a debug header.
 * Each message is rendered as a labelled section.
 */
export function logDebugPayload(
	category: string,
	header: string,
	messages: Array<{
		role: string;
		content?: unknown;
		[key: string]: unknown;
	}>,
): void {
	const time = formatDebugTimestamp();
	const prefix = chalk.cyan(`[${time}] [DEBUG] [${category}]`);
	const sep = chalk.dim("─".repeat(60));
	console.error(`${prefix} ${header}`);
	console.error(sep);
	for (const msg of messages) {
		const roleLabel = chalk.bold(`[${msg.role.toUpperCase()}]`);
		const content = msg.content;
		let rendered: string;
		if (content === undefined || content === null) {
			rendered = "";
		} else if (typeof content === "string") {
			rendered = content;
		} else if (Array.isArray(content)) {
			rendered = (content as Array<{ type: string; [key: string]: unknown }>).map(renderContentBlock).join("\n");
		} else {
			rendered = JSON.stringify(content);
		}
		const indented = rendered
			.split("\n")
			.map((line) => `${PAYLOAD_INDENT}${line}`)
			.join("\n");
		console.error(`${roleLabel}\n${indented}`);
	}
	console.error(sep);
}
