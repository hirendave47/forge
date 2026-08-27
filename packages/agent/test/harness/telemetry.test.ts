import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTypedSpanStarter, NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@earendil-works/forge-telemetry";
import { describe, expect, expectTypeOf, it } from "vitest";
import { renderAgentTelemetrySchemaMarkdown } from "../../scripts/generate-telemetry-docs.ts";
import {
	AGENT_TELEMETRY_SCHEMAS,
	AI_TELEMETRY_SCHEMA,
	type AiSpanEndAttributes,
	type AiSpanStartAttributes,
	HARNESS_TELEMETRY_SCHEMA,
	type HarnessSpanEndAttributes,
	type HarnessSpanStartAttributes,
	startAiSpan,
	startHarnessSpan,
} from "../../src/harness/telemetry.ts";

describe("agent telemetry schemas", () => {
	it("serializes both schemas and generates the checked-in reference", () => {
		expect(() => JSON.stringify(AI_TELEMETRY_SCHEMA)).not.toThrow();
		expect(() => JSON.stringify(HARNESS_TELEMETRY_SCHEMA)).not.toThrow();
		expect(AGENT_TELEMETRY_SCHEMAS).toEqual([AI_TELEMETRY_SCHEMA, HARNESS_TELEMETRY_SCHEMA]);
		expect(Object.keys(HARNESS_TELEMETRY_SCHEMA.spans)).toEqual([
			"forge.harness.run",
			"forge.harness.compaction",
			"forge.harness.navigation",
			"forge.harness.checkpoint",
			"forge.harness.turn",
			"forge.harness.step",
			"forge.harness.tool",
			"forge.harness.hook",
			"forge.harness.sleep",
			"forge.harness.event_handler",
			"forge.session.write",
		]);
		const actual = readFileSync(resolve(import.meta.dirname, "../../docs/telemetry-schema.md"), "utf8");
		expect(actual).toBe(renderAgentTelemetrySchemaMarkdown());
	});

	it("starts AI-request and harness spans through one composed typed starter", async () => {
		const startSpan = createTypedSpanStarter(NOOP_TELEMETRY_CONTEXT, AGENT_TELEMETRY_SCHEMAS);
		await startSpan(
			"forge.harness.step",
			{
				"forge.lane.name": "main",
				"forge.operation.id": "operation",
				"forge.step.kind": "assistant",
				"forge.step.attempt": 1,
			},
			async (stepSpan, startChildSpan) => {
				stepSpan.setAttributes({ "forge.step.outcome": "succeeded" });
				await startChildSpan(
					"forge.ai.request",
					{
						"forge.ai.operation": "stream",
						"forge.ai.provider": "provider",
						"forge.ai.model": "model",
						"forge.ai.api": "api",
						"forge.ai.streaming": true,
					},
					(requestSpan) => {
						requestSpan.setAttributes({ "forge.ai.response.stop_reason": "stop" });
					},
				);
			},
		);
	});

	it("infers exact AI start and optional end attributes", async () => {
		type Start = AiSpanStartAttributes<"forge.ai.request">;
		type End = AiSpanEndAttributes<"forge.ai.request">;
		expectTypeOf<Start>().toMatchTypeOf<{
			"forge.ai.operation": "stream" | "fetch_deferred" | "cancel_deferred" | "generate_images";
			"forge.ai.provider": string;
			"forge.ai.model": string;
			"forge.ai.api": string;
			"forge.ai.streaming": boolean;
			"forge.ai.deferred"?: boolean;
		}>();
		expectTypeOf<End["forge.ai.response.stop_reason"]>().toEqualTypeOf<
			"stop" | "length" | "tool_use" | "error" | "aborted" | "deferred" | undefined
		>();

		const telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT;
		await startAiSpan(
			telemetryContext,
			"forge.ai.request",
			{
				"forge.ai.operation": "stream",
				"forge.ai.provider": "provider",
				"forge.ai.model": "model",
				"forge.ai.api": "api",
				"forge.ai.streaming": true,
			},
			(span) => {
				span.setAttributes({ "forge.ai.response.stop_reason": "tool_use" });
				// @ts-expect-error forge.ai.request declares no span events
				span.addEvent("chunk");
			},
		);

		const compileTimeFailures = () => {
			const extraAttributes = {
				"forge.ai.operation": "stream",
				"forge.ai.provider": "provider",
				"forge.ai.model": "model",
				"forge.ai.api": "api",
				"forge.ai.streaming": true,
				"forge.ai.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startAiSpan(telemetryContext, "forge.ai.request", extraAttributes, () => {});
			// @ts-expect-error missing required start attributes
			void startAiSpan(telemetryContext, "forge.ai.request", { "forge.ai.operation": "stream" }, () => {});
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});

	it("infers per-span harness literals and optional completion enrichment", async () => {
		type RunStart = HarnessSpanStartAttributes<"forge.harness.run">;
		type RunEnd = HarnessSpanEndAttributes<"forge.harness.run">;
		expectTypeOf<RunStart["forge.operation.kind"]>().toEqualTypeOf<"run">();
		expectTypeOf<RunEnd["forge.operation.outcome"]>().toEqualTypeOf<
			"completed" | "aborted" | "failed" | "suspended" | undefined
		>();

		const telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT;
		await startHarnessSpan(
			telemetryContext,
			"forge.harness.run",
			{
				"forge.session.id": "session",
				"forge.lane.name": "main",
				"forge.operation.id": "operation",
				"forge.operation.kind": "run",
				"forge.operation.recovery": false,
			},
			(span) => {
				span.setAttributes({ "forge.operation.outcome": "completed" });
				span.setAttributes({});
				// @ts-expect-error the harness schema declares no span events
				span.addEvent("result");
			},
		);

		const compileTimeFailures = () => {
			const extraRunAttributes = {
				"forge.session.id": "session",
				"forge.lane.name": "main",
				"forge.operation.id": "operation",
				"forge.operation.kind": "run",
				"forge.operation.recovery": false,
				"forge.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startHarnessSpan(telemetryContext, "forge.harness.run", extraRunAttributes, () => {});
			void startHarnessSpan(
				telemetryContext,
				"forge.harness.checkpoint",
				{
					"forge.lane.name": "main",
					"forge.operation.id": "operation",
					"forge.checkpoint.kind": "normal",
				},
				(span) => {
					// @ts-expect-error empty end schemas reject every attribute
					span.setAttributes({ "forge.unknown": true });
				},
			);
			void startHarnessSpan(
				telemetryContext,
				"forge.harness.run",
				{
					"forge.session.id": "session",
					"forge.lane.name": "main",
					"forge.operation.id": "operation",
					// @ts-expect-error run spans accept only the run operation kind
					"forge.operation.kind": "navigation",
					"forge.operation.recovery": false,
				},
				() => {},
			);
			// @ts-expect-error missing required run start attributes
			void startHarnessSpan(telemetryContext, "forge.harness.run", {}, () => {});
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});
});
