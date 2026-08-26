/**
 * Model Context Protocol (MCP) Client & Tool Adapter for Forge Linux Agent (§19, §20).
 *
 * Connects to MCP servers (stdio / JSON-RPC), discovers tools, and converts them
 * into Forge-compatible ToolDefinition objects. Allows seamless access to MCP
 * capabilities (browser, web search, Kubernetes, GitHub, databases) via the unified tool abstraction.
 */

import { spawn } from "node:child_process";

export interface McpServerConfig {
	name: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface McpToolSchema {
	name: string;
	description?: string;
	inputSchema?: {
		type: string;
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

export interface McpToolCallResult {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	isError?: boolean;
}

export class McpStdioClient {
	readonly serverConfig: McpServerConfig;
	private process: ReturnType<typeof spawn> | null = null;
	private requestId = 0;
	private readonly pendingRequests = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (err: Error) => void }
	>();
	private buffer = "";

	constructor(serverConfig: McpServerConfig) {
		this.serverConfig = serverConfig;
	}

	/**
	 * Start the MCP server process and establish JSON-RPC session.
	 */
	async connect(): Promise<void> {
		if (this.process) return;

		this.process = spawn(this.serverConfig.command, this.serverConfig.args || [], {
			env: { ...process.env, ...(this.serverConfig.env || {}) },
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process.stdout?.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString("utf-8");
			this.processIncomingMessages();
		});

		this.process.stderr?.on("data", () => {
			// Ignore or log stderr
		});

		this.process.on("exit", () => {
			for (const req of this.pendingRequests.values()) {
				req.reject(new Error(`MCP server "${this.serverConfig.name}" exited unexpectedly`));
			}
			this.pendingRequests.clear();
			this.process = null;
		});

		// Send initialize request per MCP protocol
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: { tools: {} },
			clientInfo: { name: "forge-linux-agent", version: "0.84.3" },
		});

		// Send initialized notification
		this.notify("notifications/initialized", {});
	}

	/**
	 * Discover tools provided by the MCP server.
	 */
	async listTools(): Promise<McpToolSchema[]> {
		const response = (await this.request("tools/list", {})) as { tools: McpToolSchema[] };
		return response.tools || [];
	}

	/**
	 * Call an MCP tool on the server.
	 */
	async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
		const response = (await this.request("tools/call", { name, arguments: args })) as McpToolCallResult;
		return response;
	}

	/**
	 * Disconnect and kill the MCP server process.
	 */
	close(): void {
		if (this.process) {
			this.process.kill("SIGTERM");
			this.process = null;
		}
	}

	private request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process || !this.process.stdin) {
				reject(new Error(`MCP client for "${this.serverConfig.name}" is not connected`));
				return;
			}

			const id = ++this.requestId;
			this.pendingRequests.set(id, { resolve, reject });

			const message = JSON.stringify({ jsonrpc: "2.0", id, method, params });
			this.process.stdin.write(`${message}\n`);
		});
	}

	private notify(method: string, params: unknown): void {
		if (this.process?.stdin) {
			const message = JSON.stringify({ jsonrpc: "2.0", method, params });
			this.process.stdin.write(`${message}\n`);
		}
	}

	private processIncomingMessages(): void {
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() || "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			try {
				const json = JSON.parse(trimmed);
				if (json.id !== undefined && this.pendingRequests.has(json.id)) {
					const { resolve, reject } = this.pendingRequests.get(json.id)!;
					this.pendingRequests.delete(json.id);

					if (json.error) {
						reject(new Error(`MCP error (${json.error.code}): ${json.error.message}`));
					} else {
						resolve(json.result);
					}
				}
			} catch {
				// Non-JSON or malformed line
			}
		}
	}
}
