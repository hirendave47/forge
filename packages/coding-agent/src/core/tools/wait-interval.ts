import type { AgentTool } from "@earendil-works/forge-agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const waitIntervalSchema = Type.Object({
	seconds: Type.Number({ description: "Number of seconds to pause/wait before resuming execution (e.g. 5, 30, 60)" }),
	reason: Type.Optional(
		Type.String({
			description:
				"Reason for waiting (e.g. 'Waiting for new log entries to accumulate', 'Waiting for service to restart')",
		}),
	),
});

export type WaitIntervalToolInput = Static<typeof waitIntervalSchema>;

export function createWaitIntervalToolDefinition(): ToolDefinition<typeof waitIntervalSchema, undefined> {
	return {
		name: "wait_interval",
		label: "wait_interval",
		description:
			"Pause/sleep for a specified number of seconds before taking the next action. Essential for monitoring loops, polling service health, or waiting for logs to accumulate without busy-looping.",
		promptSnippet: "Pause execution for an interval in seconds before the next check",
		promptGuidelines: [
			"Use wait_interval whenever you are polling, monitoring log files, or waiting for services to change state instead of repeatedly calling bash commands in a busy-loop.",
		],
		parameters: waitIntervalSchema,
		async execute(_toolCallId, { seconds, reason }, signal) {
			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Wait interval aborted." }], isError: true, details: undefined };
			}
			const reasonStr = reason || "Waiting for next check cycle";
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				}, seconds * 1000);
				const onAbort = () => {
					clearTimeout(timeout);
					reject(new Error("Wait interval aborted"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });
			});
			return {
				content: [
					{
						type: "text",
						text: `Waited for ${seconds} seconds. Reason: ${reasonStr}. Ready for next action.`,
					},
				],
				details: undefined,
			};
		},
	};
}

export function createWaitIntervalTool(): AgentTool<typeof waitIntervalSchema> {
	return wrapToolDefinition(createWaitIntervalToolDefinition());
}
