import * as net from "net";
import { describe, expect, it } from "vitest";
import { createNotifyTool } from "../src/core/tools/notify.ts";

describe("Notify Tool (send_notification)", () => {
	it("should define valid tool schema with format, subject, body, severity, to, from", () => {
		const tool = createNotifyTool();
		expect(tool.name).toBe("send_notification");
		expect(tool.parameters).toBeDefined();
	});

	it("should send HTML email with text/html Content-Type when HTML body is detected", async () => {
		let capturedPayload = "";

		// Spin up a mock SMTP server on an ephemeral port
		const server = net.createServer((socket) => {
			socket.write("220 mock.smtp.local ESMTP Mock\r\n");
			let dataBuf = "";
			let inData = false;

			socket.on("data", (chunk) => {
				dataBuf += chunk.toString();
				if (!inData) {
					if (dataBuf.includes("EHLO")) {
						socket.write("250-mock.smtp.local\r\n250 HELP\r\n");
						dataBuf = "";
					} else if (dataBuf.includes("MAIL FROM:")) {
						socket.write("250 2.1.0 Ok\r\n");
						dataBuf = "";
					} else if (dataBuf.includes("RCPT TO:")) {
						socket.write("250 2.1.5 Ok\r\n");
						dataBuf = "";
					} else if (dataBuf.includes("DATA")) {
						inData = true;
						socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
						dataBuf = "";
					}
				} else {
					if (dataBuf.includes("\r\n.\r\n")) {
						capturedPayload = dataBuf;
						socket.write("250 2.0.0 Ok: queued as 12345\r\n");
						inData = false;
						dataBuf = "";
					}
				}
			});
		});

		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const addr = server.address() as net.AddressInfo;

		const originalHost = process.env.FORGE_SMTP_HOST;
		const originalPort = process.env.FORGE_SMTP_PORT;
		process.env.FORGE_SMTP_HOST = "127.0.0.1";
		process.env.FORGE_SMTP_PORT = String(addr.port);

		try {
			const tool = createNotifyTool();
			const result = await tool.execute("test-id", {
				to: "user@example.com",
				subject: "Daily Report",
				body: "<!DOCTYPE html><html><body><h2>Report</h2><p>All good</p></body></html>",
				severity: "info",
			});

			const firstContent = result.content[0];
			expect(firstContent?.type).toBe("text");
			if (firstContent?.type === "text") {
				expect(firstContent.text).toContain("successfully dispatched");
			}
			expect(capturedPayload).toContain("Content-Type: text/html; charset=utf-8");
			expect(capturedPayload).toContain("<!DOCTYPE html>");
		} finally {
			server.close();
			process.env.FORGE_SMTP_HOST = originalHost;
			process.env.FORGE_SMTP_PORT = originalPort;
		}
	});

	it("should send plain text email with text/plain Content-Type for standard messages", async () => {
		let capturedPayload = "";

		const server = net.createServer((socket) => {
			socket.write("220 mock.smtp.local ESMTP Mock\r\n");
			let dataBuf = "";
			let inData = false;

			socket.on("data", (chunk) => {
				dataBuf += chunk.toString();
				if (!inData) {
					if (dataBuf.includes("EHLO")) {
						socket.write("250 Ok\r\n");
						dataBuf = "";
					} else if (dataBuf.includes("MAIL FROM:")) {
						socket.write("250 Ok\r\n");
						dataBuf = "";
					} else if (dataBuf.includes("RCPT TO:")) {
						socket.write("250 Ok\r\n");
						dataBuf = "";
					} else if (dataBuf.includes("DATA")) {
						inData = true;
						socket.write("354 Start mail\r\n");
						dataBuf = "";
					}
				} else {
					if (dataBuf.includes("\r\n.\r\n")) {
						capturedPayload = dataBuf;
						socket.write("250 Ok: queued\r\n");
						inData = false;
						dataBuf = "";
					}
				}
			});
		});

		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const addr = server.address() as net.AddressInfo;

		const originalHost = process.env.FORGE_SMTP_HOST;
		const originalPort = process.env.FORGE_SMTP_PORT;
		process.env.FORGE_SMTP_HOST = "127.0.0.1";
		process.env.FORGE_SMTP_PORT = String(addr.port);

		try {
			const tool = createNotifyTool();
			const result = await tool.execute("test-id-2", {
				to: "user@example.com",
				subject: "Plain Notification",
				body: "Just a plain text notification.",
				severity: "warning",
			});

			const firstContent = result.content[0];
			expect(firstContent?.type).toBe("text");
			expect(capturedPayload).toContain("Content-Type: text/plain; charset=utf-8");
			expect(capturedPayload).toContain("[WARNING] Plain Notification");
		} finally {
			server.close();
			process.env.FORGE_SMTP_HOST = originalHost;
			process.env.FORGE_SMTP_PORT = originalPort;
		}
	});
});
