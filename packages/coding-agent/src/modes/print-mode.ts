/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `forge -p "prompt"` - text output
 * - `forge --mode json "prompt"` - JSON event stream
 */

import type { AssistantMessage, ImageContent } from "@earendil-works/forge-ai";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { flushRawStdout, waitForRawStdoutBackpressure, writeRawStdout } from "../core/output-guard.ts";
import { formatTokenSummary, logDebug, logDebugPayload } from "../utils/debug-logger.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";
import { renderTerminalMarkdown } from "./interactive/theme/theme.ts";
import { toJsonEvent } from "./json-event.ts";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Array of additional prompts to send after initialMessage */
	messages?: string[];
	/** First message to send (may contain @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** Format text output with styled terminal markdown */
	pretty?: boolean;
	/** Output raw text without terminal formatting */
	plain?: boolean;
	/** Enable full debug tracing with token counts and timestamps */
	debug?: boolean;
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
	const { mode, messages = [], initialMessage, initialImages } = options;
	let exitCode = 0;
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;
	let disposed = false;
	const signalCleanupHandlers: Array<() => void> = [];

	const disposeRuntime = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void disposeRuntime().finally(() => {
					process.exit(signal === "SIGHUP" ? 129 : 143);
				});
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	registerSignalHandlers();

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		await session.bindExtensions({
			mode: mode === "json" ? "json" : "print",
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navigateOptions) => {
					const result = await session.navigateTree(targetId, {
						summarize: navigateOptions?.summarize,
						customInstructions: navigateOptions?.customInstructions,
						replaceInstructions: navigateOptions?.replaceInstructions,
						label: navigateOptions?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, switchOptions) => {
					return runtimeHost.switchSession(sessionPath, switchOptions);
				},
				reload: async () => {
					await session.reload();
				},
			},
			onError: (err) => {
				console.error(`Extension error (${err.extensionPath}): ${err.error}`);
			},
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		const toolStartTimes = new Map<string, number>();
		let cumInputTokens = 0;
		let cumOutputTokens = 0;
		let turnCount = 0;

		unsubscribe = session.subscribe((event) => {
			if (mode === "json") {
				writeRawStdout(`${JSON.stringify(toJsonEvent(event))}\n`);
			}

			if (options.debug) {
				if (event.type === "agent_start") {
					logDebug(
						"agent_start",
						`Session started with model '${session.state.model?.id ?? "default"}' (${session.state.model?.provider ?? "default"})`,
					);
				} else if (event.type === "turn_start") {
					turnCount++;
					logDebug("turn_start", `Turn ${turnCount} started`);
				} else if (event.type === "tool_execution_start") {
					toolStartTimes.set(event.toolCallId, Date.now());
					const argsStr = event.args ? JSON.stringify(event.args) : "{}";
					logDebug("tool_call", `Tool '${event.toolName}' (id: ${event.toolCallId}) args: ${argsStr}`);
				} else if (event.type === "tool_execution_end") {
					const toolStartTime = toolStartTimes.get(event.toolCallId) ?? Date.now();
					const toolDurationMs = Date.now() - toolStartTime;
					const status = event.isError ? "FAILED" : "SUCCESS";
					const resultLen = JSON.stringify(event.result ?? "").length;
					logDebug(
						"tool_result",
						`Tool '${event.toolName}' (id: ${event.toolCallId}) ${status} in ${toolDurationMs}ms (output size: ${resultLen} chars)`,
					);
				} else if (event.type === "message_end" && event.message.role === "assistant") {
					const msg = event.message as unknown as {
						model?: string;
						provider?: string;
						stopReason?: string;
						content?: Array<{ type: string; [key: string]: unknown }>;
						usage?: {
							input?: number;
							output?: number;
							cacheRead?: number;
							cacheWrite?: number;
							totalTokens?: number;
						};
					};
					if (msg.usage) {
						cumInputTokens += msg.usage.input ?? 0;
						cumOutputTokens += msg.usage.output ?? 0;
						const summary = formatTokenSummary(msg.usage);
						logDebug(
							"llm_tokens",
							`Model '${msg.model ?? "default"}' completion (${msg.stopReason ?? "done"}) — ${summary}`,
						);
					}

					// Dump actual input context (all messages before this assistant reply)
					const allMessages = session.messages as unknown as Array<{
						role: string;
						content?: unknown;
						[key: string]: unknown;
					}>;
					const assistantIdx = allMessages.lastIndexOf(event.message as never);
					const inputMessages = assistantIdx >= 0 ? allMessages.slice(0, assistantIdx) : allMessages.slice(0, -1);
					const systemPrompt = session.systemPrompt;
					const inputPayload: Array<{ role: string; content?: unknown; [key: string]: unknown }> = [];
					if (systemPrompt) {
						inputPayload.push({ role: "system", content: systemPrompt });
					}
					inputPayload.push(...inputMessages);
					logDebugPayload(
						"llm_input",
						`Input context (${inputPayload.length} messages sent to LLM)`,
						inputPayload,
					);

					// Dump actual output content received from LLM
					const outputPayload: Array<{ role: string; content?: unknown }> = [
						{ role: "assistant", content: msg.content ?? [] },
					];
					logDebugPayload("llm_output", "Output content received from LLM", outputPayload);
				} else if (event.type === "turn_end") {
					logDebug("turn_end", `Turn ${turnCount} completed`);
				} else if (event.type === "agent_end") {
					logDebug(
						"agent_end",
						`Run complete | Total Tokens: In=${cumInputTokens.toLocaleString()}, Out=${cumOutputTokens.toLocaleString()}, Total=${(cumInputTokens + cumOutputTokens).toLocaleString()}`,
					);
				}
			}
		});
		unsubscribeBackpressure =
			mode === "json"
				? session.agent.subscribe(async () => {
						await waitForRawStdoutBackpressure();
					})
				: undefined;
	};

	try {
		if (mode === "json") {
			const header = session.sessionManager.getHeader();
			if (header) {
				writeRawStdout(`${JSON.stringify(header)}\n`);
			}
		}

		await rebindSession();

		if (initialMessage) {
			await session.prompt(initialMessage, { images: initialImages });
		}

		for (const message of messages) {
			await session.prompt(message);
		}

		if (mode === "text") {
			const state = session.state;
			const lastMessage = state.messages[state.messages.length - 1];

			if (lastMessage?.role === "assistant") {
				const assistantMsg = lastMessage as AssistantMessage;
				if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
					console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
					exitCode = 1;
				} else {
					for (const content of assistantMsg.content) {
						if (content.type === "text") {
							const shouldPretty = options.pretty ?? (options.plain ? false : Boolean(process.stdout.isTTY));
							if (shouldPretty) {
								const rendered = renderTerminalMarkdown(content.text);
								writeRawStdout(`${rendered}\n`);
							} else {
								writeRawStdout(`${content.text}\n`);
							}
						}
					}
				}
			}
		}

		return exitCode;
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		await disposeRuntime();
		await flushRawStdout();
	}
}
