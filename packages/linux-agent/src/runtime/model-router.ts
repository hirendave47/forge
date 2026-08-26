/**
 * Model Router for Forge Linux Agent (§33).
 *
 * Resolves model tiers (fast, default, reasoning, coding) to configured provider models.
 * Allows lightweight models for rapid monitoring loops and reasoning models for complex root cause investigations.
 */

import type { ModelTier } from "./task-model.ts";

export interface ModelTierConfig {
	fast?: string;
	default?: string;
	reasoning?: string;
	coding?: string;
}

export const DEFAULT_MODEL_TIERS: Record<ModelTier, string[]> = {
	fast: [
		"google/gemini-2.5-flash",
		"google/gemini-1.5-flash",
		"anthropic/claude-3-5-haiku",
		"openai/gpt-4o-mini",
		"deepseek/deepseek-chat",
	],
	default: ["google/gemini-2.5-pro", "anthropic/claude-3-7-sonnet", "openai/gpt-4o", "deepseek/deepseek-chat"],
	reasoning: [
		"anthropic/claude-3-7-sonnet:high",
		"openai/o3-mini",
		"deepseek/deepseek-reasoner",
		"google/gemini-2.0-flash-thinking",
	],
	coding: ["anthropic/claude-3-7-sonnet", "deepseek/deepseek-coder", "openai/gpt-4o", "qwen/qwen-2.5-coder-32b"],
};

export class ModelRouter {
	private readonly customTiers: ModelTierConfig;

	constructor(customTiers: ModelTierConfig = {}) {
		this.customTiers = customTiers;
	}

	/**
	 * Suggest model pattern or ID for a given tier or task context.
	 */
	resolveModelPattern(tier?: ModelTier, profile?: string): string | undefined {
		const effectiveTier = tier || this.inferTierFromProfile(profile);
		if (!effectiveTier) return undefined;

		if (this.customTiers[effectiveTier]) {
			return this.customTiers[effectiveTier];
		}

		const defaults = DEFAULT_MODEL_TIERS[effectiveTier];
		return defaults ? defaults[0] : undefined;
	}

	private inferTierFromProfile(profile?: string): ModelTier {
		if (profile === "software-engineer") return "coding";
		if (profile === "sre" || profile === "security") return "reasoning";
		if (profile === "sysadmin" || profile === "devops") return "default";
		return "default";
	}
}
