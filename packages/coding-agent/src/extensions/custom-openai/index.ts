import type { ExtensionAPI } from "../../core/extensions/types.ts";
import { createCustomOpenAIProvider } from "./provider.ts";

export default function customOpenAIExtension(pi: ExtensionAPI): void {
	const { provider } = createCustomOpenAIProvider();
	pi.registerProvider(provider);
}
