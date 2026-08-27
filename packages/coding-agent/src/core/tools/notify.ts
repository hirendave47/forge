import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/forge-agent-core";
import * as net from "net";
import { type Static, Type } from "typebox";
import { getAgentDir } from "../../config.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { NotificationSettings } from "../settings-manager.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

/** Load notification defaults from ~/.forge/agent/settings.json without importing SettingsManager. */
function loadNotificationDefaults(): NotificationSettings {
	try {
		const settingsPath = join(getAgentDir(), "settings.json");
		const raw = readFileSync(settingsPath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const n = parsed.notifications;
		if (n && typeof n === "object" && !Array.isArray(n)) {
			return n as NotificationSettings;
		}
	} catch {
		// File missing or unreadable — silently fall back to defaults
	}
	return {};
}

function isHtmlContent(content: string): boolean {
	const trimmed = content.trim();
	if (/^<!DOCTYPE/i.test(trimmed) || /^<html/i.test(trimmed)) {
		return true;
	}
	return /<(html|head|body|div|p|span|table|tr|td|th|h[1-6]|ul|ol|li|strong|em|pre|code|style|br\s*\/?)[\s>]/i.test(
		trimmed,
	);
}

const notifySchema = Type.Object({
	subject: Type.String({ description: "Notification subject line" }),
	body: Type.String({ description: "Message body or progress report (can be plain text or HTML)" }),
	severity: Type.Optional(
		Type.String({ description: "Severity: 'info', 'warning', 'critical', or 'summary'. Default: 'info'" }),
	),
	format: Type.Optional(
		Type.String({
			description: "Body format: 'html' or 'plain' (auto-detected if body contains HTML tags). Default: auto",
		}),
	),
	to: Type.Optional(Type.String({ description: "Recipient email override" })),
	from: Type.Optional(Type.String({ description: "Sender email override" })),
});

export type NotifyToolInput = Static<typeof notifySchema>;

function sendSmtpEmail(
	host: string,
	port: number,
	from: string,
	to: string,
	subject: string,
	body: string,
	severity = "info",
	format?: string,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const client = new net.Socket();
		let buffer = "";
		let step = 0;

		const timer = setTimeout(() => {
			client.destroy();
			reject(new Error(`SMTP connection timed out to ${host}:${port}`));
		}, 2000);

		client.connect(port, host, () => {});

		client.on("data", (data) => {
			buffer += data.toString();
			if (!buffer.endsWith("\n")) return;

			const lines = buffer.trim().split("\n");
			const lastLine = lines[lines.length - 1];
			buffer = "";

			try {
				if (step === 0) {
					if (!lastLine.startsWith("220")) {
						throw new Error(`SMTP greeting error: ${lastLine}`);
					}
					step = 1;
					client.write("EHLO localhost\r\n");
				} else if (step === 1) {
					if (!lastLine.startsWith("250")) {
						throw new Error(`SMTP EHLO rejected: ${lastLine}`);
					}
					step = 2;
					client.write(`MAIL FROM:<${from}>\r\n`);
				} else if (step === 2) {
					if (!lastLine.startsWith("250")) {
						throw new Error(`SMTP MAIL FROM rejected: ${lastLine}`);
					}
					step = 3;
					client.write(`RCPT TO:<${to}>\r\n`);
				} else if (step === 3) {
					if (!lastLine.startsWith("250")) {
						throw new Error(`SMTP RCPT TO rejected: ${lastLine}`);
					}
					step = 4;
					client.write("DATA\r\n");
				} else if (step === 4) {
					if (!lastLine.startsWith("354")) {
						throw new Error(`SMTP DATA rejected: ${lastLine}`);
					}
					step = 5;
					const now = new Date().toUTCString();
					const isHtml = format === "html" || (format !== "plain" && isHtmlContent(body));
					const contentType = isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8";

					// Ensure dot-stuffing for SMTP transparency (RFC 5321 §4.5.2)
					const safeBody = body.replace(/(^|\r?\n)\./g, "$1..");

					const message =
						`From: ${from}\r\n` +
						`To: ${to}\r\n` +
						`Date: ${now}\r\n` +
						`Subject: [${severity.toUpperCase()}] ${subject}\r\n` +
						`X-Severity: ${severity}\r\n` +
						`MIME-Version: 1.0\r\n` +
						`Content-Type: ${contentType}\r\n\r\n` +
						`${safeBody}\r\n.\r\n`;
					client.write(message);
				} else if (step === 5) {
					if (!lastLine.startsWith("250")) {
						throw new Error(`SMTP message submission error: ${lastLine}`);
					}
					step = 6;
					client.write("QUIT\r\n");
					clearTimeout(timer);
					client.end();
					resolve(`Notification email successfully dispatched to ${to}`);
				}
			} catch (err) {
				clearTimeout(timer);
				client.destroy();
				reject(err);
			}
		});

		client.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

export function createNotifyToolDefinition(): ToolDefinition<typeof notifySchema, undefined> {
	return {
		name: "send_notification",
		label: "send_notification",
		description: "Send progress reports, alerts, or task summaries to the user via email or webhook.",
		promptSnippet: "Send progress updates and summaries via email or webhook",
		promptGuidelines: [
			"If send_notification fails, report findings directly in your response and do not retry the notification.",
		],
		parameters: notifySchema,
		async execute(_toolCallId, { subject, body, severity = "info", format, to, from }, _signal) {
			const saved = loadNotificationDefaults();
			const smtpHost = process.env.FORGE_SMTP_HOST || saved.smtpHost || "localhost";
			const smtpPort = parseInt(process.env.FORGE_SMTP_PORT || String(saved.smtpPort ?? 25), 10);
			const fromAddr = from || process.env.FORGE_NOTIFICATION_FROM || saved.from || "noreply@example.com";
			const toAddr = to || process.env.FORGE_NOTIFICATION_TO || saved.to || "";
			const webhookUrl = process.env.FORGE_NOTIFICATION_WEBHOOK || saved.webhookUrl;

			const results: string[] = [];
			let anyFailure = false;

			// 1. Send via SMTP (Postfix) — skip if no recipient is configured
			if (!toAddr) {
				anyFailure = true;
				results.push(
					"SMTP delivery skipped: no recipient address configured. " +
						"Set a default in Settings → Notifications → To address, or specify one in your prompt.",
				);
			} else {
				try {
					const smtpResult = await sendSmtpEmail(
						smtpHost,
						smtpPort,
						fromAddr,
						toAddr,
						subject,
						body,
						severity,
						format,
					);
					results.push(smtpResult);
				} catch (err: unknown) {
					anyFailure = true;
					const message = err instanceof Error ? err.message : String(err);
					results.push(`SMTP delivery failed: ${message}`);
				}
			}

			// 2. Webhook if configured
			if (webhookUrl) {
				try {
					await fetch(webhookUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ subject, body, severity, timestamp: new Date().toISOString() }),
					});
					results.push("Webhook notification dispatched successfully");
					anyFailure = false; // webhook succeeded — overall not a failure
				} catch (err: unknown) {
					anyFailure = true;
					const message = err instanceof Error ? err.message : String(err);
					results.push(`Webhook delivery failed: ${message}`);
				}
			}

			return {
				content: [{ type: "text", text: results.join("\n") }],
				details: undefined,
				isError: anyFailure && !webhookUrl,
			};
		},
	};
}

export function createNotifyTool(): AgentTool<typeof notifySchema> {
	return wrapToolDefinition(createNotifyToolDefinition());
}
