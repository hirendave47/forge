/**
 * Dynamic Tool Selector for Forge Linux Agent (§17).
 *
 * Selects only relevant tools based on the task goal, profile, and explicit allow/deny lists.
 * Reduces tool-schema token overhead and improves LLM tool call accuracy.
 */

export interface ToolSelectionContext {
	goal: string;
	profile?: string;
	toolsAllow?: string[];
	toolsDeny?: string[];
}

const TOOL_KEYWORDS: Record<string, string[]> = {
	grep: ["grep", "search", "find in file", "regex", "scan logs", "pattern"],
	find: ["find file", "locate", "directory tree", "search files"],
	ls: ["list files", "ls", "show files", "directory contents"],
	edit: ["edit", "modify", "change config", "update file", "patch", "replace in file"],
	write: ["write file", "save file", "create file", "dump to", "generate report"],
	read: ["read", "inspect file", "view log", "examine", "cat"],
	wait_interval: ["wait", "poll", "interval", "loop", "delay", "sleep", "monitor"],
	send_notification: ["email", "notify", "alert", "report to", "digest", "send summary"],
};

export function selectToolsForTask(context: ToolSelectionContext): string[] {
	// If explicit allow list provided, start with that
	if (context.toolsAllow && context.toolsAllow.length > 0) {
		const denySet = new Set(context.toolsDeny || []);
		return context.toolsAllow.filter((t) => !denySet.has(t));
	}

	const selected = new Set<string>(["bash", "read"]); // Base universal tools
	const goalLower = context.goal.toLowerCase();

	// Match keywords
	for (const [tool, keywords] of Object.entries(TOOL_KEYWORDS)) {
		if (keywords.some((kw) => goalLower.includes(kw))) {
			selected.add(tool);
		}
	}

	// Add profile defaults
	if (context.profile === "sysadmin" || context.profile === "devops") {
		selected.add("grep");
		selected.add("edit");
		selected.add("send_notification");
		selected.add("wait_interval");
	} else if (context.profile === "sre") {
		selected.add("grep");
		selected.add("find");
		selected.add("send_notification");
		selected.add("wait_interval");
	} else if (context.profile === "software-engineer") {
		selected.add("grep");
		selected.add("find");
		selected.add("edit");
		selected.add("write");
	}

	// Apply explicit deny list
	if (context.toolsDeny) {
		for (const denied of context.toolsDeny) {
			selected.delete(denied);
		}
	}

	return Array.from(selected);
}
