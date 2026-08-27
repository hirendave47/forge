/**
 * Dynamic AI and Heuristic Follow-up Question Engine for Forge CLI Wizard.
 *
 * Generates tailored operational follow-up questions to clarify task goals,
 * thresholds, target paths, and remediation policies based on host context.
 */

import type { HostInfo } from "./host-inspector.ts";

export interface TaskQuestionOption {
	label: string;
	value: string;
	description?: string;
}

export interface TaskQuestion {
	id: string;
	question: string;
	type: "text" | "select" | "confirm" | "number";
	defaultVal?: string | boolean | number;
	options?: TaskQuestionOption[];
	hint?: string;
}

export interface ProfileScheduleRecommendation {
	recommendedProfile: string;
	recommendedScheduleType: "interval" | "cron" | "once" | "manual";
	recommendedInterval?: string;
	recommendedCron?: string;
}

/**
 * Generate 2-4 tailored follow-up questions for a given task goal and host environment.
 */
export async function generateTaskQuestions(
	goal: string,
	hostInfo?: HostInfo,
	options: { modelRuntime?: any } = {},
): Promise<TaskQuestion[]> {
	// Attempt AI generation if runtime is provided
	if (options.modelRuntime) {
		try {
			const aiQuestions = await generateWithModel(goal, hostInfo, options.modelRuntime);
			if (aiQuestions && aiQuestions.length > 0) {
				return aiQuestions;
			}
		} catch {
			// Fall through to heuristic generation on any LLM error
		}
	}

	return generateHeuristicQuestions(goal, hostInfo);
}

/**
 * Recommends agent persona profile and schedule cadence based on goal keywords.
 */
export function suggestProfileAndSchedule(goal: string): ProfileScheduleRecommendation {
	const lower = goal.toLowerCase();

	if (
		lower.includes("security") ||
		lower.includes("audit") ||
		lower.includes("ssh") ||
		lower.includes("cert") ||
		lower.includes("port")
	) {
		return {
			recommendedProfile: "security",
			recommendedScheduleType: "interval",
			recommendedInterval: "1h",
		};
	}

	if (lower.includes("backup") || lower.includes("dump") || lower.includes("nightly") || lower.includes("vacuum")) {
		return {
			recommendedProfile: "sre",
			recommendedScheduleType: "cron",
			recommendedCron: "0 2 * * *",
		};
	}

	if (
		lower.includes("log") ||
		lower.includes("error") ||
		lower.includes("500") ||
		lower.includes("crash") ||
		lower.includes("service")
	) {
		return {
			recommendedProfile: "sysadmin",
			recommendedScheduleType: "interval",
			recommendedInterval: "30s",
		};
	}

	if (
		lower.includes("memory") ||
		lower.includes("cpu") ||
		lower.includes("saturation") ||
		lower.includes("latency") ||
		lower.includes("alert")
	) {
		return {
			recommendedProfile: "sre",
			recommendedScheduleType: "interval",
			recommendedInterval: "1m",
		};
	}

	if (
		lower.includes("docker") ||
		lower.includes("container") ||
		lower.includes("deploy") ||
		lower.includes("ci") ||
		lower.includes("build")
	) {
		return {
			recommendedProfile: "devops",
			recommendedScheduleType: "interval",
			recommendedInterval: "5m",
		};
	}

	if (lower.includes("test") || lower.includes("refactor") || lower.includes("code") || lower.includes("git")) {
		return {
			recommendedProfile: "software-engineer",
			recommendedScheduleType: "manual",
		};
	}

	return {
		recommendedProfile: "sysadmin",
		recommendedScheduleType: "interval",
		recommendedInterval: "5m",
	};
}

/**
 * Merges the base goal with collected question answers into an enriched operational specification.
 */
export function buildEnrichedGoal(
	goal: string,
	answers: Record<string, string | boolean | number>,
	questions: TaskQuestion[],
): string {
	const answerEntries = Object.entries(answers);
	if (answerEntries.length === 0) {
		return goal;
	}

	const lines: string[] = [goal, "", "Operational Specifications:"];
	for (const [id, value] of answerEntries) {
		const q = questions.find((item) => item.id === id);
		const label = q ? q.question.replace(/\?$/, "") : id;
		const displayVal = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
		lines.push(`- ${label}: ${displayVal}`);
	}

	return lines.join("\n");
}

// ============================================================
// Internal Heuristic Generators
// ============================================================

function generateHeuristicQuestions(goal: string, hostInfo?: HostInfo): TaskQuestion[] {
	const lower = goal.toLowerCase();
	const questions: TaskQuestion[] = [];

	// 1. Log Monitoring domain
	if (
		lower.includes("log") ||
		lower.includes("error") ||
		lower.includes("nginx") ||
		lower.includes("apache") ||
		lower.includes("syslog")
	) {
		const logOptions: TaskQuestionOption[] = [];
		if (hostInfo && hostInfo.discoveredLogFiles.length > 0) {
			for (const logPath of hostInfo.discoveredLogFiles.slice(0, 4)) {
				logOptions.push({ label: logPath, value: logPath });
			}
		}
		logOptions.push({ label: "/var/log/syslog", value: "/var/log/syslog" });
		logOptions.push({ label: "Custom log path", value: "custom" });

		questions.push({
			id: "logPath",
			question: "Which log file should be monitored?",
			type: "select",
			defaultVal: logOptions[0].value,
			options: logOptions,
		});

		questions.push({
			id: "errorThreshold",
			question: "What error pattern or threshold should trigger an alert?",
			type: "text",
			defaultVal: "> 5 occurrences of ERROR|CRITICAL in 5 minutes",
		});

		questions.push({
			id: "alertAction",
			question: "Should the agent capture 5 surrounding context lines for root cause analysis?",
			type: "confirm",
			defaultVal: true,
		});

		return questions;
	}

	// 2. Disk & Space Management domain
	if (
		lower.includes("disk") ||
		lower.includes("space") ||
		lower.includes("storage") ||
		lower.includes("cleanup") ||
		lower.includes("mount")
	) {
		const defaultMount = hostInfo?.highUsageDisks[0]?.mountPoint ?? "/";

		questions.push({
			id: "diskThreshold",
			question: "What disk usage percentage threshold should trigger an alert or cleanup?",
			type: "number",
			defaultVal: 85,
			hint: "Percentage (1-99)",
		});

		questions.push({
			id: "targetMount",
			question: "Which filesystem mount point should be targeted?",
			type: "text",
			defaultVal: defaultMount,
		});

		questions.push({
			id: "dryRunFirst",
			question: "Should cleanup perform a dry-run report before removing large files?",
			type: "confirm",
			defaultVal: true,
		});

		return questions;
	}

	// 3. Service Reliability domain
	if (
		lower.includes("service") ||
		lower.includes("systemd") ||
		lower.includes("crash") ||
		lower.includes("daemon") ||
		lower.includes("down")
	) {
		const serviceOptions: TaskQuestionOption[] = [];
		if (hostInfo && hostInfo.activeServices.length > 0) {
			for (const svc of hostInfo.activeServices.slice(0, 5)) {
				serviceOptions.push({ label: `${svc}.service (active)`, value: svc });
			}
		}
		serviceOptions.push({ label: "Custom service name", value: "custom" });

		questions.push({
			id: "targetService",
			question: "Which service unit should be supervised?",
			type: serviceOptions.length > 1 ? "select" : "text",
			defaultVal: serviceOptions[0]?.value ?? "nginx",
			options: serviceOptions.length > 1 ? serviceOptions : undefined,
		});

		questions.push({
			id: "autoRestart",
			question: "If the service is stopped or failed, should Forge attempt automatic restart?",
			type: "confirm",
			defaultVal: true,
		});

		return questions;
	}

	// 4. Memory & CPU Saturation domain
	if (
		lower.includes("memory") ||
		lower.includes("ram") ||
		lower.includes("cpu") ||
		lower.includes("load") ||
		lower.includes("oom")
	) {
		questions.push({
			id: "resourceThreshold",
			question: "What utilization percentage threshold should trigger an alert?",
			type: "number",
			defaultVal: 90,
			hint: "Percentage (1-99)",
		});

		questions.push({
			id: "topProcessesCount",
			question: "How many top consuming processes should be recorded in diagnostic reports?",
			type: "number",
			defaultVal: 5,
		});

		return questions;
	}

	// 5. Docker & Container domain
	if (lower.includes("docker") || lower.includes("container") || lower.includes("podman") || lower.includes("image")) {
		questions.push({
			id: "dockerAction",
			question: "What specific container check should be performed?",
			type: "select",
			defaultVal: "unhealthy",
			options: [
				{ label: "Alert on restarting / unhealthy containers", value: "unhealthy" },
				{ label: "Prune unused / dangling images & volumes", value: "prune" },
				{ label: "Inspect container memory and CPU limits", value: "stats" },
			],
		});

		questions.push({
			id: "restartUnhealthy",
			question: "Should unhealthy containers be automatically restarted?",
			type: "confirm",
			defaultVal: false,
		});

		return questions;
	}

	// 6. Backup & Maintenance domain
	if (
		lower.includes("backup") ||
		lower.includes("dump") ||
		lower.includes("archive") ||
		lower.includes("postgres") ||
		lower.includes("mysql") ||
		lower.includes("db")
	) {
		questions.push({
			id: "backupDest",
			question: "Destination directory for backup archives",
			type: "text",
			defaultVal: "/var/backups",
		});

		questions.push({
			id: "retentionDays",
			question: "How many days of backup retention should be kept?",
			type: "number",
			defaultVal: 7,
		});

		return questions;
	}

	// 7. Generic Fallback
	questions.push({
		id: "successCondition",
		question: "What verifiable exit criteria confirms the goal is satisfied?",
		type: "text",
		defaultVal: "Zero critical errors or health check returns exit code 0",
	});

	questions.push({
		id: "alertOnFailureOnly",
		question: "Dispatch notification alerts only when issues are detected?",
		type: "confirm",
		defaultVal: true,
	});

	return questions;
}

// ============================================================
// Model-based Generator
// ============================================================

async function generateWithModel(
	goal: string,
	hostInfo: HostInfo | undefined,
	modelRuntime: any,
): Promise<TaskQuestion[] | null> {
	const hostContextStr = hostInfo
		? `Host Context:\nOS: ${hostInfo.osName} ${hostInfo.osVersion}\nActive Services: ${hostInfo.activeServices.slice(0, 6).join(", ")}\nProminent Logs: ${hostInfo.discoveredLogFiles.slice(0, 4).join(", ")}\nDisk Usage: ${hostInfo.highUsageDisks.map((d) => `${d.mountPoint} ${d.usePercentage}%`).join(", ")}`
		: "No host context available";

	const systemPrompt = `You are an expert Linux SRE & Systems Architect.
Given a user's operational task goal and host environment context, generate 2 or 3 concise, structured follow-up questions to clarify operational parameters, thresholds, target file paths, or remediation actions.

Return ONLY a JSON array with objects matching this TypeScript interface:
[
  {
    "id": string (snake_case identifier),
    "question": string,
    "type": "text" | "select" | "confirm" | "number",
    "defaultVal": string | boolean | number,
    "options": [ { "label": string, "value": string } ] (required if type is "select")
  }
]`;

	const userPrompt = `Goal: "${goal}"\n${hostContextStr}`;

	const response = await modelRuntime.completeSimple(
		modelRuntime.getFastModel?.() ?? modelRuntime.getDefaultModel?.(),
		{
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
		},
		{ maxTokens: 800 },
	);

	const text =
		response.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("") ?? "";
	const jsonMatch = text.match(/\[[\s\S]*\]/);
	if (jsonMatch) {
		const parsed = JSON.parse(jsonMatch[0]);
		if (Array.isArray(parsed) && parsed.length > 0) {
			return parsed as TaskQuestion[];
		}
	}

	return null;
}
