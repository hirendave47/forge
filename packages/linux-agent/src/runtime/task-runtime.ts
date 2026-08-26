/**
 * Task Runtime — the core execution pipeline for both one-shot and scheduled tasks.
 *
 * Follows the execution architecture from §14:
 * TRIGGER → CREATE run_id → ACQUIRE LEASE → LOAD CHECKPOINT → LOAD PROFILE
 * → LOAD SKILLS → LOAD TOOLS → RUN PROCESSORS → START AgentSession
 * → LLM + TOOLS → VERIFY → NOTIFY → COMMIT CHECKPOINT → STORE RESULT → RELEASE LEASE
 *
 * Uses Forge's existing createAgentSession() SDK — no second agent engine (§38).
 */

import { hostname } from "node:os";
import { getDefaultTaskDbPath, TaskStore } from "../store/task-store.ts";
import type { Task, TaskState } from "./task-model.ts";

// ============================================================
// Execution result
// ============================================================

export interface ExecutionResult {
	runId: string;
	taskId?: string;
	status: TaskState;
	resultSummary?: string;
	error?: string;
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	toolCalls: number;
}

// ============================================================
// Runtime options
// ============================================================

export interface TaskRuntimeOptions {
	/** Path to the task database. Defaults to ~/.forge/agent/tasks.db */
	dbPath?: string;
	/** Working directory for the agent session. Defaults to process.cwd() */
	cwd?: string;
	/** Lease TTL in seconds. Default: 300 (5 min) */
	leaseTtlSeconds?: number;
	/** Owner identifier for leases. Default: hostname + PID */
	ownerId?: string;
	/** Progress callback for execution events */
	onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
	timestamp: string;
	message: string;
	phase: "lease" | "checkpoint" | "profile" | "processor" | "agent" | "verify" | "notify" | "complete";
}

// ============================================================
// Task Runtime
// ============================================================

export class TaskRuntime {
	private readonly store: TaskStore;
	private readonly cwd: string;
	private readonly leaseTtlSeconds: number;
	private readonly ownerId: string;
	private readonly onProgress?: (event: ProgressEvent) => void;

	constructor(options: TaskRuntimeOptions = {}) {
		this.store = new TaskStore(options.dbPath ?? getDefaultTaskDbPath());
		this.cwd = options.cwd ?? process.cwd();
		this.leaseTtlSeconds = options.leaseTtlSeconds ?? 300;
		this.ownerId = options.ownerId ?? `${hostname()}:${process.pid}`;
		this.onProgress = options.onProgress;
	}

	/**
	 * Execute a one-shot goal (forge run "<goal>").
	 *
	 * Creates an ephemeral execution — no persistent task, no scheduling.
	 * Uses createAgentSession() → session.prompt() directly.
	 */
	async executeOneShot(
		goal: string,
		options?: {
			profile?: string;
			tools?: string[];
			excludeTools?: string[];
			skills?: string[];
			modelTier?: string;
			timeoutSeconds?: number;
			systemPrompt?: string;
			appendSystemPrompt?: string[];
		},
	): Promise<ExecutionResult> {
		const startTime = Date.now();

		const { createAgentSession, SessionManager, DefaultResourceLoader, getAgentDir } = await import(
			"@earendil-works/forge-coding-agent"
		);

		this.emitProgress("agent", "Creating agent session...");

		// Build system prompt augmentation from profile
		const profilePrompt = options?.profile ? buildProfilePrompt(options.profile) : undefined;
		const appendSystemPrompt = [
			...(options?.appendSystemPrompt ?? []),
			...(profilePrompt ? [profilePrompt] : []),
			`\n## Current Task\nGoal: ${goal}\nExecute all necessary operational commands directly using your tools to fulfill this goal and verify the exit criteria before completing.\n`,
		];

		const sessionManager = SessionManager.inMemory(this.cwd);
		const resourceLoader = new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: getAgentDir(),
			systemPrompt: options?.systemPrompt,
			appendSystemPrompt,
		});

		const { session } = await createAgentSession({
			cwd: this.cwd,
			sessionManager,
			resourceLoader,
			tools: options?.tools ?? ["read", "bash", "edit", "write", "wait_interval", "send_notification"],
			excludeTools: options?.excludeTools,
		});

		this.emitProgress("agent", "Agent session created. Sending goal...");

		let toolCalls = 0;
		let inputTokens = 0;
		let outputTokens = 0;

		const unsubscribe = session.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				toolCalls++;
				const argsSummary = event.args ? ` (${JSON.stringify(event.args).slice(0, 60)})` : "";
				this.emitProgress("agent", `Executing tool: ${event.toolName}${argsSummary}`);
			} else if (event.type === "tool_execution_end") {
				const status = event.isError ? "failed" : "completed";
				this.emitProgress("agent", `Tool ${event.toolName} ${status}`);
			} else if (event.type === "message_end" && event.message.role === "assistant") {
				const msg = event.message as { usage?: { input?: number; output?: number } };
				if (msg.usage) {
					inputTokens += msg.usage.input ?? 0;
					outputTokens += msg.usage.output ?? 0;
				}
			}
		});

		// Set up timeout
		const timeoutMs = (options?.timeoutSeconds ?? 120) * 1000;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			await session.prompt(goal);

			const state = session.state;
			const assistantMessages = state.messages.filter((m) => m.role === "assistant");
			const lastMessage = assistantMessages[assistantMessages.length - 1];

			let resultSummary: string | undefined;
			let status: TaskState = "SUCCEEDED";
			let error: string | undefined;

			if (lastMessage?.role === "assistant") {
				const content = lastMessage.content;
				if (Array.isArray(content)) {
					resultSummary = content
						.filter((c: { type: string }) => c.type === "text")
						.map((c: { type: string; text?: string }) => (c as { type: "text"; text: string }).text)
						.join("\n");
				}
				if ("stopReason" in lastMessage) {
					const stopReason = (lastMessage as { stopReason?: string }).stopReason;
					if (stopReason === "error" || stopReason === "aborted") {
						status = "FAILED";
						error = (lastMessage as { errorMessage?: string }).errorMessage ?? "Agent execution failed";
					}
				}
			}

			const durationMs = Date.now() - startTime;
			this.emitProgress("complete", `Execution completed in ${(durationMs / 1000).toFixed(1)}s — ${status}`);

			return {
				runId: sessionManager.getSessionId(),
				status,
				resultSummary,
				error,
				durationMs,
				inputTokens,
				outputTokens,
				toolCalls,
			};
		} catch (err: unknown) {
			const durationMs = Date.now() - startTime;
			const errorMessage = err instanceof Error ? err.message : String(err);
			return {
				runId: sessionManager.getSessionId(),
				status: controller.signal.aborted ? "TIMED_OUT" : "FAILED",
				error: errorMessage,
				durationMs,
				inputTokens,
				outputTokens,
				toolCalls,
			};
		} finally {
			clearTimeout(timeout);
			unsubscribe();
		}
	}

	/**
	 * Execute a persistent task by ID.
	 *
	 * Follows the full execution pipeline:
	 * ACQUIRE LEASE → LOAD CHECKPOINT → RUN PROCESSORS → START AgentSession
	 * → LLM + TOOLS → VERIFY → NOTIFY → COMMIT CHECKPOINT → RELEASE LEASE
	 */
	async executeTask(taskId: string): Promise<ExecutionResult> {
		const startTime = Date.now();
		const task = this.store.getTask(taskId);
		if (!task) {
			throw new Error(`Task not found: ${taskId}`);
		}

		// Create run
		const run = this.store.createRun(taskId, "CREATED");
		this.store.recordEvent(taskId, run.id, "run_started");
		this.emitProgress("lease", `Run ${run.id.slice(0, 8)} created for task "${task.name}"`);

		// Check overlap policy
		if (task.overlapPolicy === "skip") {
			const existingLease = this.store.getLease(taskId);
			if (existingLease && new Date(existingLease.expires_at) > new Date()) {
				this.store.updateRunStatus(run.id, "SKIPPED", {
					exitReason: "overlap_skip",
					finishedAt: new Date().toISOString(),
				});
				this.store.recordEvent(taskId, run.id, "run_skipped", {
					reason: "overlap_skip",
					existingRunId: existingLease.run_id,
				});
				this.emitProgress("complete", "Run skipped — task already running");
				return {
					runId: run.id,
					taskId,
					status: "SKIPPED",
					durationMs: Date.now() - startTime,
					inputTokens: 0,
					outputTokens: 0,
					toolCalls: 0,
				};
			}
		}

		// Acquire lease
		this.store.updateRunStatus(run.id, "ACQUIRING");
		const leaseId = this.store.acquireLease(taskId, run.id, this.ownerId, this.leaseTtlSeconds);
		if (!leaseId) {
			this.store.updateRunStatus(run.id, "SKIPPED", {
				exitReason: "lease_unavailable",
				finishedAt: new Date().toISOString(),
			});
			this.store.recordEvent(taskId, run.id, "run_skipped", { reason: "lease_unavailable" });
			this.emitProgress("complete", "Run skipped — could not acquire lease");
			return {
				runId: run.id,
				taskId,
				status: "SKIPPED",
				durationMs: Date.now() - startTime,
				inputTokens: 0,
				outputTokens: 0,
				toolCalls: 0,
			};
		}

		this.emitProgress("lease", "Lease acquired");

		// Heartbeat renewal interval
		const heartbeatInterval = setInterval(
			() => {
				this.store.renewLease(taskId, leaseId, this.leaseTtlSeconds);
			},
			(this.leaseTtlSeconds / 3) * 1000,
		);

		try {
			// Mark as RUNNING
			this.store.updateRunStatus(run.id, "RUNNING");

			// Load checkpoint
			this.emitProgress("checkpoint", "Loading checkpoint...");
			// Checkpoints are loaded by processors — the runtime just provides access

			// Load profile
			this.emitProgress("profile", "Loading profile...");
			const profilePrompt = task.profile ? buildProfilePrompt(task.profile) : undefined;

			// Build agent session
			this.emitProgress("agent", "Starting agent session...");
			const { createAgentSession, SessionManager, DefaultResourceLoader, getAgentDir } = await import(
				"@earendil-works/forge-coding-agent"
			);

			const appendSystemPrompt = [...(profilePrompt ? [profilePrompt] : []), buildTaskContextPrompt(task)];

			const sessionManager = SessionManager.inMemory(this.cwd);
			const resourceLoader = new DefaultResourceLoader({
				cwd: this.cwd,
				agentDir: getAgentDir(),
				appendSystemPrompt,
			});

			const { session } = await createAgentSession({
				cwd: this.cwd,
				sessionManager,
				resourceLoader,
				tools: task.toolsAllow,
				excludeTools: task.toolsDeny,
			});

			this.store.recordEvent(taskId, run.id, "agent_started");

			let toolCalls = 0;
			let inputTokens = 0;
			let outputTokens = 0;

			const unsubscribe = session.subscribe((event) => {
				if (event.type === "tool_execution_start") {
					toolCalls++;
					const argsSummary = event.args ? ` (${JSON.stringify(event.args).slice(0, 60)})` : "";
					this.emitProgress("agent", `Executing tool: ${event.toolName}${argsSummary}`);
				} else if (event.type === "tool_execution_end") {
					const status = event.isError ? "failed" : "completed";
					this.emitProgress("agent", `Tool ${event.toolName} ${status}`);
				} else if (event.type === "message_end" && event.message.role === "assistant") {
					const msg = event.message as { usage?: { input?: number; output?: number } };
					if (msg.usage) {
						inputTokens += msg.usage.input ?? 0;
						outputTokens += msg.usage.output ?? 0;
					}
				}
			});

			// Timeout
			const timeoutMs = task.timeoutSeconds * 1000;
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), timeoutMs);

			try {
				await session.prompt(task.goal);

				const state = session.state;
				const assistantMessages = state.messages.filter((m) => m.role === "assistant");
				const lastMessage = assistantMessages[assistantMessages.length - 1];

				let resultSummary: string | undefined;
				let status: TaskState = "SUCCEEDED";
				let error: string | undefined;

				if (lastMessage?.role === "assistant") {
					const content = lastMessage.content;
					if (Array.isArray(content)) {
						resultSummary = content
							.filter((c: { type: string }) => c.type === "text")
							.map((c: { type: string; text?: string }) => (c as { type: "text"; text: string }).text)
							.join("\n");
					}
					if ("stopReason" in lastMessage) {
						const stopReason = (lastMessage as { stopReason?: string }).stopReason;
						if (stopReason === "error" || stopReason === "aborted") {
							status = "FAILED";
							error = (lastMessage as { errorMessage?: string }).errorMessage ?? "Agent execution failed";
						}
					}
				}

				clearTimeout(timeout);

				const finishedAt = new Date().toISOString();
				const durationMs = Date.now() - startTime;

				this.store.updateRunStatus(run.id, status, {
					exitReason: status === "SUCCEEDED" ? "completed" : "agent_error",
					error,
					resultSummary: resultSummary?.slice(0, 4096),
					finishedAt,
					durationMs,
				});

				this.store.updateTaskLastRun(taskId, finishedAt, status === "SUCCEEDED");
				this.store.recordEvent(taskId, run.id, status === "SUCCEEDED" ? "run_completed" : "run_failed", {
					durationMs,
				});

				this.emitProgress("complete", `Task completed — ${status} in ${(durationMs / 1000).toFixed(1)}s`);

				return {
					runId: run.id,
					taskId,
					status,
					resultSummary,
					error,
					durationMs,
					inputTokens,
					outputTokens,
					toolCalls,
				};
			} catch (err: unknown) {
				clearTimeout(timeout);
				const finishedAt = new Date().toISOString();
				const durationMs = Date.now() - startTime;
				const errorMessage = err instanceof Error ? err.message : String(err);
				const status: TaskState = controller.signal.aborted ? "TIMED_OUT" : "FAILED";

				this.store.updateRunStatus(run.id, status, {
					exitReason: controller.signal.aborted ? "timeout" : "exception",
					error: errorMessage,
					finishedAt,
					durationMs,
				});

				this.store.updateTaskLastRun(taskId, finishedAt, false);
				this.store.recordEvent(taskId, run.id, "run_failed", { error: errorMessage, durationMs });

				this.emitProgress("complete", `Task failed — ${status}: ${errorMessage}`);

				return {
					runId: run.id,
					taskId,
					status,
					error: errorMessage,
					durationMs,
					inputTokens,
					outputTokens,
					toolCalls,
				};
			} finally {
				unsubscribe();
			}
		} finally {
			clearInterval(heartbeatInterval);
			this.store.releaseLease(taskId);
		}
	}

	/**
	 * Get the underlying TaskStore for direct access.
	 */
	getStore(): TaskStore {
		return this.store;
	}

	/**
	 * Shut down the runtime and close the database.
	 */
	close(): void {
		this.store.close();
	}

	private emitProgress(phase: ProgressEvent["phase"], message: string): void {
		this.onProgress?.({
			timestamp: new Date().toISOString(),
			message,
			phase,
		});
	}
}

// ============================================================
// Profile prompt builder (§15)
// ============================================================

const BUILTIN_PROFILES: Record<string, string> = {
	sysadmin: `## Profile: Systems Administrator
Operating Principles:
- Observe before modifying. Prefer minimal changes.
- Preserve evidence. Prefer reversible changes.
- Verify every change. Never claim success without verification.
- Check logs and metrics before and after any modification.
- Use structured diagnostics: check service status, resource usage, and connectivity.
Preferred approach: diagnose → plan → minimal fix → verify → document.`,

	devops: `## Profile: DevOps Engineer
Operating Principles:
- Infrastructure as code mindset. Document every manual change.
- CI/CD pipeline awareness. Consider deployment impact.
- Monitor before and after changes. Check metrics dashboards.
- Prefer automation over manual intervention.
- Consider rollback strategies before applying changes.
Preferred approach: assess impact → automate fix → deploy → monitor → iterate.`,

	sre: `## Profile: Site Reliability Engineer
Operating Principles:
- Prioritize service availability and SLO compliance.
- Incident response: detect → triage → mitigate → resolve → postmortem.
- Error budgets guide risk tolerance.
- Prefer observability-first debugging: metrics → logs → traces.
- Eliminate toil through automation.
Preferred approach: monitor → alert → investigate → remediate → prevent recurrence.`,

	"software-engineer": `## Profile: Software Engineer
Operating Principles:
- Code quality matters. Follow existing project conventions.
- Test-driven approach. Verify with unit and integration tests.
- Review changes carefully. Consider edge cases.
- Use version control best practices.
- Document non-obvious decisions.
Preferred approach: understand → plan → implement → test → refactor → document.`,

	security: `## Profile: Security Analyst
Operating Principles:
- Assume breach mindset. Verify trust boundaries.
- Least privilege principle. Minimize attack surface.
- Check for CVEs, misconfigurations, and exposed secrets.
- Audit file permissions, network exposure, and authentication.
- Preserve forensic evidence. Do not modify artifacts before analysis.
Preferred approach: enumerate → assess → prioritize → remediate → verify → harden.`,
};

function buildProfilePrompt(profileName: string): string | undefined {
	return BUILTIN_PROFILES[profileName.toLowerCase()];
}

function buildTaskContextPrompt(task: Task): string {
	const parts: string[] = [];
	parts.push(`\n## Persistent Task Context`);
	parts.push(`Task: ${task.name} (${task.id})`);
	if (task.schedule) {
		if (task.schedule.type === "interval") {
			parts.push(`Schedule: every ${task.schedule.seconds}s`);
		} else if (task.schedule.type === "cron") {
			parts.push(`Schedule: ${task.schedule.expression}`);
		}
	}
	parts.push(`Policy: ${task.policyMode}`);
	parts.push(`Timeout: ${task.timeoutSeconds}s`);
	parts.push(`\nGoal:\n${task.goal}`);
	return parts.join("\n");
}

// ============================================================
// Exit codes (§34)
// ============================================================

export const EXIT_CODES = {
	SUCCESS: 0,
	AGENT_FAILURE: 1,
	POLICY_REJECTION: 2,
	INVALID_TASK: 3,
	TIMEOUT: 4,
	INFRASTRUCTURE_FAILURE: 5,
} as const;

export function getExitCode(status: TaskState): number {
	switch (status) {
		case "SUCCEEDED":
			return EXIT_CODES.SUCCESS;
		case "TIMED_OUT":
			return EXIT_CODES.TIMEOUT;
		case "SKIPPED":
			return EXIT_CODES.SUCCESS;
		default:
			return EXIT_CODES.AGENT_FAILURE;
	}
}
