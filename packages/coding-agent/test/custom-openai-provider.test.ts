import { existsSync, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthPrompt } from "@earendil-works/forge-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import {
	CUSTOM_OPENAI_PROVIDER_ID,
	createCustomOpenAIProvider,
	normalizeEndpointUrl,
	saveCustomOpenAIProviderToModelsJson,
} from "../src/extensions/custom-openai/provider.ts";

describe("Custom OpenAI-Compatible Provider", () => {
	let tempDir: string;
	let modelsPath: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "forge-custom-openai-test-"));
		modelsPath = join(tempDir, "models.json");
	});

	afterEach(async () => {
		if (existsSync(tempDir)) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	describe("normalizeEndpointUrl", () => {
		it("normalizes URLs without protocol to http", () => {
			expect(normalizeEndpointUrl("127.0.0.1:8000/v1")).toBe("http://127.0.0.1:8000/v1");
			expect(normalizeEndpointUrl("localhost:8080")).toBe("http://localhost:8080");
		});

		it("preserves http and https protocols", () => {
			expect(normalizeEndpointUrl("http://127.0.0.1:8000/v1")).toBe("http://127.0.0.1:8000/v1");
			expect(normalizeEndpointUrl("https://api.openai.com/v1")).toBe("https://api.openai.com/v1");
		});

		it("removes trailing slashes", () => {
			expect(normalizeEndpointUrl("http://127.0.0.1:8000/v1/")).toBe("http://127.0.0.1:8000/v1");
			expect(normalizeEndpointUrl("http://localhost:8080///")).toBe("http://localhost:8080");
		});

		it("returns default URL when empty", () => {
			expect(normalizeEndpointUrl("")).toBe("http://127.0.0.1:8000/v1");
			expect(normalizeEndpointUrl("   ")).toBe("http://127.0.0.1:8000/v1");
		});
	});

	describe("saveCustomOpenAIProviderToModelsJson", () => {
		it("creates a new models.json file when none exists", async () => {
			await saveCustomOpenAIProviderToModelsJson(modelsPath, "forge-local", {
				baseUrl: "http://127.0.0.1:8082/v1",
				apiKey: "test-token-123",
				modelId: "qwen3-coder-next",
				contextWindow: 128000,
			});

			expect(existsSync(modelsPath)).toBe(true);
			const parsed = JSON.parse(await readFile(modelsPath, "utf-8"));
			expect(parsed.providers).toBeDefined();
			expect(parsed.providers["forge-local"]).toEqual({
				name: "forge-local",
				baseUrl: "http://127.0.0.1:8082/v1",
				api: "openai-completions",
				apiKey: "test-token-123",
				models: [
					{
						id: "qwen3-coder-next",
						name: "qwen3-coder-next",
						reasoning: false,
						input: ["text"],
						contextWindow: 128000,
						maxTokens: 128000,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					},
				],
			});
		});

		it("merges into existing models.json without deleting other providers or models", async () => {
			// First save ollama
			await saveCustomOpenAIProviderToModelsJson(modelsPath, "ollama", {
				baseUrl: "http://127.0.0.1:8000/v1",
				apiKey: "llama",
				modelId: "gemini-3.7-flash",
				contextWindow: 256000,
			});

			// Then save forge-local
			await saveCustomOpenAIProviderToModelsJson(modelsPath, "forge-local", {
				baseUrl: "http://127.0.0.1:8082/v1",
				apiKey: "test-token-456",
				modelId: "qwen3-coder-next",
				contextWindow: 128000,
			});

			// Then add a second model to ollama
			await saveCustomOpenAIProviderToModelsJson(modelsPath, "ollama", {
				baseUrl: "http://127.0.0.1:8000/v1",
				modelId: "llama3-70b",
				contextWindow: 64000,
			});

			const parsed = JSON.parse(await readFile(modelsPath, "utf-8"));
			expect(Object.keys(parsed.providers)).toEqual(["ollama", "forge-local"]);
			expect(parsed.providers.ollama.models).toHaveLength(2);
			expect(parsed.providers.ollama.models[0].id).toBe("gemini-3.7-flash");
			expect(parsed.providers.ollama.models[1].id).toBe("llama3-70b");
			expect(parsed.providers["forge-local"].models).toHaveLength(1);
			expect(parsed.providers["forge-local"].models[0].id).toBe("qwen3-coder-next");
		});
	});

	describe("createCustomOpenAIProvider", () => {
		it("creates a provider with correct ID and API type", () => {
			const { provider } = createCustomOpenAIProvider();
			expect(provider.id).toBe(CUSTOM_OPENAI_PROVIDER_ID);
			expect(provider.name).toBe("Custom (OpenAI-compatible)");
			expect(provider.auth.apiKey).toBeDefined();
		});

		it("handles interactive login prompts", async () => {
			const { provider } = createCustomOpenAIProvider();
			const prompts: Record<string, string> = {
				"Endpoint URL (e.g. http://127.0.0.1:8000/v1)": "http://127.0.0.1:8082/v1",
				"API Token / Key (optional, press Enter if not required)": "secret-token",
				"Model Name / ID (e.g. gemini-3.7-flash, qwen3-coder-next)": "qwen3-coder-next",
				"Custom Provider ID (optional, e.g. forge-local, ollama, custom)": "forge-local",
				"Context Window Size (optional, default: 128000)": "256000",
			};

			const mockInteraction = {
				signal: new AbortController().signal,
				prompt: vi.fn(async (p: AuthPrompt) => {
					return prompts[p.message] ?? "";
				}),
				notify: vi.fn(),
			};

			const credential = await provider.auth.apiKey!.login!(mockInteraction);
			expect(credential.type).toBe("api_key");
			expect(credential.key).toBe("secret-token");
			expect(credential.env?.CUSTOM_OPENAI_BASE_URL).toBe("http://127.0.0.1:8082/v1");
			expect(credential.env?.CUSTOM_OPENAI_MODEL).toBe("qwen3-coder-next");
			expect(credential.env?.CUSTOM_OPENAI_PROVIDER).toBe("forge-local");
		});
	});

	describe("ModelRuntime integration", () => {
		it("discovers custom models configured in models.json", async () => {
			await saveCustomOpenAIProviderToModelsJson(modelsPath, "forge-local", {
				baseUrl: "http://127.0.0.1:8082/v1",
				apiKey: "a313d06dbbe31d4c4dffa26f4f6097efe5f355a103e15c996f143c1da1fcf569",
				modelId: "qwen3-coder-next",
				contextWindow: 128000,
			});

			const runtime = await ModelRuntime.create({
				credentials: AuthStorage.inMemory(),
				modelsPath,
				refreshOnCreate: true,
			});

			const forgeLocalModel = runtime.getModel("forge-local", "qwen3-coder-next");
			expect(forgeLocalModel).toBeDefined();
			expect(forgeLocalModel?.id).toBe("qwen3-coder-next");
			expect(forgeLocalModel?.provider).toBe("forge-local");
			expect(forgeLocalModel?.baseUrl).toBe("http://127.0.0.1:8082/v1");
			expect(forgeLocalModel?.contextWindow).toBe(128000);

			const authStatus = runtime.getProviderAuthStatus("forge-local");
			expect(authStatus.configured).toBe(true);
		});
	});
});
