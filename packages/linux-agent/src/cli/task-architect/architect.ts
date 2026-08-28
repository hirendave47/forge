/**
 * Forge AI Task Architect — Main Interactive Session Controller.
 *
 * Implements the stateful conversational loop where the LLM dynamically evaluates
 * missing information, requests host discoveries, asks structured questions, recommends
 * execution strategies and schedulers, and presents a finalized TaskPlan for user review.
 */

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import { stringify } from "yaml";
import type { CreateTaskInput } from "../../runtime/task-model.ts";
import { getDefaultTaskDbPath, TaskStore } from "../../store/task-store.ts";
import { isDaemonRunning, startDaemonService } from "../../systemd/installer.ts";
import { type HostInfo, inspectHost } from "../wizard/host-inspector.ts";
import { PromptEngine, type PromptEngineOptions, type SelectOption } from "../wizard/prompt-engine.ts";
import { executeDiscoveryRequests } from "./discovery-planner.ts";
import { generateHeuristicPlan, TASK_ARCHITECT_SYSTEM_PROMPT } from "./prompts.ts";
import type { AIQuestion, ArchitectAction, TaskPlan } from "./schemas.ts";
import {
	createDesignSession,
	formatSessionContext,
	recordAnswer,
	recordDiscovery,
	recordRecommendation,
	setTaskPlan,
	type TaskDesignSession,
} from "./session.ts";
import { taskPlanToCreateTaskInput, validateTaskPlan } from "./validator.ts";

export interface TaskArchitectOptions extends PromptEngineOptions {
	initialGoal?: string;
	dbPath?: string;
	modelRuntime?: any;
	model?: any;
	autoStartDaemon?: boolean;
	maxTurns?: number;
	debug?: boolean;
	inspectHostContext?: boolean;
}

export async function runTaskArchitect(options: TaskArchitectOptions = {}): Promise<CreateTaskInput | null> {
	const prompt = new PromptEngine({ input: options.input, output: options.output });
	const dbPath = options.dbPath ?? getDefaultTaskDbPath();
	const maxTurns = options.maxTurns ?? 10;
	const enableHostDiscovery = options.inspectHostContext ?? true;

	try {
		prompt.writeLine();
		prompt.writeLine(chalk.bold.cyan("╭────────────────────────────────────────────────────────╮"));
		prompt.writeLine(chalk.bold.cyan("│              FORGE AI TASK ARCHITECT                   │"));
		prompt.writeLine(chalk.bold.cyan("│       Design an operational task with AI               │"));
		prompt.writeLine(chalk.bold.cyan("╰────────────────────────────────────────────────────────╯"));
		prompt.writeLine();

		// 1. Goal formulation
		let goal = options.initialGoal;
		if (!goal || goal.trim().length === 0) {
			goal = await prompt.promptText("What is the operational goal for this task?", {
				required: true,
			});
		} else {
			prompt.writeLine(`${chalk.bold.cyan("?")} ${chalk.bold("Task Goal")}: ${chalk.green(goal)}`);
		}

		// 2. Initial Host Inspection
		let hostInfo: HostInfo;
		if (enableHostDiscovery) {
			prompt.writeLine(chalk.dim("  [AI] Inspecting host environment..."));
			hostInfo = inspectHost({ timeoutMs: 1500 });
			const badges: string[] = [`OS: ${hostInfo.osName}`];
			if (hostInfo.activeServices.length > 0) {
				badges.push(`Services: ${hostInfo.activeServices.slice(0, 4).join(", ")}`);
			}
			if (hostInfo.highUsageDisks.length > 0) {
				badges.push(`Disk /: ${hostInfo.highUsageDisks[0].usePercentage}%`);
			}
			prompt.writeLine(chalk.dim(`  [Host Context] ${badges.join(" | ")}`));
		} else {
			hostInfo = {
				osName: "Linux",
				osVersion: "",
				kernel: "",
				activeServices: [],
				highUsageDisks: [],
				discoveredLogFiles: [],
				listeningPorts: [],
			};
		}

		// 3. Initialize Design Session
		const session = createDesignSession(goal, hostInfo);

		// 4. Resolve Model Runtime (with graceful heuristic fallback)
		const { modelRuntime, model } = await resolveModel(options);

		// 5. Conversational Loop
		prompt.writeLine();
		prompt.writeLine(chalk.dim("  [AI] Analyzing task requirements and determining architecture..."));

		let completedPlan: TaskPlan | undefined;
		let turn = 0;

		while (turn < maxTurns && !completedPlan) {
			turn++;
			session.turns = turn;

			let action: ArchitectAction | null = null;

			if (modelRuntime && model) {
				try {
					action = await callArchitectModel(modelRuntime, model, session);
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					prompt.writeLine(
						chalk.yellow(`  ⚠️  AI Architect unavailable (${msg}). Falling back to heuristic wizard.`),
					);
					// Fall through to heuristic
				}
			}

			// Fallback to heuristic if no model or model returned null
			if (!action) {
				if (session.answers.length === 0 && turn === 1) {
					// Ask a basic question before finalizing heuristic
					action = {
						type: "question",
						question: {
							id: "remediation_preference",
							question: "How should Forge respond when issues or failures are detected?",
							type: "single_select",
							options: [
								{ label: "Diagnose & remediate automatically", value: "auto" },
								{ label: "Diagnose & notify only (alerting)", value: "alert" },
								{ label: "Diagnose & require approval before remediating", value: "supervised" },
							],
							defaultValue: "auto",
							required: true,
						},
					};
				} else {
					action = {
						type: "task_plan",
						plan: generateHeuristicPlan(session.goal, hostInfo),
					};
				}
			}

			// Process Action
			if (action.type === "inspect") {
				prompt.writeLine(chalk.cyan(`  [AI Inspection] ${action.reason}`));
				const results = executeDiscoveryRequests(action.checks);
				for (const res of results) {
					recordDiscovery(session, res);
					const icon = res.found ? chalk.green("✓") : chalk.dim("○");
					prompt.writeLine(chalk.dim(`    ${icon} ${res.summary}`));
				}
				prompt.writeLine();
				continue;
			}

			if (action.type === "recommendation") {
				prompt.writeLine(chalk.bold.blue(`  [AI Architecture Note] ${action.message}`));
				if (action.recommendation) {
					recordRecommendation(session, action.recommendation);
				}
				prompt.writeLine();
				continue;
			}

			if (action.type === "question") {
				const q = action.question;
				if (q.reason) {
					prompt.writeLine(chalk.dim(`  [AI] ${q.reason}`));
				}

				const answer = await promptUserQuestion(prompt, q);
				recordAnswer(session, q.id, q.question, answer);
				prompt.writeLine();
				continue;
			}

			if (action.type === "task_plan") {
				completedPlan = action.plan;
				setTaskPlan(session, action.plan);
				break;
			}

			if (action.type === "complete") {
				if (session.taskPlan) {
					completedPlan = session.taskPlan;
				} else {
					completedPlan = generateHeuristicPlan(session.goal, hostInfo);
					setTaskPlan(session, completedPlan);
				}
				break;
			}
		}

		if (!completedPlan) {
			completedPlan = generateHeuristicPlan(session.goal, hostInfo);
			setTaskPlan(session, completedPlan);
		}

		// 6. Validate Plan
		const validation = validateTaskPlan(completedPlan);
		if (!validation.valid) {
			prompt.writeLine(chalk.red("Task plan has validation issues:"));
			for (const err of validation.errors) {
				prompt.writeLine(chalk.red(`  • ${err}`));
			}
		}
		if (validation.warnings.length > 0) {
			for (const warn of validation.warnings) {
				prompt.writeLine(chalk.yellow(`  ⚠️  ${warn}`));
			}
		}

		// 7. User Review Phase
		prompt.writeLine();
		prompt.writeLine(chalk.bold.cyan("╭────────────────────────────────────────────────────────╮"));
		prompt.writeLine(chalk.bold.cyan("│                 PROPOSED FORGE TASK                    │"));
		prompt.writeLine(chalk.bold.cyan("╰────────────────────────────────────────────────────────╯"));
		prompt.writeLine();
		prompt.writeLine(`  ${chalk.bold("Goal:")}               ${completedPlan.goal}`);
		prompt.writeLine(`  ${chalk.bold("Task Name:")}          ${chalk.green(completedPlan.name)}`);
		prompt.writeLine(`  ${chalk.bold("Execution Strategy:")} ${formatStrategy(completedPlan.executionStrategy)}`);
		prompt.writeLine(`  ${chalk.bold("Scheduler:")}          ${formatScheduler(completedPlan.scheduler)}`);
		prompt.writeLine(`  ${chalk.bold("Schedule:")}           ${formatSchedule(completedPlan.schedule)}`);
		prompt.writeLine(`  ${chalk.bold("Profile:")}            ${completedPlan.profile ?? "default"}`);
		prompt.writeLine(`  ${chalk.bold("Safety Policy:")}      ${completedPlan.policyMode}`);
		prompt.writeLine(
			`  ${chalk.bold("Privileges:")}         ${completedPlan.elevated ? "elevated (sudo)" : "standard"}`,
		);
		prompt.writeLine(`  ${chalk.bold("Timeout:")}            ${completedPlan.timeoutSeconds ?? 120}s`);

		if (completedPlan.retries && completedPlan.retries > 0) {
			prompt.writeLine(
				`  ${chalk.bold("Retries:")}            max=${completedPlan.retries}, delay=${completedPlan.retryDelaySeconds ?? 30}s (${completedPlan.retryStrategy ?? "fixed"})`,
			);
		}

		if (completedPlan.notifications?.email?.to) {
			prompt.writeLine(`  ${chalk.bold("Notify Email:")}       ${completedPlan.notifications.email.to.join(", ")}`);
		}
		if (completedPlan.notifications?.webhook?.url) {
			prompt.writeLine(`  ${chalk.bold("Notify Webhook:")}     ${completedPlan.notifications.webhook.url}`);
		}
		if (completedPlan.verification && completedPlan.verification.length > 0) {
			prompt.writeLine(`  ${chalk.bold("Verification:")}       ${completedPlan.verification.join("; ")}`);
		}

		if (completedPlan.explanation) {
			prompt.writeLine();
			prompt.writeLine(chalk.bold("  Architecture Rationale:"));
			prompt.writeLine(chalk.dim(`    • Strategy:  ${completedPlan.explanation.whyStrategy}`));
			prompt.writeLine(chalk.dim(`    • Scheduler: ${completedPlan.explanation.whyScheduler}`));
			if (completedPlan.explanation.estimatedAiUsage) {
				prompt.writeLine(chalk.dim(`    • AI Usage:  ${completedPlan.explanation.estimatedAiUsage}`));
			}
		}

		prompt.writeLine();

		// 8. Action Selection
		const actionOptions: SelectOption<"save" | "save_disabled" | "edit" | "yaml" | "cancel">[] = [
			{
				label: "Create and enable task in Forge Task Store",
				value: "save",
				description: "Store in SQLite and schedule with daemon",
			},
			{
				label: "Create task in disabled state",
				value: "save_disabled",
				description: "Register in SQLite without immediate scheduling",
			},
			{
				label: "Export to YAML configuration file",
				value: "yaml",
				description: "Save declarative task file for version control",
			},
			{
				label: "Cancel and discard",
				value: "cancel",
				description: "Exit without creating task",
			},
		];

		const chosenAction = await prompt.promptSelect("What would you like to do?", actionOptions, 0);

		if (chosenAction === "cancel") {
			prompt.writeLine(chalk.yellow("Task design session cancelled."));
			return null;
		}

		if (chosenAction === "yaml") {
			const defaultYamlPath = `tasks/${completedPlan.name}.yaml`;
			const yamlPath = await prompt.promptText("Save YAML file to path", {
				defaultVal: defaultYamlPath,
			});

			const taskInput = taskPlanToCreateTaskInput(completedPlan, true);
			const yamlObj = {
				name: taskInput.name,
				goal: taskInput.goal,
				architecture: {
					strategy: completedPlan.executionStrategy,
					scheduler: completedPlan.scheduler,
					generated_by: "forge-ai-architect",
					confidence: completedPlan.confidence,
				},
				profile: taskInput.profile,
				enabled: true,
				elevated: taskInput.elevated,
				schedule: taskInput.schedule
					? taskInput.schedule.type === "interval"
						? { type: "interval", seconds: taskInput.schedule.seconds }
						: taskInput.schedule.type === "cron"
							? { type: "cron", expression: taskInput.schedule.expression }
							: { type: "once", at: taskInput.schedule.at }
					: undefined,
				execution: {
					overlap: taskInput.overlapPolicy,
					timeout: taskInput.timeoutSeconds,
					retries: taskInput.retryPolicy?.maxRetries,
					retry_delay_seconds: taskInput.retryPolicy?.delaySeconds,
					retry_strategy: taskInput.retryPolicy?.strategy,
				},
				policy: { mode: taskInput.policyMode },
				notifications: taskInput.notifications,
				verification: completedPlan.verification,
			};

			const yamlContent = stringify(yamlObj, { indent: 2 });
			try {
				const { mkdirSync } = await import("node:fs");
				mkdirSync(dirname(yamlPath), { recursive: true });
				writeFileSync(yamlPath, yamlContent, "utf-8");
				prompt.writeLine(chalk.green(`✓ Exported task config to ${yamlPath}`));
				prompt.writeLine(chalk.dim(`  To create later: forge task create --from ${yamlPath}`));
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				prompt.printError(`Failed to write file: ${msg}`);
			}
			return taskInput;
		}

		// Save in TaskStore
		const isEnabled = chosenAction === "save";
		const taskInput = taskPlanToCreateTaskInput(completedPlan, isEnabled);
		const store = new TaskStore(dbPath);

		try {
			const created = store.createTask(taskInput);
			prompt.writeLine();
			prompt.writeLine(
				chalk.green(`✓ Task materialized and registered successfully: ${chalk.bold(created.name)} (${created.id})`),
			);
			prompt.writeLine(
				chalk.dim(`  Architecture: ${completedPlan.executionStrategy} | Scheduler: ${completedPlan.scheduler}`),
			);

			// Write task bundle (script.sh, manifest.json, README.md, verification.sh)
			const { writeTaskBundle } = await import("./script-generator.ts");
			writeTaskBundle(completedPlan);

			if (created.elevated) {
				prompt.writeLine(chalk.dim("  Privilege: elevated (sudo)"));
				const { checkPrivilegeLevel } = await import("../../systemd/sudoers.ts");
				const priv = checkPrivilegeLevel();
				if (priv.level === "unprivileged") {
					prompt.writeLine(
						chalk.yellow(
							"  ⚠️  Warning: Current user lacks passwordless sudo. Elevated operations may require approval.",
						),
					);
					prompt.writeLine(
						chalk.dim(
							'      To configure sudo: "forge task sudoers show" (or "sudo forge task sudoers install")',
						),
					);
				}
			}

			if (created.schedule && isEnabled) {
				prompt.writeLine(chalk.dim(`  Schedule: ${formatSchedule(completedPlan.schedule)}`));
				const daemonStatus = isDaemonRunning();
				if (!daemonStatus.running) {
					if (options.autoStartDaemon === true) {
						const startResult = startDaemonService();
						if (startResult.started) {
							prompt.writeLine(
								chalk.green(
									`✓ Background scheduler started (${startResult.mode === "systemd" ? "forge-taskd.service" : `PID ${startResult.pid}`})`,
								),
							);
						}
					} else if (options.autoStartDaemon !== false) {
						prompt.writeLine();
						prompt.writeLine(
							chalk.yellow("⚠️  Background scheduler daemon (forge-taskd) is not currently running."),
						);
						const startNow = await prompt.promptConfirm(
							"Would you like to start the background scheduler daemon now?",
							true,
						);
						if (startNow) {
							const startResult = startDaemonService();
							if (startResult.started) {
								prompt.writeLine(
									chalk.green(
										`✓ Background scheduler started (${startResult.mode === "systemd" ? "forge-taskd.service" : `PID ${startResult.pid}`})`,
									),
								);
							} else {
								prompt.writeLine(
									chalk.yellow(
										`Could not auto-start background service: ${startResult.error ?? "Unknown error"}`,
									),
								);
							}
						}
					}
				} else {
					prompt.writeLine(
						chalk.green(`  Scheduler daemon is active (${daemonStatus.details}). Task will run automatically.`),
					);
				}
			}

			prompt.writeLine(chalk.dim("  To view status: ") + chalk.bold(`forge task status ${created.name}`));
			prompt.writeLine(chalk.dim("  To run now:     ") + chalk.bold(`forge task run ${created.name}`));
			return taskInput;
		} finally {
			store.close();
		}
	} finally {
		prompt.close();
	}
}

// ============================================================
// Internal Helpers
// ============================================================

async function resolveModel(options: TaskArchitectOptions): Promise<{ modelRuntime: any; model: any }> {
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

		if (options.debug) {
			console.log(
				`[Debug] resolveModel success. provider: ${savedProvider}, model: ${savedModelId}, found: ${!!model}`,
			);
		}

		return { modelRuntime, model };
	} catch (err: unknown) {
		if (options.debug) {
			console.log(`[Debug] resolveModel failed: ${err instanceof Error ? err.message : String(err)}`);
		}
		return { modelRuntime: options.modelRuntime, model: options.model };
	}
}

async function callArchitectModel(
	modelRuntime: any,
	model: any,
	session: TaskDesignSession,
): Promise<ArchitectAction | null> {
	const userPrompt = formatSessionContext(session);

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

	if (response.stopReason === "error") {
		throw new Error(response.errorMessage ?? "LLM returned an error");
	}

	const text =
		response.content
			?.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("") ?? "";

	return parseArchitectJson(text);
}

export function parseArchitectJson(text: string): ArchitectAction | null {
	// Strip markdown code fences if present
	let cleanText = text.trim();
	const codeFenceMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
	if (codeFenceMatch) {
		cleanText = codeFenceMatch[1].trim();
	}

	// Try direct parse
	try {
		const obj = JSON.parse(cleanText);
		if (obj && typeof obj === "object" && typeof obj.type === "string") {
			return obj as ArchitectAction;
		}
	} catch {
		// Try finding first JSON object substring
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

async function promptUserQuestion(prompt: PromptEngine, q: AIQuestion): Promise<unknown> {
	if ((q.type === "single_select" || q.type === "multi_select") && q.options && q.options.length > 0) {
		const selectOpts: SelectOption<string>[] = q.options.map((opt) => ({
			label: opt.label,
			value: String(opt.value),
			description: opt.description,
		}));

		const defaultIdx = Math.max(
			0,
			selectOpts.findIndex((o) => o.value === String(q.defaultValue)),
		);

		return prompt.promptSelect(q.question, selectOpts, defaultIdx);
	}

	if (q.type === "confirmation" || q.type === "boolean") {
		return prompt.promptConfirm(q.question, Boolean(q.defaultValue ?? true));
	}

	if (q.type === "number") {
		const defaultNum = typeof q.defaultValue === "number" ? q.defaultValue : undefined;
		return prompt.promptNumber(q.question, { defaultVal: defaultNum });
	}

	const defaultStr = q.defaultValue !== undefined ? String(q.defaultValue) : undefined;
	return prompt.promptText(q.question, {
		defaultVal: defaultStr,
		required: q.required,
	});
}

function formatStrategy(strategy: string): string {
	switch (strategy) {
		case "deterministic":
			return chalk.cyan("Deterministic Script (Zero recurring AI token cost)");
		case "ai_agent":
			return chalk.magenta("Autonomous AI Agent (Adaptive reasoning & diagnosis)");
		case "hybrid":
			return chalk.green("Hybrid (Fast local probe + AI escalation on anomalies)");
		default:
			return strategy;
	}
}

function formatScheduler(scheduler: string): string {
	switch (scheduler) {
		case "forge_sqlite":
			return "Forge SQLite Scheduler (Stateful context & leases)";
		case "systemd_timer":
			return "systemd Timer (Native OS service lifecycle)";
		case "native_cron":
			return "Native Linux cron";
		case "manual":
			return "Manual (On-demand execution)";
		default:
			return scheduler;
	}
}

function formatSchedule(schedule?: {
	type: string;
	intervalSeconds?: number;
	intervalHuman?: string;
	cronExpression?: string;
	at?: string;
}): string {
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
