/**
 * Task Plan Validator and Materializer.
 *
 * Deterministically checks proposed TaskPlan specifications against Forge
 * constraints and policy engine safety rules before user approval and persistence.
 */

import {
	type CreateTaskInput,
	DEFAULT_OVERLAP_POLICY,
	DEFAULT_TIMEOUT_SECONDS,
	type TaskSchedule,
} from "../../runtime/task-model.ts";
import { computeNextCronRun } from "../../scheduler/cron.ts";
import type { TaskPlan } from "./schemas.ts";

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Validates a TaskPlan object before user review and persistence.
 */
export function validateTaskPlan(plan: TaskPlan): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	// 1. Task Name
	if (!plan.name || plan.name.trim().length === 0) {
		errors.push("Task name cannot be empty.");
	} else if (!/^[a-z0-9-_]+$/i.test(plan.name)) {
		errors.push("Task name must contain only letters, numbers, hyphens, and underscores.");
	}

	// 2. Goal
	if (!plan.goal || plan.goal.trim().length === 0) {
		errors.push("Task goal cannot be empty.");
	}

	// 3. Execution Strategy
	if (!["deterministic", "ai_agent", "hybrid"].includes(plan.executionStrategy)) {
		errors.push(`Invalid execution strategy: "${plan.executionStrategy}".`);
	}

	// 4. Scheduler
	if (!["native_cron", "systemd_timer", "forge_sqlite", "manual"].includes(plan.scheduler)) {
		errors.push(`Invalid scheduler: "${plan.scheduler}".`);
	}

	// 5. Schedule
	if (plan.schedule) {
		const s = plan.schedule;
		if (s.type === "interval") {
			if (!s.intervalSeconds || s.intervalSeconds <= 0) {
				errors.push("Interval schedule must have intervalSeconds > 0.");
			}
		} else if (s.type === "cron") {
			if (!s.cronExpression) {
				errors.push("Cron schedule must have a cronExpression.");
			} else {
				try {
					computeNextCronRun(s.cronExpression);
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					errors.push(`Invalid cron expression: "${s.cronExpression}" (${msg}).`);
				}
			}
		} else if (s.type === "once") {
			if (!s.at) {
				errors.push("Once schedule must specify an ISO datetime 'at'.");
			} else {
				const d = new Date(s.at);
				if (Number.isNaN(d.getTime())) {
					errors.push(`Invalid ISO datetime: "${s.at}".`);
				} else if (d.getTime() <= Date.now()) {
					warnings.push("Scheduled 'once' time is already in the past.");
				}
			}
		}
	}

	// 6. Policy Mode
	if (!["safe", "supervised", "autonomous"].includes(plan.policyMode)) {
		errors.push(`Invalid policy mode: "${plan.policyMode}".`);
	}

	// 7. Timeout & Retries
	if (plan.timeoutSeconds !== undefined) {
		if (plan.timeoutSeconds < 5 || plan.timeoutSeconds > 86400) {
			errors.push("Timeout must be between 5 and 86400 seconds.");
		}
	}

	if (plan.retries !== undefined && (plan.retries < 0 || plan.retries > 20)) {
		errors.push("Retries must be between 0 and 20.");
	}

	// 8. Notifications
	if (plan.notifications?.webhook?.url) {
		const url = plan.notifications.webhook.url;
		if (!url.startsWith("http://") && !url.startsWith("https://")) {
			errors.push(`Invalid notification webhook URL: "${url}". Must start with http:// or https://`);
		}
	}

	if (plan.notifications?.email?.to) {
		for (const email of plan.notifications.email.to) {
			if (!email.includes("@")) {
				warnings.push(`Possible malformed email recipient: "${email}".`);
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Converts a validated TaskPlan into a standard CreateTaskInput for TaskStore persistence.
 */
export function taskPlanToCreateTaskInput(plan: TaskPlan, enabled = true): CreateTaskInput {
	let schedule: TaskSchedule | undefined;
	if (plan.schedule && plan.schedule.type !== "manual") {
		if (plan.schedule.type === "interval" && plan.schedule.intervalSeconds) {
			schedule = { type: "interval", seconds: plan.schedule.intervalSeconds };
		} else if (plan.schedule.type === "cron" && plan.schedule.cronExpression) {
			schedule = { type: "cron", expression: plan.schedule.cronExpression };
		} else if (plan.schedule.type === "once" && plan.schedule.at) {
			schedule = { type: "once", at: new Date(plan.schedule.at).toISOString() };
		}
	}

	return {
		name: plan.name,
		goal: plan.goal,
		profile: plan.profile === "none" ? undefined : plan.profile,
		schedule,
		enabled,
		overlapPolicy: plan.overlapPolicy ?? DEFAULT_OVERLAP_POLICY,
		timeoutSeconds: plan.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
		retryPolicy:
			plan.retries && plan.retries > 0
				? {
						maxRetries: plan.retries,
						delaySeconds: plan.retryDelaySeconds ?? 30,
						strategy: plan.retryStrategy ?? "fixed",
					}
				: undefined,
		policyMode: plan.policyMode,
		modelTier: plan.modelTier,
		elevated: plan.elevated ?? false,
		toolsAllow: plan.toolsAllow,
		toolsDeny: plan.toolsDeny,
		skills: plan.skills,
		notifications:
			plan.notifications?.email || plan.notifications?.webhook
				? {
						email: plan.notifications.email ? { to: plan.notifications.email.to } : undefined,
						webhook: plan.notifications.webhook ? { url: plan.notifications.webhook.url } : undefined,
					}
				: undefined,
	};
}
