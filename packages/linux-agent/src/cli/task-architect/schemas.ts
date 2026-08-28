/**
 * Schemas and type definitions for the Forge AI Task Architect protocol.
 *
 * Defines structured actions, dynamic questions, host discovery requests,
 * execution strategies, and final task plans.
 */

import type { ModelTier, OverlapPolicy, PolicyMode } from "../../runtime/task-model.ts";

export type ExecutionStrategy = "deterministic" | "ai_agent" | "hybrid";

export type SchedulerType = "native_cron" | "systemd_timer" | "forge_sqlite" | "manual";

export type QuestionType =
	| "text"
	| "number"
	| "boolean"
	| "single_select"
	| "multi_select"
	| "path"
	| "duration"
	| "schedule"
	| "email"
	| "secret"
	| "confirmation";

export interface QuestionOption {
	label: string;
	value: string | number | boolean;
	description?: string;
}

export interface AIQuestion {
	id: string;
	question: string;
	type: QuestionType;
	options?: QuestionOption[];
	defaultValue?: unknown;
	required: boolean;
	reason?: string;
	risk?: "low" | "medium" | "high";
	affects?: string[];
	canSkip?: boolean;
}

export interface DiscoveryRequest {
	checkType: "service" | "port" | "log" | "disk" | "process" | "command";
	target?: string;
	reason?: string;
}

export interface DiscoveryResult {
	check: DiscoveryRequest;
	found: boolean;
	summary: string;
	details?: unknown;
}

export interface TaskRecommendation {
	executionStrategy: ExecutionStrategy;
	scheduler: SchedulerType;
	reason: string;
	alternatives?: string;
	profile?: string;
	estimatedAiCost?: "zero" | "low" | "medium" | "high";
}

export interface TaskPlanSchedule {
	type: "interval" | "cron" | "once" | "manual";
	intervalSeconds?: number;
	intervalHuman?: string;
	cronExpression?: string;
	at?: string;
}

export interface TaskPlanNotifications {
	email?: {
		to: string[];
		from?: string;
	};
	webhook?: {
		url: string;
	};
	on?: Array<"failure" | "remediation" | "success" | "all">;
}

export interface TaskPlanFastPath {
	type: "bash" | "python";
	content?: string;
	path?: string;
	description?: string;
}

export interface TaskPlanExplanation {
	summary: string;
	whyStrategy: string;
	whyScheduler: string;
	estimatedAiUsage?: string;
}

export interface TaskPlan {
	name: string;
	goal: string;
	executionStrategy: ExecutionStrategy;
	scheduler: SchedulerType;
	profile?: string;
	modelTier?: ModelTier;
	schedule?: TaskPlanSchedule;
	policyMode: PolicyMode;
	elevated?: boolean;
	overlapPolicy?: OverlapPolicy;
	toolsAllow?: string[];
	toolsDeny?: string[];
	skills?: string[];
	timeoutSeconds?: number;
	retries?: number;
	retryDelaySeconds?: number;
	retryStrategy?: "fixed" | "exponential";
	notifications?: TaskPlanNotifications;
	verification?: string[];
	fastPath?: TaskPlanFastPath;
	explanation: TaskPlanExplanation;
	confidence?: number;
}

export type ArchitectAction =
	| {
			type: "question";
			question: AIQuestion;
	  }
	| {
			type: "inspect";
			checks: DiscoveryRequest[];
			reason: string;
	  }
	| {
			type: "recommendation";
			message: string;
			recommendation?: TaskRecommendation;
	  }
	| {
			type: "task_plan";
			plan: TaskPlan;
	  }
	| {
			type: "complete";
			message?: string;
	  };
