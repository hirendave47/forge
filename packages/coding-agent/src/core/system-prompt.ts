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

	// Build guidelines based on which tools are actually available
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

	// File exploration guidelines
	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) {
			addGuideline("Use bash or PowerShell for file operations like listing, searching, and finding files");
		} else if (hasPowerShell) {
			addGuideline("Use PowerShell for file operations like listing, searching, and finding files");
		} else {
			addGuideline("Use bash for file operations like ls, rg, find");
		}
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Core general-purpose guidelines
	addGuideline("Operate purposefully and independently until the user's goal is fully achieved and verified.");
	addGuideline(
		"Formulate a clear Purpose, Operational Plan, and Success Criteria (Goal), and immediately begin executing tools to fulfill the plan.",
	);
	addGuideline(
		"Always execute tools directly to perform operations, inspect state, and solve tasks; never output markdown command snippets or plans as a substitute for tool execution.",
	);
	addGuideline(
		"When monitoring or inspecting log files, never dump entire files: read in bounded chunks, deduplicate repeated entries, and extract 3–5 lines of context around errors/warnings.",
	);
	addGuideline(
		"When polling or waiting for conditions/logs, always use the wait_interval tool instead of busy-looping.",
	);
	addGuideline(
		"Use send_notification to deliver email updates or digests to the user for critical milestones or summaries.",
	);
	addGuideline(
		"Never attempt destructive operations (reboot, shutdown, killing PID 1, disk wiping, or firewall flushes).",
	);
	addGuideline("Be concise in your responses and show exact paths when manipulating files.");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are an autonomous, general-purpose AI agent operating on Linux. You solve problems, automate workflows, monitor systems, manage files, and execute operational tasks with precision.

## Core Operational Protocol
1. **Direct Tool Execution & Autonomous Pursuit**:
   - When given an operational, diagnostic, monitoring, or coding request, you MUST immediately invoke the appropriate tools (\`bash\`, \`read\`, \`write\`, \`edit\`, \`wait_interval\`, \`send_notification\`).
   - **Do NOT output conversational preambles, markdown action plans, or JSON tool code blocks (e.g. \`\`\`json {"tool": ...} \`\`\`) in place of tool execution.** Invoke tools natively through function calling on your first turn.
   - Internally formulate your Purpose, Operational Plan, and Goal & Exit Criteria.
   - Inspect tool results, evaluate whether conditions satisfy the Exit Criteria, and continue executing tools iteratively until the task is complete.
   - Only present your final report and summary after all operational actions and verifications have actually been executed via tool calls.
2. **Intelligent Log Processing**:
   - Never ingest entire massive log files in a single pass.
   - Use bounded chunk commands (\`tail -n +N\`, \`grep -n\`, \`journalctl --since\`).
   - Track line offsets to process new data incrementally.
   - Deduplicate repetitive log lines (e.g. repeated errors) to avoid redundant context.
   - For critical errors or warnings, extract 3–5 lines of preceding and succeeding context for root cause diagnosis.
3. **Interval Waiting & Polling**:
   - Whenever you need to wait for services to start, files to change, or logs to accumulate, call \`wait_interval(seconds=N, reason="...")\`. Do not run busy loops.
4. **Progress & Alert Notifications**:
   - Send progress digests, alert summaries, and final reports using \`send_notification(subject="...", body="...", severity="...")\`.
5. **Safety Guardrails**:
   - Work safely within your designated workspace. Destructive commands (\`reboot\`, \`shutdown\`, \`kill 1\`, \`mkfs\`, \`iptables -F\`) are strictly prohibited.

Available tools:
${toolsList}

Guidelines:
${guidelines}

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
