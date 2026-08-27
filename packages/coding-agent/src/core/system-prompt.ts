/**
 * System prompt construction and project context loading
 */

import { getDocsPath, getExamplesPath, getReadmePath } from "../config.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const promptCwd = cwd.replace(/\\/g, "/");

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n<project_context>\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
			}
			prompt += "</project_context>\n";
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		prompt += `\nCurrent working directory: ${promptCwd}\n`;

		return prompt;
	}

	// Get absolute paths to documentation and examples
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || [
		"read",
		"bash",
		"edit",
		"write",
		"grep",
		"find",
		"ls",
		"wait_interval",
		"send_notification",
	];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Collect tool-specific guidelines only (file exploration hints, per-tool notes).
	// The core protocol is already stated above — do not duplicate it here.
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasPowerShell = tools.includes("powershell");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// File exploration hint (only when dedicated file tools are absent)
	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) {
			addGuideline("Use bash or PowerShell for file operations like listing, searching, and finding files");
		} else if (hasPowerShell) {
			addGuideline("Use PowerShell for file operations like listing, searching, and finding files");
		} else {
			addGuideline("Use bash for file operations like ls, rg, find");
		}
	}

	// Per-tool guidelines injected by individual tools (e.g. FORGE_* env vars note)
	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	const guidelines =
		guidelinesList.length > 0 ? `\n\nGuidelines:\n${guidelinesList.map((g) => `- ${g}`).join("\n")}` : "";

	let prompt = `You are an autonomous, general-purpose AI agent operating on Linux. You solve problems, automate workflows, monitor systems, manage files, and execute operational tasks with precision.

## Core Operational Protocol
1. **Direct Tool Execution**: Immediately invoke the appropriate tool for every operational, diagnostic, or coding request. Never output markdown plans or JSON code blocks instead of calling tools. Use function calling on your first turn.
2. **Parallel Tool Calls**: When multiple tools can run independently, call them all in the same response. Never make a separate turn just to issue a tool call you could have batched with others.
3. **Iterate to Completion**: Inspect tool results, evaluate whether your exit criteria are met, and continue calling tools until the task is fully done. Only report after all tool actions are verified.
4. **Log Processing**: Never read entire log files at once. Use bounded commands (\`tail -n +N\`, \`grep -n\`, \`journalctl --since\`). Deduplicate repeated lines. Extract 3–5 lines of context around errors.
5. **Polling & Waiting**: Use \`wait_interval\` instead of busy-loop bash commands when waiting for services, files, or logs to change.
6. **Notifications**: Use \`send_notification\` for email alerts, progress digests, and formatted reports. Supports HTML tables and styled markup for emails.
7. **Safety**: Never run destructive commands (\`reboot\`, \`shutdown\`, \`kill 1\`, \`mkfs\`, \`iptables -F\`, \`rm -rf /\`).
8. **Privilege & Sudo**: When elevated permissions are required on unprivileged accounts, use non-interactive \`sudo -n <command>\` to ensure commands execute seamlessly or fail fast with clear diagnostics without hanging.

Available tools:
${toolsList}${guidelines}

Forge documentation (read only when the user asks about forge itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath}`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	// Append skills section (only if read tool is available)
	if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}
