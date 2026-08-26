import { afterEach, describe, expect, it } from "vitest";
import { areExperimentalFeaturesEnabled } from "../src/core/experimental.ts";

describe("areExperimentalFeaturesEnabled", () => {
	const originalPiExperimental = process.env.FORGE_EXPERIMENTAL;

	afterEach(() => {
		if (originalPiExperimental === undefined) {
			delete process.env.FORGE_EXPERIMENTAL;
		} else {
			process.env.FORGE_EXPERIMENTAL = originalPiExperimental;
		}
	});

	it("returns false when FORGE_EXPERIMENTAL is unset", () => {
		delete process.env.FORGE_EXPERIMENTAL;

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when FORGE_EXPERIMENTAL is empty", () => {
		process.env.FORGE_EXPERIMENTAL = "";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns true when FORGE_EXPERIMENTAL is set to 1", () => {
		process.env.FORGE_EXPERIMENTAL = "1";

		expect(areExperimentalFeaturesEnabled()).toBe(true);
	});

	it("returns false when FORGE_EXPERIMENTAL is set to 0", () => {
		process.env.FORGE_EXPERIMENTAL = "0";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});

	it("returns false when FORGE_EXPERIMENTAL is set to a non-1 value", () => {
		process.env.FORGE_EXPERIMENTAL = "true";

		expect(areExperimentalFeaturesEnabled()).toBe(false);
	});
});
