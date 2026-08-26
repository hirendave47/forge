/**
 * Incremental Log Reader Processor (§11).
 *
 * Efficiently reads new log entries starting from the last saved checkpoint.
 * Detects log rotation (inode change or file truncation), limits ingestion chunks,
 * and produces transactional checkpoint updates.
 */

import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import type { Processor, ProcessorContext, ProcessorResult } from "./types.ts";

export interface LogReaderInput {
	filePath: string;
	maxBytes?: number;
	maxLines?: number;
}

export interface LogReaderOutput {
	filePath: string;
	lines: string[];
	bytesRead: number;
	byteOffset: number;
	lineOffset: number;
	rotated: boolean;
	device?: string;
	inode?: string;
	hash: string;
}

const DEFAULT_MAX_BYTES = 512 * 1024; // 512 KB per interval chunk
const DEFAULT_MAX_LINES = 2000;

export class LogReaderProcessor implements Processor<LogReaderInput, LogReaderOutput> {
	readonly name = "log-reader";
	readonly description = "Incrementally reads log files from saved checkpoints with rotation detection";

	process(input: LogReaderInput, context: ProcessorContext): ProcessorResult<LogReaderOutput> {
		const { filePath } = input;
		const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
		const maxLines = input.maxLines ?? DEFAULT_MAX_LINES;

		if (!existsSync(filePath)) {
			throw new Error(`Log file not found: ${filePath}`);
		}

		const stat = statSync(filePath);
		const currentInode = stat.ino.toString();
		const currentDevice = stat.dev.toString();
		const fileSize = stat.size;

		// 1. Retrieve prior checkpoint
		const priorCheckpoint = context.store.getCheckpoint(context.taskId, filePath);

		let startOffset = 0;
		let startLine = 0;
		let rotated = false;

		if (priorCheckpoint) {
			// Rotation check: inode changed OR file shrank below previous byte offset
			if (
				(priorCheckpoint.inode && priorCheckpoint.inode !== currentInode) ||
				fileSize < priorCheckpoint.byteOffset
			) {
				rotated = true;
				startOffset = 0;
				startLine = 0;
			} else {
				startOffset = priorCheckpoint.byteOffset;
				startLine = priorCheckpoint.lineOffset;
			}
		}

		// If no new data has been written
		if (startOffset >= fileSize) {
			return {
				data: {
					filePath,
					lines: [],
					bytesRead: 0,
					byteOffset: startOffset,
					lineOffset: startLine,
					rotated,
					device: currentDevice,
					inode: currentInode,
					hash: "",
				},
				metrics: {
					rawBytesRead: 0,
					rawLinesRead: 0,
					processingTimeMs: 0,
				},
			};
		}

		// 2. Read bounded chunk of new data
		const bytesToRead = Math.min(fileSize - startOffset, maxBytes);
		const buffer = Buffer.alloc(bytesToRead);

		const fd = openSync(filePath, "r");
		let actualBytesRead = 0;
		try {
			actualBytesRead = readSync(fd, buffer, 0, bytesToRead, startOffset);
		} finally {
			closeSync(fd);
		}

		const content = buffer.toString("utf-8", 0, actualBytesRead);
		const rawLines = content.split("\n");

		// Limit lines if exceeded
		const lines = rawLines.slice(0, maxLines);
		const newLinesCount = lines.length;

		// Compute hash of read content
		const hash = createHash("sha256").update(content).digest("hex");

		const newByteOffset = startOffset + actualBytesRead;
		const newLineOffset = startLine + newLinesCount;

		return {
			data: {
				filePath,
				lines,
				bytesRead: actualBytesRead,
				byteOffset: newByteOffset,
				lineOffset: newLineOffset,
				rotated,
				device: currentDevice,
				inode: currentInode,
				hash,
			},
			checkpoint: {
				key: filePath,
				device: currentDevice,
				inode: currentInode,
				byteOffset: newByteOffset,
				lineOffset: newLineOffset,
				lastHash: hash,
			},
			metrics: {
				rawBytesRead: actualBytesRead,
				rawLinesRead: newLinesCount,
			},
		};
	}
}
