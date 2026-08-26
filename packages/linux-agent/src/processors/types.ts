/**
 * Deterministic Processor abstraction for Forge Linux Agent (§10).
 *
 * Processors perform predictable local computation BEFORE the LLM is invoked.
 * They filter, aggregate, deduplicate, parse, and checkpoint data so the LLM
 * only receives compact, relevant incidents.
 */

import type { TaskStore } from "../store/task-store.ts";

export interface ProcessorContext {
	taskId: string;
	runId?: string;
	store: TaskStore;
	signal?: AbortSignal;
}

export interface ProcessorResult<T = unknown> {
	/** Processed data output */
	data: T;
	/** Formatted markdown/text summary to inject into LLM prompt */
	promptContribution?: string;
	/** Checkpoint update to commit after successful execution */
	checkpoint?: {
		key: string;
		device?: string;
		inode?: string;
		byteOffset: number;
		lineOffset: number;
		lastHash?: string;
	};
	/** Metrics gathered by this processor */
	metrics?: {
		rawBytesRead?: number;
		rawLinesRead?: number;
		uniqueIncidents?: number;
		processingTimeMs?: number;
	};
}

export interface Processor<TInput = unknown, TOutput = unknown> {
	readonly name: string;
	readonly description: string;
	process(input: TInput, context: ProcessorContext): Promise<ProcessorResult<TOutput>> | ProcessorResult<TOutput>;
}
