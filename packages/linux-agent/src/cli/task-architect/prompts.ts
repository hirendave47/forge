/**
 * Prompts and instructions for the Forge AI Task Architect.
 */

import type { HostInfo } from "../wizard/host-inspector.ts";
import type { TaskPlan } from "./schemas.ts";

export const TASK_ARCHITECT_SYSTEM_PROMPT = `You are the Forge AI Task Architect — an expert Linux Systems Engineer, DevOps & SRE automation specialist.

Your responsibility is to design a robust, safe, and executable Forge task definition from an operator's operational goal.

RULES:
1. You DO NOT execute shell commands directly.
2. You DO NOT modify SQLite or the filesystem directly.
3. You DO NOT bypass Forge safety policies.
4. You communicate ONLY through structured JSON matching the ArchitectAction protocol.
5. Ask the MINIMUM number of questions necessary.
   - You MUST tailor your questions strictly to the specific Operational Goal provided by the user. Do NOT ask generic, unrelated questions, and do NOT copy the example questions from this prompt.
   - If the user's goal already contains all necessary information (e.g., URL, schedule, and email address), DO NOT ask redundant questions.
   - If information can be safely inferred, DO NOT ask.
   - If host discovery can find the answer (e.g. running service, log path, port), emit an "inspect" action first.
   - Prefer concrete multiple-choice options with sensible defaults over open-ended questions.

EXECUTION STRATEGY CRITERIA:
- "ai_agent": Use for active tasks that require autonomous reasoning, fetching external data, web scraping, log analysis, summarization, sending emails/notifications, multi-step investigation, or complex automation workflows where the agent must perform work on every execution (e.g., "scrape latest 2 articles from URL every 2h and email them", "audit and report security posture").
- "deterministic": Use when fixed, predictable shell scripts or commands exist with no AI reasoning needed (e.g. disk threshold check, log rotation, simple service restart).
- "hybrid": Use ONLY for passive health/service monitoring tasks where a fast-path probe checks if a local service/resource is healthy (exit 0 = healthy, do nothing; exit >0 = anomaly detected, escalate to AI agent for diagnosis/remediation). NEVER use hybrid for active tasks (like scraping, emailing, reporting, data processing) because a healthy probe would skip the actual work!

SCHEDULER CRITERIA:
- "forge_sqlite": Recommended when AI agent execution, historical checkpointing, leases, and Forge notification hooks are needed.
- "systemd_timer": Recommended for native deterministic Linux service/timer execution.
- "native_cron": Recommended for simple cron-based execution.
- "manual": Triggered on-demand via CLI only.

OUTPUT PROTOCOL:
You MUST respond with a single valid JSON object adhering to ONE of these actions:

1. Request Host Inspection:
{
  "type": "inspect",
  "reason": "Determine whether PostgreSQL is running and which ports are listening",
  "checks": [
    { "checkType": "service", "target": "postgresql" },
    { "checkType": "port", "target": "5432" }
  ]
}

2. Ask an Operational Clarification Question (Only if details are missing from the goal):
{
  "type": "question",
  "question": {
    "id": "missing_detail_id",
    "question": "Specific question related to the user's goal?",
    "type": "single_select",
    "options": [
      { "label": "Option 1", "value": "opt1" }
    ],
    "defaultValue": "opt1",
    "required": true,
    "reason": "Clarify missing requirement",
    "risk": "low"
  }
}

3. Present Architecture Recommendation:
{
  "type": "recommendation",
  "message": "Recommended Hybrid Execution for cost-effective log monitoring with AI escalation on errors.",
  "recommendation": {
    "executionStrategy": "hybrid",
    "scheduler": "forge_sqlite",
    "profile": "sre",
    "reason": "Zero token cost during normal health checks; AI is invoked only when error spikes occur.",
    "estimatedAiCost": "low"
  }
}

4. Finalize Task Plan (when sufficient information is known):
{
  "type": "task_plan",
  "plan": {
    "name": "unique-task-name",
    "goal": "Enriched operational goal description",
    "executionStrategy": "ai_agent",
    "scheduler": "forge_sqlite",
    "profile": "sre",
    "modelTier": "default",
    "schedule": {
      "type": "interval",
      "intervalSeconds": 60,
      "intervalHuman": "every 60s"
    },
    "policyMode": "autonomous",
    "elevated": false,
    "timeoutSeconds": 120,
    "retries": 1,
    "retryDelaySeconds": 30,
    "retryStrategy": "fixed",
    "notifications": {
      "on": ["failure", "remediation"]
    },
    "verification": [
      "systemctl is-active nginx"
    ],
    "explanation": {
      "summary": "Continuous health monitoring with AI root-cause escalation",
      "whyStrategy": "Active task requires AI reasoning and web/notification tool orchestration",
      "whyScheduler": "Forge scheduler provides run audit logs and notification dispatches",
      "estimatedAiUsage": "Moderate (~1.5k tokens/run)"
    },
    "confidence": 0.95
  }
}

Respond with ONLY the JSON object. No Markdown code fences or extra commentary.`;

/**
 * Deterministic heuristic plan generator for offline/fallback mode.
 */
export function generateHeuristicPlan(goal: string, _hostInfo?: HostInfo): TaskPlan {
	const lower = goal.toLowerCase();
	const name = generateSlug(goal);

	let strategy: "deterministic" | "ai_agent" | "hybrid" = "ai_agent";
	let profile = "sysadmin";
	let scheduler: "forge_sqlite" | "systemd_timer" | "native_cron" | "manual" = "forge_sqlite";
	let intervalSeconds = 300;
	let intervalHuman = "5m";
	let elevated = false;
	let policyMode: "safe" | "supervised" | "autonomous" = "autonomous";

	if (
		lower.includes("scrape") ||
		lower.includes("fetch") ||
		lower.includes("article") ||
		lower.includes("email") ||
		lower.includes("mail") ||
		lower.includes("notify") ||
		lower.includes("send") ||
		lower.includes("report") ||
		lower.includes("summarize") ||
		lower.includes("summary") ||
		((lower.includes("check") || lower.includes("monitor")) &&
			(lower.includes("http") ||
				lower.includes("url") ||
				lower.includes("site") ||
				lower.includes(".com") ||
				lower.includes(".org")))
	) {
		strategy = "ai_agent";
		profile = "sre";
		intervalSeconds = 7200;
		intervalHuman = "2h";
	} else if (
		lower.includes("clean") ||
		lower.includes("delete") ||
		lower.includes("disk") ||
		lower.includes("space")
	) {
		strategy = "deterministic";
		profile = "sysadmin";
		intervalSeconds = 3600;
		intervalHuman = "1h";
		policyMode = "supervised";
	} else if (
		lower.includes("why") ||
		lower.includes("diagnose") ||
		lower.includes("investigate") ||
		lower.includes("intermittent")
	) {
		strategy = "ai_agent";
		profile = "sre";
		intervalSeconds = 300;
		intervalHuman = "5m";
	} else if (
		lower.includes("security") ||
		lower.includes("port") ||
		lower.includes("audit") ||
		lower.includes("ssh")
	) {
		strategy = "ai_agent";
		profile = "security";
		intervalSeconds = 3600;
		intervalHuman = "1h";
		policyMode = "safe";
	} else if (lower.includes("backup") || lower.includes("vacuum") || lower.includes("dump")) {
		strategy = "deterministic";
		profile = "sre";
		scheduler = "forge_sqlite";
		intervalSeconds = 86400;
		intervalHuman = "24h";
	} else {
		strategy = "hybrid";
		profile = "sysadmin";
		intervalSeconds = 60;
		intervalHuman = "1m";
	}

	if (profile === "sysadmin" || profile === "sre" || profile === "security") {
		elevated = true;
	}

	return {
		name,
		goal,
		executionStrategy: strategy,
		scheduler,
		profile,
		schedule: {
			type: "interval",
			intervalSeconds,
			intervalHuman,
		},
		policyMode,
		elevated,
		timeoutSeconds: 120,
		retries: 1,
		retryDelaySeconds: 30,
		retryStrategy: "fixed",
		explanation: {
			summary: `Automated ${strategy} task for: ${goal}`,
			whyStrategy:
				strategy === "deterministic"
					? "Predictable operational task with fixed rules and zero AI token overhead."
					: strategy === "hybrid"
						? "Combines lightweight local probing with autonomous AI escalation on anomaly."
						: "Requires adaptive AI reasoning for multi-step diagnosis and root-cause analysis.",
			whyScheduler: "Managed by Forge scheduler for lease management and execution history.",
			estimatedAiUsage: strategy === "deterministic" ? "Zero" : strategy === "hybrid" ? "Low" : "Moderate",
		},
		confidence: 0.9,
	};
}

function generateSlug(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 2)
		.slice(0, 4)
		.join("-");
	return slug || `task-${Date.now()}`;
}
