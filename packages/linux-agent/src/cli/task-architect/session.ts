/**
 * Task Design Session state management.
 *
 * Tracks the stateful conversational lifecycle between the user, the AI Task Architect,
 * and progressive host discovery.
 */

import { randomUUID } from "node:crypto";
import type { HostInfo } from "../wizard/host-inspector.ts";
import type { DiscoveryResult, ExecutionStrategy, TaskPlan, TaskRecommendation } from "./schemas.ts";

export interface QuestionAnswer {
	questionId: string;
	questionText: string;
	answer: unknown;
	timestamp: string;
}

export type DesignSessionStatus =
	| "collecting"
	| "analyzing"
	| "planning"
	| "review"
	| "materializing"
	| "completed"
	| "cancelled";

export interface TaskDesignSession {
	sessionId: string;
	goal: string;
	hostContext: HostInfo;
	answers: QuestionAnswer[];
	discoveries: DiscoveryResult[];
	recommendations: TaskRecommendation[];
	executionStrategy?: ExecutionStrategy;
	taskPlan?: TaskPlan;
	confidence?: number;
	status: DesignSessionStatus;
	turns: number;
	createdAt: string;
	updatedAt: string;
}

export function createDesignSession(goal: string, hostContext: HostInfo): TaskDesignSession {
	const now = new Date().toISOString();
	return {
		sessionId: randomUUID(),
		goal,
		hostContext,
		answers: [],
		discoveries: [],
		recommendations: [],
		status: "collecting",
		turns: 0,
		createdAt: now,
		updatedAt: now,
	};
}

export function recordAnswer(
	session: TaskDesignSession,
	questionId: string,
	questionText: string,
	answer: unknown,
): void {
	session.answers.push({
		questionId,
		questionText,
		answer,
		timestamp: new Date().toISOString(),
	});
	session.updatedAt = new Date().toISOString();
}

export function recordDiscovery(session: TaskDesignSession, discovery: DiscoveryResult): void {
	session.discoveries.push(discovery);
	session.updatedAt = new Date().toISOString();
}

export function recordRecommendation(session: TaskDesignSession, recommendation: TaskRecommendation): void {
	session.recommendations.push(recommendation);
	session.executionStrategy = recommendation.executionStrategy;
	session.updatedAt = new Date().toISOString();
}

export function setTaskPlan(session: TaskDesignSession, plan: TaskPlan): void {
	session.taskPlan = plan;
	session.executionStrategy = plan.executionStrategy;
	session.status = "review";
	session.updatedAt = new Date().toISOString();
}

/**
 * Format the full conversational state into a concise context string for the AI.
 */
export function formatSessionContext(session: TaskDesignSession): string {
	const sections: string[] = [];

	sections.push(`Operational Goal: "${session.goal}"`);

	// Host Environment
	const host = session.hostContext;
	const hostLines: string[] = [`OS: ${host.osName} ${host.osVersion} (Kernel: ${host.kernel})`];
	if (host.activeServices.length > 0) {
		hostLines.push(`Active Services: ${host.activeServices.slice(0, 8).join(", ")}`);
	}
	if (host.highUsageDisks.length > 0) {
		const disks = host.highUsageDisks
			.map((d) => `${d.mountPoint} (${d.usePercentage}% used, ${d.available} free)`)
			.join(", ");
		hostLines.push(`Disks: ${disks}`);
	}
	if (host.discoveredLogFiles.length > 0) {
		hostLines.push(`Discovered Logs: ${host.discoveredLogFiles.slice(0, 6).join(", ")}`);
	}
	if (host.listeningPorts.length > 0) {
		hostLines.push(`Listening TCP Ports: ${host.listeningPorts.slice(0, 10).join(", ")}`);
	}
	sections.push(`Host Environment:\n${hostLines.map((l) => `  ${l}`).join("\n")}`);

	// Progressive Discoveries
	if (session.discoveries.length > 0) {
		const discoveryLines = session.discoveries.map(
			(d) => `  - [${d.check.checkType}:${d.check.target ?? "any"}] ${d.summary} (found: ${d.found})`,
		);
		sections.push(`Progressive Discoveries Executed:\n${discoveryLines.join("\n")}`);
	}

	// User Answers
	if (session.answers.length > 0) {
		const answerLines = session.answers.map((a) => {
			const displayVal = typeof a.answer === "object" ? JSON.stringify(a.answer) : String(a.answer);
			return `  - ${a.questionText}: ${displayVal} (id: ${a.questionId})`;
		});
		sections.push(`Collected User Decisions & Answers:\n${answerLines.join("\n")}`);
	}

	// Recommendations
	if (session.recommendations.length > 0) {
		const recLines = session.recommendations.map(
			(r) => `  - Strategy: ${r.executionStrategy}, Scheduler: ${r.scheduler} (Reason: ${r.reason})`,
		);
		sections.push(`Formulated Architecture Recommendations:\n${recLines.join("\n")}`);
	}

	return sections.join("\n\n");
}
