/**
 * Interactive terminal prompt engine for Forge CLI.
 *
 * Provides typed, formatted prompts with default values, validation,
 * and option selectors over standard streams or mock test streams.
 */

import { createInterface, type Interface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import chalk from "chalk";

export interface PromptEngineOptions {
	input?: Readable;
	output?: Writable;
}

export interface SelectOption<T = string> {
	label: string;
	value: T;
	description?: string;
}

export class PromptEngine {
	private readonly rl: Interface;
	private readonly output: Writable;
	private isClosed = false;

	constructor(options: PromptEngineOptions = {}) {
		const input = options.input ?? process.stdin;
		this.output = options.output ?? process.stdout;
		this.rl = createInterface({
			input,
			output: this.output,
			terminal: Boolean((input as any).isTTY),
		});
		this.rl.on("close", () => {
			this.isClosed = true;
		});
	}

	/**
	 * Prompt for a text string with optional default value and validator.
	 */
	async promptText(
		question: string,
		options: {
			defaultVal?: string;
			validate?: (value: string) => string | true;
			required?: boolean;
		} = {},
	): Promise<string> {
		const { defaultVal, validate, required = true } = options;
		const defaultHint = defaultVal ? chalk.dim(` [${defaultVal}]`) : "";

		while (true) {
			const promptStr = `${chalk.bold.cyan("?")} ${chalk.bold(question)}${defaultHint}: `;
			const rawAnswer = await this.rl.question(promptStr);
			const answer = rawAnswer.trim() || (defaultVal ?? "");

			if (required && !answer) {
				if (this.isClosed) {
					return defaultVal ?? "";
				}
				this.printError("This field is required. Please provide a value.");
				continue;
			}

			if (validate) {
				const validationResult = validate(answer);
				if (validationResult !== true) {
					this.printError(typeof validationResult === "string" ? validationResult : "Invalid input.");
					continue;
				}
			}

			return answer;
		}
	}

	/**
	 * Prompt for selection from a list of options.
	 */
	async promptSelect<T extends string>(question: string, options: SelectOption<T>[], defaultIndex = 0): Promise<T> {
		this.writeLine(`\n${chalk.bold.cyan("?")} ${chalk.bold(question)}`);

		for (let i = 0; i < options.length; i++) {
			const opt = options[i];
			const num = chalk.cyan(`  ${i + 1})`);
			const isDefault = i === defaultIndex ? chalk.dim(" (default)") : "";
			const desc = opt.description ? chalk.dim(` — ${opt.description}`) : "";
			this.writeLine(`${num} ${chalk.bold(opt.label)}${isDefault}${desc}`);
		}

		while (true) {
			const promptStr = `  ${chalk.dim(`Select [1-${options.length}]`)}${chalk.dim(` [${defaultIndex + 1}]`)}: `;
			const rawAnswer = await this.rl.question(promptStr);
			const trimmed = rawAnswer.trim();

			if (!trimmed) {
				return options[defaultIndex].value;
			}

			const num = Number.parseInt(trimmed, 10);
			if (!Number.isNaN(num) && num >= 1 && num <= options.length) {
				return options[num - 1].value;
			}

			// Also allow matching by value directly (case-insensitive)
			const directMatch = options.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
			if (directMatch) {
				return directMatch.value;
			}

			this.printError(`Please enter a number between 1 and ${options.length}.`);
		}
	}

	/**
	 * Prompt for a yes/no confirmation.
	 */
	async promptConfirm(question: string, defaultVal = true): Promise<boolean> {
		const hint = defaultVal ? chalk.dim(" (Y/n)") : chalk.dim(" (y/N)");
		while (true) {
			const promptStr = `${chalk.bold.cyan("?")} ${chalk.bold(question)}${hint}: `;
			const rawAnswer = await this.rl.question(promptStr);
			const trimmed = rawAnswer.trim().toLowerCase();

			if (!trimmed) return defaultVal;
			if (trimmed === "y" || trimmed === "yes" || trimmed === "true") return true;
			if (trimmed === "n" || trimmed === "no" || trimmed === "false") return false;

			this.printError("Please enter 'y' for yes or 'n' for no.");
		}
	}

	/**
	 * Prompt for a number with optional range constraints.
	 */
	async promptNumber(
		question: string,
		options: {
			defaultVal?: number;
			min?: number;
			max?: number;
		} = {},
	): Promise<number> {
		const { defaultVal, min, max } = options;
		const defaultHint = defaultVal !== undefined ? chalk.dim(` [${defaultVal}]`) : "";

		while (true) {
			const promptStr = `${chalk.bold.cyan("?")} ${chalk.bold(question)}${defaultHint}: `;
			const rawAnswer = await this.rl.question(promptStr);
			const trimmed = rawAnswer.trim();

			if (!trimmed && defaultVal !== undefined) {
				return defaultVal;
			}

			const num = Number.parseInt(trimmed, 10);
			if (Number.isNaN(num)) {
				if (this.isClosed) {
					return defaultVal ?? 0;
				}
				this.printError("Please enter a valid integer.");
				continue;
			}

			if (min !== undefined && num < min) {
				this.printError(`Value must be at least ${min}.`);
				continue;
			}

			if (max !== undefined && num > max) {
				this.printError(`Value cannot exceed ${max}.`);
				continue;
			}

			return num;
		}
	}

	writeLine(text = ""): void {
		this.output.write(`${text}\n`);
	}

	printError(msg: string): void {
		this.writeLine(`  ${chalk.red(`✕ ${msg}`)}`);
	}

	close(): void {
		this.rl.close();
	}
}
