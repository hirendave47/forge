import {
	computeNextRun,
	getDefaultTaskDbPath,
	instantiateTemplate,
	listTaskTemplates,
	type Task,
	type TaskRun,
	TaskRuntime,
	type TaskStepLog,
	TaskStore,
	type TaskTemplate,
} from "@earendil-works/forge-linux-agent";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getKeybindings,
	Input,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/forge-tui";
import { theme } from "../theme/theme.ts";
import { rawKeyHint } from "./keybinding-hints.ts";

export interface TaskSelectorOptions {
	dbPath?: string;
	onClose: () => void;
	onRequestRender: () => void;
	onLaunchWizard?: (initialGoal?: string) => Promise<void> | void;
}

type ViewMode = "tasks" | "templates" | "runs" | "logs" | "confirm_delete";

function formatSchedule(schedule: Task["schedule"]): string {
	if (!schedule) return "manual";
	if (schedule.type === "interval") {
		const s = schedule.seconds ?? 0;
		if (s < 60) return `every ${s}s`;
		if (s < 3600) return `every ${Math.floor(s / 60)}m`;
		if (s < 86400) return `every ${Math.floor(s / 3600)}h`;
		return `every ${Math.floor(s / 86400)}d`;
	}
	if (schedule.type === "cron") {
		return `cron: ${schedule.expression ?? ""}`;
	}
	if (schedule.type === "once") {
		return `once: ${schedule.at ?? ""}`;
	}
	return "manual";
}

function formatTimeAgo(isoString: string | null | undefined): string {
	if (!isoString) return "never";
	try {
		const date = new Date(isoString);
		const diffMs = Date.now() - date.getTime();
		if (diffMs < 0) return "in the future";
		const diffSec = Math.floor(diffMs / 1000);
		if (diffSec < 60) return `${diffSec}s ago`;
		const diffMin = Math.floor(diffSec / 60);
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDays = Math.floor(diffHr / 24);
		return `${diffDays}d ago`;
	} catch {
		return isoString;
	}
}

function formatDuration(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) return "-";
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export class TaskSelectorComponent extends Container implements Focusable {
	private readonly dbPath: string;
	private readonly onCloseCallback: () => void;
	private readonly onRequestRenderCallback: () => void;
	private readonly onLaunchWizardCallback?: (initialGoal?: string) => Promise<void> | void;

	private viewMode: ViewMode = "tasks";
	private tasks: Task[] = [];
	private filteredTasks: Task[] = [];
	private selectedIndex = 0;

	private templates: TaskTemplate[] = [];
	private filteredTemplates: TaskTemplate[] = [];
	private templateIndex = 0;

	private selectedTaskRuns: TaskRun[] = [];
	private selectedTaskLogs: TaskStepLog[] = [];

	private searchInput: Input;
	private isExecuting = false;
	private executingTaskId: string | null = null;
	private statusMessage: { type: "info" | "success" | "error" | "warn"; message: string } | null = null;
	private statusTimeout: ReturnType<typeof setTimeout> | null = null;

	private _focused = false;
	get focused(): boolean {
		return this._focused;
	}
	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(options: TaskSelectorOptions) {
		super();
		this.dbPath = options.dbPath ?? getDefaultTaskDbPath();
		this.onCloseCallback = options.onClose;
		this.onRequestRenderCallback = options.onRequestRender;
		this.onLaunchWizardCallback = options.onLaunchWizard;

		this.searchInput = new Input();
		this.templates = listTaskTemplates();
		this.filteredTemplates = [...this.templates];

		this.reloadTasks();
	}

	private setStatus(type: "info" | "success" | "error" | "warn", message: string, autoHideMs = 4000): void {
		if (this.statusTimeout) {
			clearTimeout(this.statusTimeout);
			this.statusTimeout = null;
		}
		this.statusMessage = { type, message };
		this.onRequestRenderCallback();
		if (autoHideMs > 0) {
			this.statusTimeout = setTimeout(() => {
				this.statusMessage = null;
				this.statusTimeout = null;
				this.onRequestRenderCallback();
			}, autoHideMs);
		}
	}

	public reloadTasks(): void {
		try {
			const store = new TaskStore(this.dbPath);
			this.tasks = store.listTasks();
			store.close();
		} catch (err: unknown) {
			this.tasks = [];
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus("error", `Failed to load tasks: ${msg}`);
		}
		this.filterTasks(this.searchInput.getValue());
		this.updateSelectedDetails();
	}

	private filterTasks(query: string): void {
		const q = query.trim();
		if (!q) {
			this.filteredTasks = [...this.tasks];
		} else {
			this.filteredTasks = fuzzyFilter(
				this.tasks,
				q,
				(task) => `${task.name} ${task.id} ${task.goal} ${task.profile ?? ""} ${formatSchedule(task.schedule)}`,
			);
		}
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, this.filteredTasks.length - 1));
	}

	private filterTemplates(query: string): void {
		const q = query.trim();
		if (!q) {
			this.filteredTemplates = [...this.templates];
		} else {
			this.filteredTemplates = fuzzyFilter(
				this.templates,
				q,
				(t) => `${t.id} ${t.title} ${t.category} ${t.description} ${t.goal}`,
			);
		}
		this.templateIndex = Math.max(0, Math.min(this.templateIndex, this.filteredTemplates.length - 1));
	}

	private updateSelectedDetails(): void {
		const selected = this.filteredTasks[this.selectedIndex];
		if (!selected) {
			this.selectedTaskRuns = [];
			this.selectedTaskLogs = [];
			return;
		}
		try {
			const store = new TaskStore(this.dbPath);
			this.selectedTaskRuns = store.listRuns(selected.id, 5);
			this.selectedTaskLogs = store.listTaskStepLogs(selected.id, 5);
			store.close();
		} catch {
			this.selectedTaskRuns = [];
			this.selectedTaskLogs = [];
		}
	}

	private async runSelectedTask(): Promise<void> {
		const selected = this.filteredTasks[this.selectedIndex];
		if (!selected) return;
		if (this.isExecuting) {
			this.setStatus("warn", "A task is already executing. Please wait.");
			return;
		}

		this.isExecuting = true;
		this.executingTaskId = selected.id;
		this.setStatus("info", `Executing task "${selected.name}"...`, 0);

		try {
			const runtime = new TaskRuntime({ dbPath: this.dbPath });
			const result = await runtime.executeTask(selected.id, { triggerType: "manual" });
			this.isExecuting = false;
			this.executingTaskId = null;
			this.reloadTasks();

			if (result.status === "SUCCEEDED") {
				this.setStatus("success", `✓ Task "${selected.name}" succeeded in ${formatDuration(result.durationMs)}`);
			} else {
				this.setStatus(
					"error",
					`✗ Task "${selected.name}" ${result.status.toLowerCase()}${result.error ? `: ${result.error}` : ""}`,
				);
			}
		} catch (err: unknown) {
			this.isExecuting = false;
			this.executingTaskId = null;
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus("error", `Execution failed: ${msg}`);
			this.reloadTasks();
		}
	}

	private togglePauseSelected(): void {
		const selected = this.filteredTasks[this.selectedIndex];
		if (!selected) return;
		try {
			const store = new TaskStore(this.dbPath);
			const newEnabled = !selected.enabled;
			store.updateTaskEnabled(selected.id, newEnabled);
			if (newEnabled && selected.schedule) {
				const next = computeNextRun(selected.schedule);
				store.updateTaskNextRun(selected.id, next ? next.toISOString() : null);
			} else if (!newEnabled) {
				store.updateTaskNextRun(selected.id, null);
			}
			store.close();
			this.reloadTasks();
			this.setStatus("success", newEnabled ? `✓ Task "${selected.name}" resumed` : `Task "${selected.name}" paused`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus("error", `Failed to toggle state: ${msg}`);
		}
	}

	private deleteSelectedTask(): void {
		const selected = this.filteredTasks[this.selectedIndex];
		if (!selected) return;
		try {
			const store = new TaskStore(this.dbPath);
			store.deleteTask(selected.id);
			store.close();
			this.viewMode = "tasks";
			this.setStatus("success", `✓ Task "${selected.name}" deleted`);
			this.reloadTasks();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus("error", `Failed to delete task: ${msg}`);
		}
	}

	private instantiateSelectedTemplate(): void {
		const template = this.filteredTemplates[this.templateIndex];
		if (!template) return;
		try {
			const input = instantiateTemplate(template.id);
			const store = new TaskStore(this.dbPath);
			const created = store.createTask(input);
			store.close();
			this.viewMode = "tasks";
			this.searchInput.setValue("");
			this.reloadTasks();
			const idx = this.filteredTasks.findIndex((t) => t.id === created.id);
			if (idx >= 0) this.selectedIndex = idx;
			this.updateSelectedDetails();
			this.setStatus("success", `✓ Created task "${created.name}" from template "${template.title}"`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			this.setStatus("error", `Failed to create task from template: ${msg}`);
		}
	}

	handleInput(data: string): void {
		const kb = getKeybindings();

		// Handle confirm delete mode
		if (this.viewMode === "confirm_delete") {
			if (kb.matches(data, "tui.select.confirm") || data === "d" || data === "y" || data === "Y") {
				this.deleteSelectedTask();
				return;
			}
			if (kb.matches(data, "tui.select.cancel") || data === "n" || data === "N" || matchesKey(data, Key.escape)) {
				this.viewMode = "tasks";
				this.statusMessage = null;
				this.onRequestRenderCallback();
				return;
			}
			return;
		}

		// Handle templates browser mode
		if (this.viewMode === "templates") {
			if (kb.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
				this.viewMode = "tasks";
				this.searchInput.setValue("");
				this.filterTasks("");
				this.onRequestRenderCallback();
				return;
			}
			if (kb.matches(data, "tui.select.up")) {
				this.templateIndex = Math.max(0, this.templateIndex - 1);
				this.onRequestRenderCallback();
				return;
			}
			if (kb.matches(data, "tui.select.down")) {
				this.templateIndex = Math.min(this.filteredTemplates.length - 1, this.templateIndex + 1);
				this.onRequestRenderCallback();
				return;
			}
			if (kb.matches(data, "tui.select.confirm")) {
				this.instantiateSelectedTemplate();
				return;
			}
			this.searchInput.handleInput(data);
			this.filterTemplates(this.searchInput.getValue());
			this.onRequestRenderCallback();
			return;
		}

		// Handle runs & logs subviews
		if (this.viewMode === "runs" || this.viewMode === "logs") {
			if (kb.matches(data, "tui.select.cancel") || data === "q" || matchesKey(data, Key.escape)) {
				this.viewMode = "tasks";
				this.onRequestRenderCallback();
				return;
			}
			if (this.viewMode === "runs" && (data === "r" || kb.matches(data, "tui.select.confirm"))) {
				void this.runSelectedTask();
				return;
			}
			return;
		}

		// Main "tasks" view mode
		if (kb.matches(data, "tui.select.cancel") || matchesKey(data, Key.escape)) {
			this.onCloseCallback();
			return;
		}

		// Navigation
		if (kb.matches(data, "tui.select.up")) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.updateSelectedDetails();
				this.onRequestRenderCallback();
			}
			return;
		}
		if (kb.matches(data, "tui.select.down")) {
			if (this.selectedIndex < this.filteredTasks.length - 1) {
				this.selectedIndex++;
				this.updateSelectedDetails();
				this.onRequestRenderCallback();
			}
			return;
		}

		// Actions: Run Now (Enter / 'r' when input is empty)
		if (kb.matches(data, "tui.select.confirm") || (data === "r" && this.searchInput.getValue() === "")) {
			if (this.filteredTasks.length > 0) {
				void this.runSelectedTask();
				return;
			}
		}

		// Actions: Pause / Resume ('p' or Space when search input is empty)
		if (
			(data === "p" && this.searchInput.getValue() === "") ||
			(data === " " && this.searchInput.getValue() === "")
		) {
			this.togglePauseSelected();
			return;
		}

		// Actions: Delete ('d' when search input is empty)
		if (data === "d" && this.searchInput.getValue() === "") {
			if (this.filteredTasks.length > 0) {
				this.viewMode = "confirm_delete";
				this.onRequestRenderCallback();
				return;
			}
		}

		// Actions: Templates browser ('t' when search input is empty)
		if (data === "t" && this.searchInput.getValue() === "") {
			this.viewMode = "templates";
			this.searchInput.setValue("");
			this.filterTemplates("");
			this.onRequestRenderCallback();
			return;
		}

		// Actions: Wizard ('w' or 'c' when search input is empty)
		if ((data === "w" || data === "c") && this.searchInput.getValue() === "") {
			if (this.onLaunchWizardCallback) {
				this.onCloseCallback();
				void this.onLaunchWizardCallback();
				return;
			}
			this.viewMode = "templates";
			this.searchInput.setValue("");
			this.filterTemplates("");
			this.onRequestRenderCallback();
			return;
		}

		// Actions: View Run History ('h' when search input is empty)
		if (data === "h" && this.searchInput.getValue() === "") {
			if (this.filteredTasks[this.selectedIndex]) {
				this.viewMode = "runs";
				this.updateSelectedDetails();
				this.onRequestRenderCallback();
				return;
			}
		}

		// Actions: View Step Logs ('l' when search input is empty)
		if (data === "l" && this.searchInput.getValue() === "") {
			if (this.filteredTasks[this.selectedIndex]) {
				this.viewMode = "logs";
				this.updateSelectedDetails();
				this.onRequestRenderCallback();
				return;
			}
		}

		// Forward typing to search input
		this.searchInput.handleInput(data);
		this.filterTasks(this.searchInput.getValue());
		this.updateSelectedDetails();
		this.onRequestRenderCallback();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const sep = theme.fg("dim", " · ");

		if (this.viewMode === "confirm_delete") {
			const selected = this.filteredTasks[this.selectedIndex];
			lines.push(theme.bold(theme.fg("error", "⚠ Delete Persistent Task")));
			lines.push("");
			lines.push(
				`Are you sure you want to permanently delete task "${selected?.name ?? ""}" (${selected?.id ?? ""})?`,
			);
			lines.push("");
			lines.push(
				theme.fg("dim", "All historical execution records, logs, and checkpoints for this task will be removed."),
			);
			lines.push("");
			lines.push(`${rawKeyHint("d / Enter", "Confirm Delete")}    ${rawKeyHint("Esc / n", "Cancel")}`);
			return lines;
		}

		if (this.viewMode === "templates") {
			lines.push(theme.bold(theme.fg("accent", "Curated Task Templates")));
			lines.push(theme.fg("dim", "Select a production template to create a new persistent task."));
			lines.push("");
			const searchPrompt = theme.fg("muted", "Search templates: ");
			const searchLines = this.searchInput.render(Math.max(10, width - visibleWidth(searchPrompt)));
			lines.push(searchPrompt + (searchLines[0] ?? ""));
			lines.push(theme.fg("dim", "─".repeat(Math.min(width, 78))));

			if (this.filteredTemplates.length === 0) {
				lines.push(theme.fg("dim", "  No templates matched your search."));
			} else {
				const maxVisible = 6;
				const startIdx = Math.max(0, Math.min(this.templateIndex - 2, this.filteredTemplates.length - maxVisible));
				const endIdx = Math.min(this.filteredTemplates.length, startIdx + maxVisible);

				for (let i = startIdx; i < endIdx; i++) {
					const t = this.filteredTemplates[i];
					const isSel = i === this.templateIndex;
					const cursor = isSel ? theme.fg("accent", "▶ ") : "  ";
					const cat = theme.fg("dim", `[${t.category}]`);
					const title = isSel ? theme.bold(theme.fg("accent", t.title)) : t.title;
					const sched = theme.fg("dim", `(${formatSchedule(t.schedule)})`);
					lines.push(truncateToWidth(`${cursor}${title} ${cat} ${sched}`, width, "…"));
					if (isSel) {
						lines.push(truncateToWidth(`    ${theme.fg("dim", t.description)}`, width, "…"));
					}
				}
			}
			lines.push("");
			lines.push(
				`${rawKeyHint("↑↓", "navigate")}  ${rawKeyHint("Enter", "Create from Template")}  ${rawKeyHint("Esc", "Back to Tasks")}`,
			);
			return lines;
		}

		if (this.viewMode === "runs") {
			const selected = this.filteredTasks[this.selectedIndex];
			lines.push(theme.bold(theme.fg("accent", `Execution History: ${selected?.name ?? ""}`)));
			lines.push(
				theme.fg("dim", `Task ID: ${selected?.id ?? ""} · Schedule: ${formatSchedule(selected?.schedule)}`),
			);
			lines.push(theme.fg("dim", "─".repeat(Math.min(width, 78))));

			if (this.selectedTaskRuns.length === 0) {
				lines.push(theme.fg("dim", "  No execution runs recorded for this task yet."));
			} else {
				for (const run of this.selectedTaskRuns) {
					const statusColor =
						run.status === "SUCCEEDED"
							? theme.fg("success", "[SUCCEEDED]")
							: run.status === "FAILED"
								? theme.fg("error", "[FAILED]")
								: run.status === "RUNNING"
									? theme.fg("accent", "[RUNNING]")
									: theme.fg("warning", `[${run.status}]`);
					const runId = theme.bold(run.id.slice(0, 8));
					const date = theme.fg("dim", formatTimeAgo(run.startedAt));
					const dur = theme.fg("dim", formatDuration(run.durationMs));
					const tokens = theme.fg("dim", `${run.inputTokens + run.outputTokens} tok`);
					const tools = theme.fg("dim", `${run.toolCalls} tools`);

					lines.push(`${statusColor} ${runId}  ${date}  ${dur}  ${tokens}  ${tools}`);
					if (run.resultSummary) {
						lines.push(`    ${theme.fg("dim", truncateToWidth(run.resultSummary, width - 6, "…"))}`);
					} else if (run.error) {
						lines.push(`    ${theme.fg("error", truncateToWidth(run.error, width - 6, "…"))}`);
					}
				}
			}
			lines.push("");
			lines.push(`${rawKeyHint("Esc / q", "Back to Tasks")}  ${rawKeyHint("r", "Run Task Now")}`);
			return lines;
		}

		if (this.viewMode === "logs") {
			const selected = this.filteredTasks[this.selectedIndex];
			lines.push(theme.bold(theme.fg("accent", `Tool Step Logs: ${selected?.name ?? ""}`)));
			lines.push(theme.fg("dim", `Showing recent tool executions and audit events`));
			lines.push(theme.fg("dim", "─".repeat(Math.min(width, 78))));

			if (this.selectedTaskLogs.length === 0) {
				lines.push(theme.fg("dim", "  No tool step logs recorded for this task yet."));
			} else {
				for (const log of this.selectedTaskLogs) {
					const isErr = log.isError;
					const icon = isErr ? theme.fg("error", "✗") : theme.fg("success", "✓");
					const toolName = theme.bold(log.toolName);
					const time = theme.fg("dim", formatTimeAgo(log.timestamp));
					const dur = theme.fg("dim", formatDuration(log.durationMs));
					lines.push(`${icon} #${log.stepIndex} ${toolName}  ${time}  ${dur}`);
					if (log.toolResult) {
						lines.push(
							`    ${theme.fg("dim", truncateToWidth(log.toolResult.replace(/\n/g, " "), width - 6, "…"))}`,
						);
					}
				}
			}
			lines.push("");
			lines.push(rawKeyHint("Esc / q", "Back to Tasks"));
			return lines;
		}

		// Header: Title & Counts
		const activeCount = this.tasks.filter((t) => t.enabled).length;
		const pausedCount = this.tasks.length - activeCount;
		const runningBadge = this.isExecuting
			? ` ${theme.fg("accent", `[RUNNING: ${this.executingTaskId?.slice(0, 8)}]`)}`
			: "";

		const titleLeft = theme.bold(theme.fg("accent", "Persistent Scheduled Tasks"));
		const countInfo = `${theme.fg("dim", `${this.tasks.length} tasks`)} (${theme.fg("success", `${activeCount} active`)}${sep}${theme.fg("warning", `${pausedCount} paused`)})${runningBadge}`;
		lines.push(truncateToWidth(`${titleLeft}  ${countInfo}`, width, ""));

		// Search Input Box
		const searchPrompt = theme.fg("muted", "Search: ");
		const searchLines = this.searchInput.render(Math.max(10, width - visibleWidth(searchPrompt)));
		lines.push(searchPrompt + (searchLines[0] ?? ""));
		lines.push(theme.fg("dim", "─".repeat(Math.min(width, 78))));

		// Task List
		if (this.filteredTasks.length === 0) {
			if (this.tasks.length === 0) {
				lines.push(theme.fg("dim", "  No persistent tasks configured yet."));
				lines.push(theme.fg("dim", "  Press 't' to browse curated templates or 'w' to launch wizard."));
			} else {
				lines.push(theme.fg("dim", "  No tasks match your search filter."));
			}
		} else {
			const maxVisible = 5;
			const startIdx = Math.max(0, Math.min(this.selectedIndex - 2, this.filteredTasks.length - maxVisible));
			const endIdx = Math.min(this.filteredTasks.length, startIdx + maxVisible);

			for (let i = startIdx; i < endIdx; i++) {
				const task = this.filteredTasks[i];
				const isSel = i === this.selectedIndex;
				const isRunning = this.isExecuting && this.executingTaskId === task.id;

				let statusBadge: string;
				if (isRunning) {
					statusBadge = theme.fg("accent", "[RUNNING]");
				} else if (task.enabled) {
					statusBadge = theme.fg("success", "[ACTIVE]");
				} else {
					statusBadge = theme.fg("warning", "[PAUSED]");
				}

				const cursor = isSel ? theme.fg("accent", "▶ ") : "  ";
				const nameStr = isSel ? theme.bold(theme.fg("accent", task.name)) : theme.bold(task.name);
				const scheduleStr = theme.fg("dim", formatSchedule(task.schedule));
				const lastRunStr = theme.fg("dim", `last: ${formatTimeAgo(task.lastRunAt)}`);

				lines.push(
					truncateToWidth(`${cursor}${statusBadge} ${nameStr}  ${scheduleStr}  ${lastRunStr}`, width, "…"),
				);
			}

			// Details Box for Selected Task
			const selected = this.filteredTasks[this.selectedIndex];
			if (selected) {
				lines.push("");
				const goalText = theme.fg("muted", "Goal: ") + selected.goal.split("\n")[0];
				lines.push(truncateToWidth(`  ${goalText}`, width, "…"));

				const schedDetail = `Schedule: ${formatSchedule(selected.schedule)} · Next: ${formatTimeAgo(selected.nextRunAt)}`;
				const confDetail = `Profile: ${selected.profile ?? "default"} · Tier: ${selected.modelTier ?? "auto"} · Timeout: ${selected.timeoutSeconds}s · Policy: ${selected.policyMode}`;
				lines.push(truncateToWidth(`  ${theme.fg("dim", schedDetail)}`, width, "…"));
				lines.push(truncateToWidth(`  ${theme.fg("dim", confDetail)}`, width, "…"));

				if (this.selectedTaskRuns.length > 0) {
					const lastRun = this.selectedTaskRuns[0];
					const lastStatus =
						lastRun.status === "SUCCEEDED"
							? theme.fg("success", "✓ SUCCEEDED")
							: theme.fg("error", `✗ ${lastRun.status}`);
					const lastInfo = `Last Run (${lastRun.id.slice(0, 8)}): ${lastStatus} (${formatDuration(lastRun.durationMs)}) ${formatTimeAgo(lastRun.startedAt)}`;
					lines.push(truncateToWidth(`  ${lastInfo}`, width, "…"));
				}
			}
		}

		// Status / Notification banner
		if (this.statusMessage) {
			lines.push("");
			const color =
				this.statusMessage.type === "success"
					? "success"
					: this.statusMessage.type === "error"
						? "error"
						: this.statusMessage.type === "warn"
							? "warning"
							: "accent";
			lines.push(truncateToWidth(theme.bold(theme.fg(color, `  ${this.statusMessage.message}`)), width, "…"));
		}

		// Footer Hints
		lines.push("");
		const hints = [
			rawKeyHint("↑↓", "navigate"),
			rawKeyHint("Enter/r", "Run Now"),
			rawKeyHint("Space/p", "Pause/Resume"),
			rawKeyHint("t", "Templates"),
			rawKeyHint("h", "Runs"),
			rawKeyHint("l", "Logs"),
			rawKeyHint("d", "Delete"),
			rawKeyHint("Esc", "Close"),
		].join("  ");
		lines.push(truncateToWidth(hints, width, "…"));

		return lines;
	}
}
