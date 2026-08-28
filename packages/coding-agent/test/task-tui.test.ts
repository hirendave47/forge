import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { TaskStore } from "@earendil-works/forge-linux-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { TaskSelectorComponent } from "../src/modes/interactive/components/task-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("TUI Task Management (/task)", () => {
	const TEST_DB = join(process.cwd(), ".test-tui-tasks.db");

	beforeEach(() => {
		initTheme("dark");
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
		const store = new TaskStore(TEST_DB);
		store.createTask({
			name: "mem-check",
			goal: "Check memory usage every 5 minutes",
			schedule: { type: "interval", seconds: 300 },
			enabled: true,
			profile: "sre",
		});
		store.createTask({
			name: "nginx-log-watch",
			goal: "Watch nginx error logs",
			schedule: { type: "interval", seconds: 60 },
			enabled: false,
			profile: "sysadmin",
		});
		store.close();
	});

	afterEach(() => {
		if (existsSync(TEST_DB)) rmSync(TEST_DB);
	});

	it("should have 'task' registered in BUILTIN_SLASH_COMMANDS", () => {
		const taskCmd = BUILTIN_SLASH_COMMANDS.find((cmd) => cmd.name === "task");
		expect(taskCmd).toBeDefined();
		expect(taskCmd?.description).toContain("persistent");
	});

	it("should render TaskSelectorComponent with task list and details", () => {
		const component = new TaskSelectorComponent({
			dbPath: TEST_DB,
			onClose: () => {},
			onRequestRender: () => {},
		});

		const lines = component.render(80);
		const joined = lines.join("\n");

		expect(joined).toContain("Persistent Scheduled Tasks");
		expect(joined).toContain("mem-check");
		expect(joined).toContain("nginx-log-watch");
		expect(joined).toContain("[ACTIVE]");
		expect(joined).toContain("[PAUSED]");
		expect(joined).toContain("Watch nginx error logs");
	});

	it("should filter tasks on search input in TaskSelectorComponent", () => {
		const component = new TaskSelectorComponent({
			dbPath: TEST_DB,
			onClose: () => {},
			onRequestRender: () => {},
		});

		component.handleInput("m");
		component.handleInput("e");
		component.handleInput("m");

		const lines = component.render(80);
		const joined = lines.join("\n");
		expect(joined).toContain("mem-check");
		expect(joined).toContain("Check memory usage");
	});

	it("should toggle pause/resume on Space key", () => {
		const component = new TaskSelectorComponent({
			dbPath: TEST_DB,
			onClose: () => {},
			onRequestRender: () => {},
		});

		// Selected item is nginx-log-watch (enabled: false)
		component.handleInput(" ");

		const store = new TaskStore(TEST_DB);
		const task = store.getTaskByName("nginx-log-watch");
		store.close();

		expect(task?.enabled).toBe(true);

		// Press Space again to pause
		component.handleInput(" ");

		const store2 = new TaskStore(TEST_DB);
		const task2 = store2.getTaskByName("nginx-log-watch");
		store2.close();

		expect(task2?.enabled).toBe(false);
	});

	it("should support template browser view and instant template instantiation", () => {
		const component = new TaskSelectorComponent({
			dbPath: TEST_DB,
			onClose: () => {},
			onRequestRender: () => {},
		});

		// Switch to template browser ('t')
		component.handleInput("t");
		const lines = component.render(80).join("\n");
		expect(lines).toContain("Curated Task Templates");
		expect(lines).toContain("Nginx Error Log Monitor");

		// Press Enter to instantiate template
		component.handleInput("\r");

		const store = new TaskStore(TEST_DB);
		const tasks = store.listTasks();
		store.close();

		expect(tasks.length).toBe(3);
		expect(tasks.some((t) => t.name === "nginx-error-monitor")).toBe(true);
	});
});
