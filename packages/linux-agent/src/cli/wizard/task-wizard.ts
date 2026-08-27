/**
 * Interactive Task Creation Wizard for Forge Linux Agent.
 *
 * Guides user through goal formulation, host context discovery, dynamic follow-up
 * questions, persona selection, schedule configuration, live next-run calculations,
 * policy settings, and task persistence or YAML export.
 */

import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import chalk from "chalk";
import { stringify } from "yaml";
import {
	type CreateTaskInput,
	DEFAULT_OVERLAP_POLICY,
	DEFAULT_TIMEOUT_SECONDS,
	type ModelTier,
	type OverlapPolicy,
	type PolicyMode,
	parseIntervalString,
	type TaskSchedule,
} from "../../runtime/task-model.ts";
import { computeNextCronRun, computeNextRun } from "../../scheduler/cron.ts";
import { getDefaultTaskDbPath, TaskStore } from "../../store/task-store.ts";
import { buildEnrichedGoal, generateTaskQuestions, suggestProfileAndSchedule } from "./ai-questioner.ts";
import { type HostInfo, inspectHost } from "./host-inspector.ts";
import { PromptEngine, type PromptEngineOptions, type SelectOption } from "./prompt-engine.ts";

export interface TaskWizardOptions extends PromptEngineOptions {
	initialGoal?: string;
	dbPath?: string;
	smart?: boolean;
	inspectHostContext?: boolean;
	modelRuntime?: any;
}

export async function runTaskWizard(options: TaskWizardOptions = {}): Promise<CreateTaskInput | null> {
	const prompt = new PromptEngine({ input: options.input, output: options.output });
	const dbPath = options.dbPath ?? getDefaultTaskDbPath();
	const enableHostDiscovery = options.inspectHostContext ?? true;

	try {
		prompt.writeLine();
		prompt.writeLine(chalk.bold.cyan("┌────────────────────────────────────────────────────────┐"));
		prompt.writeLine(chalk.bold.cyan("│             FORGE TASK CREATION WIZARD                 │"));
		prompt.writeLine(chalk.bold.cyan("│       Configure autonomous Linux background tasks      │"));
		prompt.writeLine(chalk.bold.cyan("└────────────────────────────────────────────────────────┘"));
		prompt.writeLine();

		// 1. Goal Formulation
		let baseGoal = options.initialGoal;
		if (!baseGoal) {
			const entered = await prompt.promptText(
				"What is the operational goal for this task? (or type 'template' for presets)",
				{
					required: true,
				},
			);
			if (entered.toLowerCase() === "template" || entered.toLowerCase() === "templates") {
				const { listTaskTemplates, getTaskTemplate } = await import("../../templates/index.ts");
				const templates = listTaskTemplates();
				const templateOptions: SelectOption<string>[] = templates.map((t) => ({
					label: t.title,
					value: t.id,
					description: `${t.profile} | ${formatSchedule(t.schedule)}`,
				}));
				const selectedId = await prompt.promptSelect("Select a Curated Task Template:", templateOptions, 0);
				const selectedTemplate = getTaskTemplate(selectedId);
				baseGoal = selectedTemplate ? selectedTemplate.goal : entered;
			} else {
				baseGoal = entered;
			}
		} else {
			prompt.writeLine(`${chalk.bold.cyan("?")} ${chalk.bold("Task Goal")}: ${chalk.green(baseGoal)}`);
		}

		// 2. Host Environment Discovery & Smart Questioner
		let hostInfo: HostInfo | undefined;
		if (enableHostDiscovery) {
			hostInfo = inspectHost({ timeoutMs: 1200 });

			// Print compact host context badge
			const badges: string[] = [`OS: ${hostInfo.osName}`];
			if (hostInfo.activeServices.length > 0) {
				badges.push(`Services: ${hostInfo.activeServices.slice(0, 4).join(", ")}`);
			}
			if (hostInfo.highUsageDisks.length > 0) {
				badges.push(`Disk /: ${hostInfo.highUsageDisks[0].usePercentage}%`);
			}
			prompt.writeLine(chalk.dim(`  [Host Context] ${badges.join(" | ")}`));
		}

		// Recommendations from goal & host context
		const rec = suggestProfileAndSchedule(baseGoal);
		const dynamicQuestions = await generateTaskQuestions(baseGoal, hostInfo, {
			modelRuntime: options.modelRuntime,
		});

		let effectiveGoal = baseGoal;
		const answers: Record<string, string | boolean | number> = {};

		if (dynamicQuestions.length > 0) {
			const shouldRefine =
				options.smart !== undefined
					? options.smart
					: await prompt.promptConfirm("Refine task with smart operational follow-up questions?", true);

			if (shouldRefine) {
				prompt.writeLine();
				prompt.writeLine(chalk.bold("  Operational Clarifications:"));

				for (const q of dynamicQuestions) {
					if (q.type === "select" && q.options && q.options.length > 0) {
						const selectOpts: SelectOption<string>[] = q.options.map((opt) => ({
							label: opt.label,
							value: opt.value,
							description: opt.description,
						}));
						const defaultIdx = Math.max(
							0,
							selectOpts.findIndex((o) => o.value === q.defaultVal),
						);
						const selected = await prompt.promptSelect(q.question, selectOpts, defaultIdx);
						answers[q.id] = selected;
					} else if (q.type === "confirm") {
						const conf = await prompt.promptConfirm(q.question, Boolean(q.defaultVal ?? true));
						answers[q.id] = conf;
					} else if (q.type === "number") {
						const num = await prompt.promptNumber(q.question, {
							defaultVal: typeof q.defaultVal === "number" ? q.defaultVal : undefined,
						});
						answers[q.id] = num;
					} else {
						const text = await prompt.promptText(q.question, {
							defaultVal: typeof q.defaultVal === "string" ? q.defaultVal : undefined,
							required: false,
						});
						if (text) {
							answers[q.id] = text;
						}
					}
				}

				effectiveGoal = buildEnrichedGoal(baseGoal, answers, dynamicQuestions);
			}
		}

		// 3. Task Name (auto-slug with custom override)
		const suggestedName = generateSlug(baseGoal);
		const name = await prompt.promptText("Task Name (unique identifier)", {
			defaultVal: suggestedName,
			validate: (val) => {
				if (!/^[a-z0-9-_]+$/i.test(val)) {
					return "Task name must contain only letters, numbers, hyphens, and underscores.";
				}
				return true;
			},
		});

		// 4. Persona / Profile Selection (with recommendation highlight)
		const profileOptions: SelectOption<string>[] = [
			{
				label: "sysadmin",
				value: "sysadmin",
				description:
					rec.recommendedProfile === "sysadmin"
						? "Linux administration, service status (Recommended)"
						: "Linux administration, service status, syntax checks",
			},
			{
				label: "sre",
				value: "sre",
				description:
					rec.recommendedProfile === "sre"
						? "Observability, error deduplication (Recommended)"
						: "Observability, error deduplication, resource saturation",
			},
			{
				label: "devops",
				value: "devops",
				description:
					rec.recommendedProfile === "devops"
						? "Infrastructure automation, CI/CD (Recommended)"
						: "Infrastructure automation, containers, CI/CD",
			},
			{
				label: "security",
				value: "security",
				description:
					rec.recommendedProfile === "security"
						? "Security auditing, open ports (Recommended)"
						: "Security auditing, file permissions, open ports",
			},
			{
				label: "software-engineer",
				value: "software-engineer",
				description:
					rec.recommendedProfile === "software-engineer"
						? "Code fixes, unit tests (Recommended)"
						: "Code fixes, unit tests, regression detection",
			},
			{
				label: "default",
				value: "none",
				description: "General-purpose agent without specialized profile",
			},
		];

		const defaultProfileIndex = Math.max(
			0,
			profileOptions.findIndex((p) => p.value === rec.recommendedProfile),
		);
		const selectedProfile = await prompt.promptSelect(
			"Select an Agent Persona / Profile:",
			profileOptions,
			defaultProfileIndex,
		);
		const profile = selectedProfile === "none" ? undefined : selectedProfile;

		// 5. Schedule Selection (with recommendation highlight)
		const scheduleTypeOptions: SelectOption<"interval" | "cron" | "once" | "manual">[] = [
			{
				label: "Interval",
				value: "interval",
				description: "Repeat every N seconds, minutes, or hours (e.g. 30s, 5m, 1h)",
			},
			{
				label: "Cron Expression",
				value: "cron",
				description: "Standard 5-part UTC cron (e.g. */15 * * * *)",
			},
			{
				label: "One-Time (Once)",
				value: "once",
				description: "Run once at a scheduled ISO datetime",
			},
			{
				label: "Manual Only",
				value: "manual",
				description: "No automatic schedule, triggered on-demand via CLI",
			},
		];

		const defaultScheduleTypeIndex = Math.max(
			0,
			scheduleTypeOptions.findIndex((s) => s.value === rec.recommendedScheduleType),
		);
		const scheduleType = await prompt.promptSelect(
			"How should this task be scheduled?",
			scheduleTypeOptions,
			defaultScheduleTypeIndex,
		);

		let schedule: TaskSchedule | undefined;

		if (scheduleType === "interval") {
			const defaultInterval = rec.recommendedInterval ?? "5m";
			const intervalStr = await prompt.promptText("Repeat interval (e.g. 30s, 5m, 1h)", {
				defaultVal: defaultInterval,
				validate: (val) => {
					try {
						const sec = parseIntervalString(val);
						if (sec <= 0) return "Interval must be greater than 0.";
						return true;
					} catch (e: any) {
						return e.message;
					}
				},
			});
			const seconds = parseIntervalString(intervalStr);
			schedule = { type: "interval", seconds };

			const nextRun = computeNextRun(schedule);
			if (nextRun) {
				prompt.writeLine(chalk.dim(`  → Next execution in: ${intervalStr} (${nextRun.toLocaleTimeString()})`));
			}
		} else if (scheduleType === "cron") {
			const defaultCron = rec.recommendedCron ?? "0 * * * *";
			const cronExpr = await prompt.promptText("5-part UTC cron expression (minute hour day month dayOfWeek)", {
				defaultVal: defaultCron,
				validate: (val) => {
					try {
						computeNextCronRun(val);
						return true;
					} catch (e: any) {
						return e.message;
					}
				},
			});
			schedule = { type: "cron", expression: cronExpr };

			// Show preview of next 3 execution times
			prompt.writeLine(chalk.dim("  Upcoming scheduled triggers (local time):"));
			let cur = new Date();
			for (let i = 1; i <= 3; i++) {
				const next = computeNextCronRun(cronExpr, cur);
				prompt.writeLine(chalk.dim(`    ${i}. ${next.toLocaleString()}`));
				cur = next;
			}
		} else if (scheduleType === "once") {
			const defaultAt = `${new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 19)}Z`;
			const atStr = await prompt.promptText("Execution datetime (ISO 8601 UTC)", {
				defaultVal: defaultAt,
				validate: (val) => {
					const d = new Date(val);
					if (Number.isNaN(d.getTime())) return "Invalid ISO datetime.";
					if (d.getTime() <= Date.now()) return "Scheduled time must be in the future.";
					return true;
				},
			});
			schedule = { type: "once", at: new Date(atStr).toISOString() };
		}

		// 6. Safety Policy
		const policyOptions: SelectOption<PolicyMode>[] = [
			{
				label: "autonomous",
				value: "autonomous",
				description: "Execute all operations independently within safety guardrails",
			},
			{
				label: "supervised",
				value: "supervised",
				description: "Require human confirmation for state-changing commands",
			},
			{
				label: "safe",
				value: "safe",
				description: "Strictly read-only diagnostics (no filesystem/service modifications)",
			},
		];

		const policyMode = await prompt.promptSelect("Select safety policy mode:", policyOptions, 0);

		// 7. Advanced Settings
		const configureAdvanced = await prompt.promptConfirm(
			"Configure advanced options (retries, notifications, timeout)?",
			false,
		);

		let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
		let overlapPolicy: OverlapPolicy = DEFAULT_OVERLAP_POLICY;
		let retries = 0;
		let retryDelay = 30;
		let retryStrategy: "fixed" | "exponential" = "fixed";
		let modelTier: ModelTier | undefined;
		let toolsAllow: string[] | undefined;
		let notifyEmail: string[] | undefined;
		let notifyWebhook: string | undefined;

		if (configureAdvanced) {
			timeoutSeconds = await prompt.promptNumber("Execution timeout in seconds", {
				defaultVal: 120,
				min: 10,
				max: 86400,
			});

			const overlapOptions: SelectOption<OverlapPolicy>[] = [
				{ label: "skip", value: "skip", description: "Skip execution if previous run is still active" },
				{ label: "queue", value: "queue", description: "Queue execution until previous run finishes" },
			];
			overlapPolicy = await prompt.promptSelect("Overlap policy:", overlapOptions, 0);

			retries = await prompt.promptNumber("Max retry attempts on failure (0 for no retries)", {
				defaultVal: 0,
				min: 0,
				max: 10,
			});

			if (retries > 0) {
				retryDelay = await prompt.promptNumber("Delay between retries in seconds", {
					defaultVal: 30,
					min: 1,
				});

				const strategyOptions: SelectOption<"fixed" | "exponential">[] = [
					{ label: "fixed", value: "fixed", description: "Fixed delay between each attempt" },
					{
						label: "exponential",
						value: "exponential",
						description: "Exponential backoff (30s, 60s, 120s...)",
					},
				];
				retryStrategy = await prompt.promptSelect("Retry backoff strategy:", strategyOptions, 0);
			}

			const emailInput = await prompt.promptText("Notification email recipients (comma-separated, optional)", {
				required: false,
			});
			if (emailInput) {
				notifyEmail = emailInput
					.split(",")
					.map((s) => s.trim())
					.filter((s) => s.length > 0);
			}

			const webhookInput = await prompt.promptText("Notification webhook URL (optional)", {
				required: false,
			});
			if (webhookInput) {
				notifyWebhook = webhookInput;
			}
		}

		// Build Task Input
		const input: CreateTaskInput = {
			name,
			goal: effectiveGoal,
			profile,
			schedule,
			enabled: true,
			overlapPolicy,
			timeoutSeconds,
			retryPolicy:
				retries > 0
					? {
							maxRetries: retries,
							delaySeconds: retryDelay,
							strategy: retryStrategy,
						}
					: undefined,
			policyMode,
			modelTier,
			toolsAllow,
			notifications:
				notifyEmail || notifyWebhook
					? {
							email: notifyEmail ? { to: notifyEmail } : undefined,
							webhook: notifyWebhook ? { url: notifyWebhook } : undefined,
						}
					: undefined,
		};

		// 8. Preview Summary Card
		prompt.writeLine();
		prompt.writeLine(chalk.bold("───────────────── Task Configuration Preview ─────────────────"));
		prompt.writeLine(`  ${chalk.bold("Name:")}         ${chalk.green(input.name)}`);
		prompt.writeLine(`  ${chalk.bold("Goal:")}         ${baseGoal}`);
		if (Object.keys(answers).length > 0) {
			prompt.writeLine(
				`  ${chalk.bold("Refinements:")}  ${Object.keys(answers).length} operational specification(s)`,
			);
		}
		prompt.writeLine(`  ${chalk.bold("Profile:")}      ${input.profile ?? "default"}`);
		prompt.writeLine(`  ${chalk.bold("Schedule:")}     ${formatSchedule(input.schedule)}`);
		prompt.writeLine(`  ${chalk.bold("Policy:")}       ${input.policyMode}`);
		prompt.writeLine(`  ${chalk.bold("Timeout:")}      ${input.timeoutSeconds}s`);
		if (input.retryPolicy) {
			prompt.writeLine(
				`  ${chalk.bold("Retries:")}      max=${input.retryPolicy.maxRetries} delay=${input.retryPolicy.delaySeconds}s (${input.retryPolicy.strategy})`,
			);
		}
		if (input.notifications?.email) {
			prompt.writeLine(`  ${chalk.bold("Notify Email:")} ${input.notifications.email.to.join(", ")}`);
		}
		if (input.notifications?.webhook) {
			prompt.writeLine(`  ${chalk.bold("Notify Hook:")}  ${input.notifications.webhook.url}`);
		}
		prompt.writeLine(chalk.bold("─────────────────────────────────────────────────────────────"));
		prompt.writeLine();

		// 9. Action Selection
		const actionOptions: SelectOption<"save" | "yaml" | "cancel">[] = [
			{
				label: "Save & Enable in Forge Task Store",
				value: "save",
				description: "Store in SQLite and schedule with daemon",
			},
			{
				label: "Export to YAML Config File",
				value: "yaml",
				description: "Save declarative task file for version control",
			},
			{
				label: "Cancel",
				value: "cancel",
				description: "Discard and exit",
			},
		];

		const action = await prompt.promptSelect("What would you like to do?", actionOptions, 0);

		if (action === "save") {
			const store = new TaskStore(dbPath);
			try {
				const created = store.createTask(input);
				prompt.writeLine();
				prompt.writeLine(chalk.green(`✓ Task created successfully: ${created.id}`));
				prompt.writeLine(chalk.dim(`  Name: ${created.name}`));
				if (created.schedule) {
					prompt.writeLine(chalk.dim(`  Schedule: ${formatSchedule(created.schedule)}`));
				}
				prompt.writeLine(chalk.dim("  To view status: ") + chalk.bold(`forge task status ${created.name}`));
				prompt.writeLine(chalk.dim("  To run now:     ") + chalk.bold(`forge task run ${created.name}`));
				return input;
			} finally {
				store.close();
			}
		}

		if (action === "yaml") {
			const defaultYamlPath = `tasks/${input.name}.yaml`;
			const yamlPath = await prompt.promptText("Save YAML file to path", {
				defaultVal: defaultYamlPath,
			});

			const yamlObj = {
				name: input.name,
				goal: input.goal,
				profile: input.profile,
				enabled: true,
				schedule: input.schedule
					? input.schedule.type === "interval"
						? { type: "interval", seconds: input.schedule.seconds }
						: input.schedule.type === "cron"
							? { type: "cron", expression: input.schedule.expression }
							: { type: "once", at: input.schedule.at }
					: undefined,
				execution: {
					overlap: input.overlapPolicy,
					timeout: input.timeoutSeconds,
					retries: input.retryPolicy?.maxRetries,
					retry_delay_seconds: input.retryPolicy?.delaySeconds,
					retry_strategy: input.retryPolicy?.strategy,
				},
				policy: { mode: input.policyMode },
				notifications: input.notifications,
			};

			const yamlContent = stringify(yamlObj, { indent: 2 });
			try {
				const { mkdirSync } = await import("node:fs");
				mkdirSync(dirname(yamlPath), { recursive: true });
				writeFileSync(yamlPath, yamlContent, "utf-8");
				prompt.writeLine(chalk.green(`✓ Exported task config to ${yamlPath}`));
				prompt.writeLine(chalk.dim(`  To create later: forge task create --from ${yamlPath}`));
			} catch (err: any) {
				prompt.printError(`Failed to write file: ${err.message}`);
			}
			return input;
		}

		prompt.writeLine(chalk.yellow("Task creation cancelled."));
		return null;
	} finally {
		prompt.close();
	}
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

function formatSchedule(schedule?: TaskSchedule): string {
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
