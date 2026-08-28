/**
 * Interactive Task Refinement & Evolution for Forge AI Task Architect.
 *
 * Implements `forge task refine <task>` and `forge task ai-edit <task>`.
 * Reconstructs a design session from an existing task record and on-disk manifest,
 * allowing operators to evolve goals, thresholds, schedules, policies, or scripts
 * through an interactive AI conversation.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import { stringify } from "yaml";
import { getDefaultTaskDbPath, TaskStore } from "../../store/task-store.ts";
import { PromptEngine, type PromptEngineOptions, type SelectOption } from "../wizard/prompt-engine.ts";
import { TASK_ARCHITECT_SYSTEM_PROMPT } from "./prompts.ts";
import type { ArchitectAction, TaskPlan } from "./schemas.ts";
import { loadTaskBundle, writeTaskBundle } from "./script-generator.ts";
import { createDesignSession, formatSessionContext, recordAnswer, setTaskPlan } from "./session.ts";
import { taskPlanToCreateTaskInput, validateTaskPlan } from "./validator.ts";

export interface TaskRefineOptions extends PromptEngineOptions {
	dbPath?: string;
	modelRuntime?: any;
	model?: any;
	debug?: boolean;
}

export async function runTaskRefine(taskRef: string, options: TaskRefineOptions = {}): Promise<boolean> {
	const prompt = new PromptEngine({ input: options.input, output: options.output });
	const dbPath = options.dbPath ?? getDefaultTaskDbPath();
	const store = new TaskStore(dbPath);

	try {
		const task = store.resolveTask(taskRef);
		if (!task) {
			prompt.printError(`Task not found: "${taskRef}"`);
			return false;
		}

		prompt.writeLine();
		prompt.writeLine(chalk.bold.cyan("╭────────────────────────────────────────────────────────╮"));
		prompt.writeLine(chalk.bold.cyan("│              FORGE TASK ARCHITECT: REFINE              │"));
		prompt.writeLine(chalk.bold.cyan("│            Evolve & refine existing task               │"));
		prompt.writeLine(chalk.bold.cyan("╰────────────────────────────────────────────────────────╯"));
		prompt.writeLine();

		// Load bundle manifest if present
		const bundle = loadTaskBundle(task.name);
		const manifest = bundle?.manifest;

		// Print current task overview
		prompt.writeLine(`  ${chalk.bold("Task:")}                ${chalk.green(task.name)} (${task.id})`);
		prompt.writeLine(`  ${chalk.bold("Current Goal:")}        ${task.goal}`);
		prompt.writeLine(
			`  ${chalk.bold("Strategy:")}            ${manifest?.architecture?.strategy ?? "standard"} (Scheduler: ${manifest?.architecture?.scheduler ?? "forge_sqlite"})`,
		);
		prompt.writeLine(`  ${chalk.bold("Schedule:")}            ${formatTaskSchedule(task.schedule)}`);
		prompt.writeLine(`  ${chalk.bold("Profile:")}             ${task.profile ?? "default"}`);
		prompt.writeLine(`  ${chalk.bold("Policy Mode:")}         ${task.policyMode}`);
		prompt.writeLine(`  ${chalk.bold("Privileges:")}          ${task.elevated ? "elevated (sudo)" : "standard"}`);
		prompt.writeLine(`  ${chalk.bold("Timeout:")}             ${task.timeoutSeconds}s`);

		// Load recent runs
		const recentRuns = store.listRuns(task.id, 3);
		if (recentRuns.length > 0) {
			const runSummaries = recentRuns.map(
				(r) => `${r.status} (${r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "n/a"})`,
			);
			prompt.writeLine(`  ${chalk.bold("Recent Runs:")}         ${runSummaries.join(", ")}`);
		}
		prompt.writeLine();

		// Prompt user for refinement instructions
		const refinementPrompt = await prompt.promptText(
			"What would you like to modify, tune, or re-architect in this task?",
			{ required: true },
		);

		// Prepare Design Session
		const session = createDesignSession(task.goal, {
			osName: "Linux",
			osVersion: "",
			kernel: "",
			activeServices: [],
			highUsageDisks: [],
			discoveredLogFiles: [],
			listeningPorts: [],
		});

		recordAnswer(session, "current_config", "Current Task Configuration", {
			name: task.name,
			goal: task.goal,
			schedule: task.schedule,
			policyMode: task.policyMode,
			profile: task.profile,
			elevated: task.elevated,
			strategy: manifest?.architecture?.strategy ?? "hybrid",
		});

		recordAnswer(session, "refinement_intent", "Operator Refinement Request", refinementPrompt);

		prompt.writeLine();
		prompt.writeLine(chalk.dim("  [AI] Reasoning about requested modifications..."));

		// Resolve Model Runtime
		const { modelRuntime, model } = await resolveModel(options);
		let updatedPlan: TaskPlan | undefined;

		if (modelRuntime && model) {
			try {
				const userPrompt = `${formatSessionContext(session)}\n\nThe operator wants to refine this existing task with the following changes:\n"${refinementPrompt}"\n\nGenerate an updated TaskPlan incorporating these changes. Keep the task name "${task.name}".`;
				const response = await modelRuntime.completeSimple(
					model,
					{
						messages: [
							{ role: "system", content: TASK_ARCHITECT_SYSTEM_PROMPT },
							{ role: "user", content: userPrompt },
						],
					},
					{ maxTokens: 1500 },
				);

				const text =
					response.content
						?.filter((c: any) => c.type === "text")
						.map((c: any) => c.text)
						.join("") ?? "";

				const parsed = parseArchitectJson(text);
				if (parsed && parsed.type === "task_plan") {
					updatedPlan = parsed.plan;
				}
			} catch (err: unknown) {
				if (options.debug) {
					const msg = err instanceof Error ? err.message : String(err);
					prompt.writeLine(chalk.yellow(`  [Debug] LLM refine call failed: ${msg}`));
				}
			}
		}

		// Fallback heuristic modification if LLM unavailable
		if (!updatedPlan) {
			updatedPlan = applyHeuristicRefinement(task, manifest, refinementPrompt);
		}

		setTaskPlan(session, updatedPlan);

		// Validate updated plan
		const validation = validateTaskPlan(updatedPlan);
		if (!validation.valid) {
			prompt.writeLine(chalk.red("Validation warnings for updated plan:"));
			for (const err of validation.errors) {
				prompt.writeLine(chalk.red(`  • ${err}`));
			}
		}

		// Show Proposed Changes Review
		prompt.writeLine();
		prompt.writeLine(chalk.bold.cyan("╭────────────────────────────────────────────────────────╮"));
		prompt.writeLine(chalk.bold.cyan("│                 PROPOSED TASK CHANGES                  │"));
		prompt.writeLine(chalk.bold.cyan("╰────────────────────────────────────────────────────────╯"));
		prompt.writeLine();
		prompt.writeLine(`  ${chalk.bold("Task:")}                ${chalk.green(updatedPlan.name)}`);
		prompt.writeLine(`  ${chalk.bold("Updated Goal:")}        ${updatedPlan.goal}`);
		prompt.writeLine(
			`  ${chalk.bold("Strategy:")}            ${updatedPlan.executionStrategy} (Scheduler: ${updatedPlan.scheduler})`,
		);
		prompt.writeLine(`  ${chalk.bold("Schedule:")}            ${formatScheduleObj(updatedPlan.schedule)}`);
		prompt.writeLine(`  ${chalk.bold("Profile:")}             ${updatedPlan.profile ?? "default"}`);
		prompt.writeLine(`  ${chalk.bold("Policy Mode:")}         ${updatedPlan.policyMode}`);
		prompt.writeLine(
			`  ${chalk.bold("Privileges:")}          ${updatedPlan.elevated ? "elevated (sudo)" : "standard"}`,
		);

		if (updatedPlan.explanation) {
			prompt.writeLine();
			prompt.writeLine(chalk.bold("  Rationale:"));
			prompt.writeLine(chalk.dim(`    • Strategy:  ${updatedPlan.explanation.whyStrategy}`));
			prompt.writeLine(chalk.dim(`    • Summary:   ${updatedPlan.explanation.summary}`));
		}

		prompt.writeLine();

		// Action Selection
		const actionOptions: SelectOption<"apply" | "yaml" | "cancel">[] = [
			{
				label: "Apply and save changes to Forge Task Store",
				value: "apply",
				description: "Atomically update task configuration and script bundle",
			},
			{
				label: "Export updated configuration to YAML file",
				value: "yaml",
				description: "Save declarative task YAML without overwriting store",
			},
			{
				label: "Discard changes",
				value: "cancel",
				description: "Keep original task unchanged",
			},
		];

		const chosen = await prompt.promptSelect("What would you like to do?", actionOptions, 0);

		if (chosen === "cancel") {
			prompt.writeLine(chalk.yellow("Task refinement discarded. Original task is unchanged."));
			return false;
		}

		if (chosen === "yaml") {
			const yamlPath = `tasks/${updatedPlan.name}.yaml`;
			const taskInput = taskPlanToCreateTaskInput(updatedPlan, task.enabled);
			const yamlObj = {
				name: taskInput.name,
				goal: taskInput.goal,
				architecture: {
					strategy: updatedPlan.executionStrategy,
					scheduler: updatedPlan.scheduler,
					generated_by: "forge-ai-architect-refine",
					refined_at: new Date().toISOString(),
				},
				profile: taskInput.profile,
				enabled: task.enabled,
				elevated: taskInput.elevated,
				schedule: taskInput.schedule,
				execution: {
					overlap: taskInput.overlapPolicy,
					timeout: taskInput.timeoutSeconds,
					retries: taskInput.retryPolicy?.maxRetries,
					retry_delay_seconds: taskInput.retryPolicy?.delaySeconds,
					retry_strategy: taskInput.retryPolicy?.strategy,
				},
				policy: { mode: taskInput.policyMode },
				notifications: taskInput.notifications,
			};

			try {
				mkdirSync(dirname(yamlPath), { recursive: true });
				writeFileSync(yamlPath, stringify(yamlObj, { indent: 2 }), "utf-8");
				prompt.writeLine(chalk.green(`✓ Exported updated task config to ${yamlPath}`));
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				prompt.printError(`Failed to write file: ${msg}`);
			}
			return true;
		}

		// Apply update in TaskStore
		const taskInput = taskPlanToCreateTaskInput(updatedPlan, task.enabled);
		store.updateTask(task.id, {
			goal: taskInput.goal,
			profile: taskInput.profile,
			schedule: taskInput.schedule,
			policyMode: taskInput.policyMode,
			overlapPolicy: taskInput.overlapPolicy,
			timeoutSeconds: taskInput.timeoutSeconds,
			retryPolicy: taskInput.retryPolicy,
			elevated: taskInput.elevated,
			notifications: taskInput.notifications,
		});

		// Write updated task bundle
		writeTaskBundle(updatedPlan);

		prompt.writeLine();
		prompt.writeLine(chalk.green(`✓ Task "${task.name}" refined and updated successfully.`));
		prompt.writeLine(chalk.dim("  To verify:  ") + chalk.bold(`forge task show ${task.name}`));
		prompt.writeLine(chalk.dim("  To run now: ") + chalk.bold(`forge task run ${task.name}`));

		return true;
	} finally {
		store.close();
		prompt.close();
	}
}

// ============================================================
// Internal Helpers
// ============================================================

function parseArchitectJson(text: string): ArchitectAction | null {
	let cleanText = text.trim();
	const codeFenceMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	if (codeFenceMatch) {
		cleanText = codeFenceMatch[1].trim();
	}

	try {
		const obj = JSON.parse(cleanText);
		if (obj && typeof obj === "object" && typeof obj.type === "string") {
			return obj as ArchitectAction;
		}
	} catch {
		const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			try {
				const obj = JSON.parse(jsonMatch[0]);
				if (obj && typeof obj === "object" && typeof obj.type === "string") {
					return obj as ArchitectAction;
				}
			} catch {
				// ignore
			}
		}
	}
	return null;
}

function applyHeuristicRefinement(task: any, manifest: any, refinementPrompt: string): TaskPlan {
	const lower = refinementPrompt.toLowerCase();
	let policyMode = task.policyMode;
	let schedule = task.schedule;
	let profile = task.profile ?? "sysadmin";
	let strategy = manifest?.architecture?.strategy ?? "hybrid";

	if (lower.includes("supervised")) policyMode = "supervised";
	if (lower.includes("autonomous")) policyMode = "autonomous";
	if (lower.includes("safe") || lower.includes("read-only")) policyMode = "safe";

	if (lower.includes("10m") || lower.includes("10 minutes")) {
		schedule = { type: "interval", seconds: 600 };
	} else if (lower.includes("1m") || lower.includes("1 minute") || lower.includes("60s")) {
		schedule = { type: "interval", seconds: 60 };
	} else if (lower.includes("5m") || lower.includes("5 minutes")) {
		schedule = { type: "interval", seconds: 300 };
	} else if (lower.includes("1h") || lower.includes("1 hour")) {
		schedule = { type: "interval", seconds: 3600 };
	}

	if (lower.includes("sre")) profile = "sre";
	if (lower.includes("devops")) profile = "devops";
	if (lower.includes("security")) profile = "security";

	if (lower.includes("deterministic") || lower.includes("script only")) strategy = "deterministic";
	if (lower.includes("ai only") || lower.includes("agent")) strategy = "ai_agent";

	return {
		name: task.name,
		goal: `${task.goal} (Refined: ${refinementPrompt})`,
		executionStrategy: strategy,
		scheduler: manifest?.architecture?.scheduler ?? "forge_sqlite",
		profile,
		schedule: schedule
			? {
					type: schedule.type,
					intervalSeconds: schedule.seconds,
					cronExpression: schedule.expression,
					at: schedule.at,
				}
			: undefined,
		policyMode,
		elevated: task.elevated,
		timeoutSeconds: task.timeoutSeconds,
		retries: task.retryPolicy?.maxRetries ?? 1,
		explanation: {
			summary: `Refined task based on: "${refinementPrompt}"`,
			whyStrategy: `Updated execution strategy to ${strategy}`,
			whyScheduler: "Preserved scheduler configuration",
		},
	};
}

async function resolveModel(options: TaskRefineOptions): Promise<{ modelRuntime: any; model: any }> {
	if (options.modelRuntime && options.model) {
		return { modelRuntime: options.modelRuntime, model: options.model };
	}

	try {
		const { ModelRuntime, SettingsManager, getAgentDir } = await import("@earendil-works/forge-coding-agent");
		const cwd = process.cwd();
		const agentDir = getAgentDir();
		const settingsManager = SettingsManager.create(cwd, agentDir);

		const modelRuntime =
			options.modelRuntime ?? (await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false }));
		const savedProvider = settingsManager.getDefaultProvider();
		const savedModelId = settingsManager.getDefaultModel();

		let model = savedProvider && savedModelId ? modelRuntime.getModel(savedProvider, savedModelId) : undefined;
		if (!model) {
			const available = modelRuntime.getAvailableSnapshot();
			model = available[0] ?? modelRuntime.getModels()[0];
		}

		return { modelRuntime, model };
	} catch {
		return { modelRuntime: options.modelRuntime, model: options.model };
	}
}

function formatTaskSchedule(schedule?: any): string {
	if (!schedule) return "manual (on-demand)";
	if (schedule.type === "interval") {
		if (schedule.seconds >= 3600) return `every ${schedule.seconds / 3600}h`;
		if (schedule.seconds >= 60) return `every ${schedule.seconds / 60}m`;
		return `every ${schedule.seconds}s`;
	}
	if (schedule.type === "cron") return schedule.expression;
	if (schedule.type === "once") return `once at ${schedule.at}`;
	return "unknown";
}

function formatScheduleObj(schedule?: any): string {
	if (!schedule) return "manual (on-demand)";
	if (schedule.type === "interval") {
		if (schedule.intervalHuman) return schedule.intervalHuman;
		if (schedule.intervalSeconds) {
			if (schedule.intervalSeconds >= 3600) return `every ${schedule.intervalSeconds / 3600}h`;
			if (schedule.intervalSeconds >= 60) return `every ${schedule.intervalSeconds / 60}m`;
			return `every ${schedule.intervalSeconds}s`;
		}
		return "interval";
	}
	if (schedule.type === "cron") return schedule.cronExpression ?? "cron";
	if (schedule.type === "once") return `once at ${schedule.at}`;
	return schedule.type;
}
