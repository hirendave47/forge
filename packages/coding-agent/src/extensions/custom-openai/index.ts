import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { createCustomOpenAIProvider } from "./provider.ts";

export default function customOpenAIExtension(forge: ExtensionAPI): void {
	const { provider } = createCustomOpenAIProvider();
	forge.registerProvider(provider);
}
