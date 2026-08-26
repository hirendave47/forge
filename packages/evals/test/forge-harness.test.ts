import { describe, expect, it } from "vitest";
import { resolveModelSelection } from "../src/forge-harness.ts";

describe("resolveModelSelection", () => {
	it("prefers an explicit harness model over environment defaults", () => {
		expect(
			resolveModelSelection(
				{ provider: "anthropic", id: "claude-opus-4-6" },
				{ FORGE_PROVIDER: "openai-codex", FORGE_MODEL: "gpt-5.6-sol" },
			),
		).toEqual({ provider: "anthropic", id: "claude-opus-4-6" });
	});

	it("uses trimmed environment defaults when the harness has no explicit model", () => {
		expect(
			resolveModelSelection(undefined, { FORGE_PROVIDER: " openai-codex ", FORGE_MODEL: " gpt-5.6-sol " }),
		).toEqual({
			provider: "openai-codex",
			id: "gpt-5.6-sol",
		});
	});

	it.each([
		[undefined, {}],
		[undefined, { FORGE_PROVIDER: "openai-codex" }],
		[undefined, { FORGE_MODEL: "gpt-5.6-sol" }],
		[
			{ provider: "", id: "gpt-5.6-sol" },
			{ FORGE_PROVIDER: "openai-codex", FORGE_MODEL: "gpt-5.6-sol" },
		],
	] as const)("rejects an incomplete model selection", (explicitModel, environment) => {
		expect(() => resolveModelSelection(explicitModel, environment)).toThrow(
			"Select a harness model explicitly or set both FORGE_PROVIDER and FORGE_MODEL as defaults.",
		);
	});
});
