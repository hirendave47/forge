declare module "@earendil-works/forge-linux-agent/cli" {
	export function handleRunCommand(args: string[]): Promise<void>;
	export function handleTaskCommand(args: string[]): Promise<void>;
	export function handleAuditCommand(args: string[]): Promise<void>;
	export function handleExplain(args: string[]): Promise<void>;
	export function handleTest(args: string[]): Promise<void>;
}

declare module "@earendil-works/forge-linux-agent" {
	export interface TaskSchedule {
		type: "interval" | "cron" | "once";
		seconds?: number;
		expression?: string;
		at?: string;
	}

	export type OverlapPolicy = "skip" | "queue" | "terminate_previous" | "allow";
	export type PolicyMode = "safe" | "autonomous" | "supervised" | "audit";
	export type ModelTier = "fast" | "standard" | "smart" | "pro";

	export interface RetryPolicy {
		maxRetries: number;
		delaySeconds: number;
		strategy: "fixed" | "exponential" | "backoff";
	}

	export interface Task {
		id: string;
		name: string;
		goal: string;
		profile?: string;
		schedule?: TaskSchedule;
		enabled: boolean;
		overlapPolicy: OverlapPolicy;
		timeoutSeconds: number;
		retryPolicy: RetryPolicy;
		policyMode: PolicyMode;
		toolsAllow?: string[];
		toolsDeny?: string[];
		skills?: string[];
		modelTier?: ModelTier;
		elevated?: boolean;
		notifications?: {
			email?: { to: string[] };
			webhook?: { url: string };
		};
		createdAt: string;
		updatedAt: string;
		nextRunAt?: string;
		lastRunAt?: string;
		lastSuccessAt?: string;
	}

	export interface TaskRun {
		id: string;
		taskId: string;
		sessionId?: string;
		triggerType?: string;
		hostUser?: string;
		hostName?: string;
		elevated: boolean;
		modelUsed?: string;
		transcriptPath?: string;
		startedAt: string;
		finishedAt?: string;
		status: string;
		exitReason?: string;
		error?: string;
		resultSummary?: string;
		inputTokens: number;
		outputTokens: number;
		toolCalls: number;
		durationMs?: number;
		cpuPercent?: number;
		memoryMb?: number;
	}

	export interface TaskStepLog {
		id?: number;
		taskId: string;
		runId: string;
		stepIndex: number;
		toolName: string;
		toolArgs?: unknown;
		toolResult?: string;
		isError: boolean;
		durationMs?: number;
		policyDecision?: unknown;
		timestamp: string;
	}

	export interface TaskEvent {
		id: string;
		taskId: string;
		runId?: string;
		eventType: string;
		timestamp: string;
		details?: unknown;
	}

	export interface CreateTaskInput {
		name?: string;
		goal: string;
		profile?: string;
		schedule?: TaskSchedule;
		enabled?: boolean;
		overlapPolicy?: OverlapPolicy;
		timeoutSeconds?: number;
		retryPolicy?: RetryPolicy;
		policyMode?: PolicyMode;
		toolsAllow?: string[];
		toolsDeny?: string[];
		skills?: string[];
		modelTier?: ModelTier;
		elevated?: boolean;
		notifications?: {
			email?: { to: string[] };
			webhook?: { url: string };
		};
	}

	export interface TaskTemplate {
		id: string;
		title: string;
		category: "sre" | "sysadmin" | "devops" | "security";
		description: string;
		goal: string;
		profile: string;
		schedule: TaskSchedule;
		policyMode: PolicyMode;
		timeoutSeconds: number;
		retryPolicy?: RetryPolicy;
		modelTier?: ModelTier;
		toolsAllow?: string[];
		toolsDeny?: string[];
	}

	export class TaskStore {
		constructor(dbPath: string);
		createTask(input: CreateTaskInput): Task;
		getTask(id: string): Task | undefined;
		getTaskByName(name: string): Task | undefined;
		resolveTask(ref: string): Task | undefined;
		listTasks(): Task[];
		updateTaskEnabled(id: string, enabled: boolean): void;
		updateTaskNextRun(id: string, nextRunAt: string | null): void;
		updateTaskLastRun(id: string, lastRunAt: string, succeeded: boolean): void;
		deleteTask(id: string): boolean;
		createRun(
			taskId: string,
			initialStatus?: string,
			options?: {
				triggerType?: string;
				hostUser?: string;
				hostName?: string;
				elevated?: boolean;
				modelUsed?: string;
				sessionId?: string;
			},
		): TaskRun;
		getRun(id: string): TaskRun | undefined;
		listRuns(taskId: string, limit?: number): TaskRun[];
		getActiveRun(taskId: string): TaskRun | undefined;
		listStepLogs(runId: string): TaskStepLog[];
		listTaskStepLogs(taskId: string, limit?: number): TaskStepLog[];
		listEvents(taskId: string, limit?: number): TaskEvent[];
		getLease(taskId: string): { owner_id: string; expires_at: string; run_id: string } | null;
		releaseLease(taskId: string): void;
		close(): void;
	}

	export function getDefaultTaskDbPath(): string;

	export interface ExecutionResult {
		runId: string;
		status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "TIMED_OUT" | "CANCELLED" | "POLICY_REJECTED";
		exitCode: number;
		durationMs: number;
		error?: string;
		resultSummary?: string;
	}

	export class TaskRuntime {
		constructor(options?: { dbPath?: string; agentSessionFactory?: any });
		executeTask(
			taskId: string,
			options?: { triggerType?: "schedule" | "manual" | "retry" | "test" | "oneshot" },
		): Promise<ExecutionResult>;
	}

	export function listTaskTemplates(): TaskTemplate[];
	export function getTaskTemplate(id: string): TaskTemplate | undefined;
	export function instantiateTemplate(templateId: string, overrides?: Partial<CreateTaskInput>): CreateTaskInput;
	export function computeNextRun(schedule: TaskSchedule, fromDate?: Date): Date | undefined;
	export function computeNextCronRun(expression: string, fromDate?: Date): Date;
	export function handleTaskCommand(args: string[]): Promise<void>;
}
