import type { AgentTool } from "@earendil-works/forge-agent-core";
import * as net from "net";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const notifySchema = Type.Object({
	subject: Type.String({ description: "Notification subject line" }),
	body: Type.String({ description: "Message body or progress report" }),
	severity: Type.Optional(
		Type.String({ description: "Severity: 'info', 'warning', 'critical', or 'summary'. Default: 'info'" }),
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
					const message =
						`From: ${from}\r\n` +
						`To: ${to}\r\n` +
						`Date: ${now}\r\n` +
						`Subject: [${severity.toUpperCase()}] ${subject}\r\n` +
						`X-Severity: ${severity}\r\n` +
						`MIME-Version: 1.0\r\n` +
						`Content-Type: text/plain; charset=utf-8\r\n\r\n` +
						`${body}\r\n.\r\n`;
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
		async execute(_toolCallId, { subject, body, severity = "info", to, from }, _signal) {
			const smtpHost = process.env.FORGE_SMTP_HOST || "localhost";
			const smtpPort = parseInt(process.env.FORGE_SMTP_PORT || "25", 10);
			const fromAddr = from || process.env.FORGE_NOTIFICATION_FROM || "noreply@qforge.dev.fyre.ibm.com";
			const toAddr = to || process.env.FORGE_NOTIFICATION_TO || "hiren.dave@ibm.com";
			const webhookUrl = process.env.FORGE_NOTIFICATION_WEBHOOK;

			const results: string[] = [];
			let anyFailure = false;

			// 1. Send via SMTP (Postfix)
			try {
				const smtpResult = await sendSmtpEmail(smtpHost, smtpPort, fromAddr, toAddr, subject, body, severity);
				results.push(smtpResult);
			} catch (err: any) {
				anyFailure = true;
				results.push(`SMTP delivery failed: ${err?.message || err}`);
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
				} catch (err: any) {
					anyFailure = anyFailure || true;
					results.push(`Webhook delivery failed: ${err?.message || err}`);
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
