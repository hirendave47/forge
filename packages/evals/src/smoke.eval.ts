import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createForgeCodingAgentHarness } from "./forge-harness.ts";

const forgeCodingAgentHarness = createForgeCodingAgentHarness({ noTools: "all" });

describeEval("Forge Coding Agent smoke", { harness: forgeCodingAgentHarness }, (it) => {
	it("runs a basic prompt end to end", async ({ run }) => {
		const result = await run("What's the capital of France? Respond with only the city name.");

		expect(result.output.trim()).toBe("Paris");
		expect(result.errors).toEqual([]);
		expect(result.usage.provider).toBe(process.env.FORGE_PROVIDER ?? process.env.PI_PROVIDER);
		expect(result.usage.model).toBe(process.env.FORGE_MODEL ?? process.env.PI_MODEL);
		expect(result.usage.totalTokens).toBeGreaterThan(0);
	});
});
