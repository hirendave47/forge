import { type ClientCommandContext, clientCommand } from "./commands/client.ts";
import { type ForgeCommandContext, forgeCommand } from "./commands/forge.ts";
import { type ServerCommandContext, serverCommand } from "./commands/server.ts";

export type ExperimentalCliContext = ForgeCommandContext & ServerCommandContext & ClientCommandContext;

export const experimentalCli = forgeCommand.command(serverCommand).command(clientCommand);
