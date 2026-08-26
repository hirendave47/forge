/**
 * MCP Server Loader & Config Manager for Forge Linux Agent (§19).
 *
 * Reads MCP server configurations from ~/.forge/agent/mcp.json, initializes
 * connections, and converts MCP tool schemas into Forge ToolDefinitions.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { type McpServerConfig, McpStdioClient } from "./mcp-client.ts";

export interface McpConfigFile {
	mcpServers: Record<
		string,
		{
			command: string;
			args?: string[];
			env?: Record<string, string>;
		}
	>;
}

export function getDefaultMcpConfigPath(): string {
	return join(homedir(), ".forge", "agent", "mcp.json");
}

export class McpLoader {
	private readonly configPath: string;
	private readonly activeClients = new Map<string, McpStdioClient>();

	constructor(configPath: string = getDefaultMcpConfigPath()) {
		this.configPath = configPath;
	}

	loadServerConfigs(): McpServerConfig[] {
		if (!existsSync(this.configPath)) {
			return [];
		}

		try {
			const content = readFileSync(this.configPath, "utf-8");
			const json = JSON.parse(content) as McpConfigFile;
			if (!json.mcpServers) return [];

			return Object.entries(json.mcpServers).map(([name, conf]) => ({
				name,
				command: conf.command,
				args: conf.args,
				env: conf.env,
			}));
		} catch {
			return [];
		}
	}

	async loadAllTools(): Promise<
		Array<{
			serverName: string;
			toolName: string;
			description: string;
			parameters: any;
			execute: (args: Record<string, unknown>) => Promise<any>;
		}>
	> {
		const configs = this.loadServerConfigs();
		const tools: Array<{
			serverName: string;
			toolName: string;
			description: string;
			parameters: any;
			execute: (args: Record<string, unknown>) => Promise<any>;
		}> = [];

		for (const config of configs) {
			try {
				const client = new McpStdioClient(config);
				await client.connect();
				this.activeClients.set(config.name, client);

				const mcpTools = await client.listTools();
				for (const t of mcpTools) {
					tools.push({
						serverName: config.name,
						toolName: `mcp_${config.name}_${t.name}`,
						description: t.description || `Tool ${t.name} from MCP server ${config.name}`,
						parameters: Type.Any(),
						execute: async (args) => {
							return client.callTool(t.name, args);
						},
					});
				}
			} catch {
				// Failed to connect to this server; skip
			}
		}

		return tools;
	}

	close(): void {
		for (const client of this.activeClients.values()) {
			client.close();
		}
		this.activeClients.clear();
	}
}
