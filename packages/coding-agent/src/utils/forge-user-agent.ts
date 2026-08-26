export function getForgeUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `forge/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}

export const getPiUserAgent = getForgeUserAgent;
