/**
 * Forge AI Task Architect module exports.
 */

export { runTaskArchitect, type TaskArchitectOptions } from "./architect.ts";
export { executeDiscoveryRequest, executeDiscoveryRequests } from "./discovery-planner.ts";
export { generateHeuristicPlan, TASK_ARCHITECT_SYSTEM_PROMPT } from "./prompts.ts";
export { runTaskRefine, type TaskRefineOptions } from "./refine.ts";
export type {
	AIQuestion,
	ArchitectAction,
	DiscoveryRequest,
	DiscoveryResult,
	ExecutionStrategy,
	QuestionOption,
	QuestionType,
	SchedulerType,
	TaskPlan,
	TaskPlanExplanation,
	TaskPlanFastPath,
	TaskPlanNotifications,
	TaskPlanSchedule,
	TaskRecommendation,
} from "./schemas.ts";
export {
	getTaskBundleDir,
	loadTaskBundle,
	type TaskBundle,
	type TaskManifest,
	validateScriptSyntax,
	writeTaskBundle,
} from "./script-generator.ts";
export {
	createDesignSession,
	formatSessionContext,
	type QuestionAnswer,
	recordAnswer,
	recordDiscovery,
	recordRecommendation,
	setTaskPlan,
	type TaskDesignSession,
} from "./session.ts";
export {
	taskPlanToCreateTaskInput,
	type ValidationResult,
	validateTaskPlan,
} from "./validator.ts";
