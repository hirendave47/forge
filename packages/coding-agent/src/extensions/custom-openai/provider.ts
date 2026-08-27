import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	ApiKeyCredential,
	AuthResult,
	Model,
	Provider,
	ProviderStreamOptions,
	RefreshModelsContext,
} from "@earendil-works/forge-ai";
import { stream, streamSimple } from "@earendil-works/forge-ai/compat";
import { getModelsPath } from "../../config.ts";

export const CUSTOM_OPENAI_PROVIDER_ID = "custom-openai";
export const DEFAULT_CUSTOM_OPENAI_URL = "http://127.0.0.1:8000/v1";

export interface CustomOpenAIModelEntry {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface CustomOpenAIProviderEntry {
	name?: string;
	baseUrl: string;
	api: "openai-completions";
	apiKey?: string;
	models: CustomOpenAIModelEntry[];
}

export interface ModelsJsonStructure {
	providers?: Record<string, CustomOpenAIProviderEntry | Record<string, unknown>>;
	[key: string]: unknown;
}

export function normalizeEndpointUrl(url: string): string {
	let trimmed = url.trim();
	if (!trimmed) return DEFAULT_CUSTOM_OPENAI_URL;
	if (!/^https?:\/\//i.test(trimmed)) {
		trimmed = `http://${trimmed}`;
	}
	return trimmed.replace(/\/+$/, "");
}

export async function saveCustomOpenAIProviderToModelsJson(
	modelsPath: string,
	providerId: string,
	config: {
		name?: string;
		baseUrl: string;
		apiKey?: string;
		modelId: string;
		contextWindow?: number;
	},
): Promise<void> {
	let data: ModelsJsonStructure = {};
	try {
		const content = await readFile(modelsPath, "utf-8");
		data = JSON.parse(content) as ModelsJsonStructure;
	} catch {
		data = { providers: {} };
	}

	if (!data.providers || typeof data.providers !== "object") {
		data.providers = {};
	}

	const normalizedUrl = normalizeEndpointUrl(config.baseUrl);
	const existingProvider = data.providers[providerId] as CustomOpenAIProviderEntry | undefined;

	const contextWindow = config.contextWindow && config.contextWindow > 0 ? config.contextWindow : 128000;
	const newModel: CustomOpenAIModelEntry = {
		id: config.modelId,
		name: config.modelId,
		reasoning: false,
		input: ["text"],
		contextWindow,
		maxTokens: contextWindow,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	let models: CustomOpenAIModelEntry[] = [];
	if (existingProvider && Array.isArray(existingProvider.models)) {
		models = existingProvider.models as CustomOpenAIModelEntry[];
		const existingIndex = models.findIndex((m) => m.id === config.modelId);
		if (existingIndex >= 0) {
			models[existingIndex] = { ...models[existingIndex], ...newModel };
		} else {
			models.push(newModel);
		}
	} else {
		models = [newModel];
	}

	data.providers[providerId] = {
		name: config.name || existingProvider?.name || providerId,
		baseUrl: normalizedUrl,
		api: "openai-completions",
		apiKey: config.apiKey || (existingProvider?.apiKey as string | undefined) || "custom",
		models,
	};

	await mkdir(dirname(modelsPath), { recursive: true });
	await writeFile(modelsPath, JSON.stringify(data, null, 2), "utf-8");
}

function toPiModel(modelId: string, serverUrl: string, contextWindow = 128000): Model<"openai-completions"> {
	return {
		id: modelId,
		name: modelId,
		api: "openai-completions",
		provider: CUSTOM_OPENAI_PROVIDER_ID,
		baseUrl: normalizeEndpointUrl(serverUrl),
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: contextWindow,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			supportsStrictMode: false,
			maxTokensField: "max_tokens",
		},
	};
}

export interface CustomOpenAIProviderController {
	provider: Provider<"openai-completions">;
	setCatalog(models: readonly Model<"openai-completions">[]): void;
}

export function createCustomOpenAIProvider(): CustomOpenAIProviderController {
	let models: readonly Model<"openai-completions">[] = [];

	const setCatalog = (newModels: readonly Model<"openai-completions">[]): void => {
		models = newModels;
	};

	const provider: Provider<"openai-completions"> = {
		id: CUSTOM_OPENAI_PROVIDER_ID,
		name: "Custom (OpenAI-compatible)",
		baseUrl: DEFAULT_CUSTOM_OPENAI_URL,
		auth: {
			apiKey: {
				name: "Custom OpenAI-compatible server",
				login: async (interaction): Promise<ApiKeyCredential> => {
					const enteredUrl = await interaction.prompt({
						type: "text",
						message: "Endpoint URL (e.g. http://127.0.0.1:8000/v1)",
						placeholder: process.env.CUSTOM_OPENAI_BASE_URL ?? DEFAULT_CUSTOM_OPENAI_URL,
					});
					const baseUrl = normalizeEndpointUrl(
						enteredUrl.trim() || process.env.CUSTOM_OPENAI_BASE_URL || DEFAULT_CUSTOM_OPENAI_URL,
					);

					const enteredKey = await interaction.prompt({
						type: "secret",
						message: "API Token / Key (optional, press Enter if not required)",
						placeholder: "optional",
					});
					const apiKey = enteredKey.trim();

					const enteredModel = await interaction.prompt({
						type: "text",
						message: "Model Name / ID (e.g. gemini-3.7-flash, qwen3-coder-next)",
						placeholder: "default-model",
					});
					const modelId = enteredModel.trim() || "default-model";

					const enteredProvider = await interaction.prompt({
						type: "text",
						message: "Custom Provider ID (optional, e.g. forge-local, ollama, custom)",
						placeholder: "custom",
					});
					const rawProviderId = enteredProvider.trim().toLowerCase();
					const providerId = rawProviderId.replace(/[^a-z0-9_.-]/g, "-") || "custom";

					const enteredCtx = await interaction.prompt({
						type: "text",
						message: "Context Window Size (optional, default: 128000)",
						placeholder: "128000",
					});
					const parsedCtx = parseInt(enteredCtx.trim(), 10);
					const contextWindow = Number.isFinite(parsedCtx) && parsedCtx > 0 ? parsedCtx : 128000;

					const modelsPath = getModelsPath();
					await saveCustomOpenAIProviderToModelsJson(modelsPath, providerId, {
						name: providerId,
						baseUrl,
						apiKey: apiKey || undefined,
						modelId,
						contextWindow,
					});

					setCatalog([toPiModel(modelId, baseUrl, contextWindow)]);

					return {
						type: "api_key",
						key: apiKey || "custom",
						env: {
							CUSTOM_OPENAI_BASE_URL: baseUrl,
							CUSTOM_OPENAI_MODEL: modelId,
							CUSTOM_OPENAI_PROVIDER: providerId,
						},
					};
				},
				check: async ({ ctx, credential }) => {
					if (credential?.key || credential?.env?.CUSTOM_OPENAI_BASE_URL) {
						return { type: "api_key", source: "stored credential" };
					}
					const envUrl = (await ctx.env("CUSTOM_OPENAI_BASE_URL")) ?? (await ctx.env("OPENAI_BASE_URL"));
					return envUrl ? { type: "api_key", source: "environment" } : undefined;
				},
				resolve: async ({ ctx, credential }): Promise<AuthResult | undefined> => {
					const baseUrl =
						credential?.env?.CUSTOM_OPENAI_BASE_URL ??
						(await ctx.env("CUSTOM_OPENAI_BASE_URL")) ??
						(await ctx.env("OPENAI_BASE_URL"));
					if (!baseUrl && !credential?.key) return undefined;
					const resolvedUrl = normalizeEndpointUrl(baseUrl ?? DEFAULT_CUSTOM_OPENAI_URL);
					const apiKey =
						credential?.key ??
						(await ctx.env("CUSTOM_OPENAI_API_KEY")) ??
						(await ctx.env("OPENAI_API_KEY")) ??
						"custom";
					return {
						auth: { apiKey, baseUrl: resolvedUrl },
						env: { ...credential?.env, CUSTOM_OPENAI_BASE_URL: resolvedUrl },
						source: credential ? "stored credential" : "environment",
					};
				},
			},
		},
		getModels: () => models,
		refreshModels: async (context: RefreshModelsContext): Promise<void> => {
			if (context.stored) {
				const restored = context.stored.models.filter(
					(model): model is Model<"openai-completions"> =>
						model.provider === CUSTOM_OPENAI_PROVIDER_ID && model.api === "openai-completions",
				);
				if (
					!(await context.publish({
						update: () => {
							models = restored;
						},
					}))
				) {
					return;
				}
			}
		},
		stream: (model, context, options) => stream(model, context, options as ProviderStreamOptions | undefined),
		streamSimple: (model, context, options) => streamSimple(model, context, options),
	};

	return { provider, setCatalog };
}
