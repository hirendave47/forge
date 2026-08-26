declare module "@earendil-works/forge-linux-agent/cli" {
	export function handleRunCommand(args: string[]): Promise<void>;
	export function handleTaskCommand(args: string[]): Promise<void>;
}
