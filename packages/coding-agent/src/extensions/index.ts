import type { InlineExtension } from "../core/extensions/types.ts";
import customOpenAIExtension from "./custom-openai/index.ts";
import llamaExtension from "./llama/index.ts";

export const builtInExtensions: InlineExtension[] = [
	{ name: "custom-openai", factory: customOpenAIExtension, hidden: true },
	{ name: "llama.cpp", factory: llamaExtension, hidden: true },
];
