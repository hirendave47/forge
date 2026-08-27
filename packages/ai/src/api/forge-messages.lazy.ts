import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const forgeMessagesApi = (): ProviderStreams => lazyApi(() => import("./forge-messages.ts"));
