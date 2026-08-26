import { readFileSync } from "node:fs";
import { stripBom } from "../utils/text.ts";

export interface ForgeManifest {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	themes?: string[];
}

export type PiManifest = ForgeManifest;

const RESOURCE_FIELDS = ["extensions", "skills", "prompts", "themes"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readForgeManifest(packageJsonPath: string): ForgeManifest | null {
	try {
		const pkg: unknown = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8")));
		if (!isObject(pkg)) {
			return null;
		}

		const manifestData = isObject(pkg.forge) ? pkg.forge : isObject(pkg.pi) ? pkg.pi : null;
		if (!manifestData) {
			return null;
		}

		const manifest: ForgeManifest = {};
		for (const field of RESOURCE_FIELDS) {
			const entries = manifestData[field];
			if (Array.isArray(entries) && entries.every((entry) => typeof entry === "string")) {
				manifest[field] = entries;
			}
		}
		return manifest;
	} catch {
		return null;
	}
}

export const readPiManifest = readForgeManifest;
