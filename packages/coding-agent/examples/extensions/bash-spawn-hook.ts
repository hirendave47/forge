/**
 * Bash Spawn Hook Example
 *
 * Adjusts command, cwd, and env before execution.
 *
 * Usage:
 *   forge -e ./bash-spawn-hook.ts
 */

import type { ExtensionAPI } from "@earendil-works/forge-coding-agent";
import { createBashTool } from "@earendil-works/forge-coding-agent";

export default function (forge: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `source ~/.profile\n${command}`,
			cwd,
			env: { ...env, FORGE_SPAWN_HOOK: "1" },
		}),
	});

	forge.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
