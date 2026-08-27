/**
 * Curated Production Task Templates for Forge Linux Agent.
 *
 * Provides battle-tested task definitions for SRE, Sysadmin, DevOps, and Security operations.
 */

import type { CreateTaskInput, ModelTier, PolicyMode, RetryPolicy, TaskSchedule } from "../runtime/task-model.ts";

export interface TaskTemplate {
	id: string;
	title: string;
	category: "sre" | "sysadmin" | "devops" | "security";
	description: string;
	goal: string;
	profile: string;
	schedule: TaskSchedule;
	policyMode: PolicyMode;
	timeoutSeconds: number;
	retryPolicy?: RetryPolicy;
	modelTier?: ModelTier;
	toolsAllow?: string[];
	toolsDeny?: string[];
}

export const TASK_TEMPLATES: TaskTemplate[] = [
	{
		id: "nginx-error-monitor",
		title: "Nginx Error Log Monitor",
		category: "sysadmin",
		description:
			"High-frequency bounded tailing of /var/log/nginx/error.log with error threshold alerting and context windowing.",
		goal: "Monitor /var/log/nginx/error.log for occurrences of ERROR, CRITICAL, or 500 status codes. If more than 5 errors occur within the sampling window, extract 5 context lines before and after each event and report a root cause summary.",
		profile: "sysadmin",
		schedule: { type: "interval", seconds: 30 },
		policyMode: "autonomous",
		timeoutSeconds: 60,
		toolsAllow: ["read", "grep", "send_notification", "wait_interval"],
	},
	{
		id: "disk-space-cleaner",
		title: "Disk Space Pressure Cleaner",
		category: "sre",
		description:
			"Monitors filesystem mount points and purges temporary files and rotated logs when capacity exceeds 85%.",
		goal: "Inspect all filesystem mount points using df. If any mount exceeds 85% capacity, identify large temporary files in /tmp, rotated archives in /var/log/*.gz, and stale package caches. Perform a safe dry-run inspection, then purge unneeded caches and report space freed.",
		profile: "sre",
		schedule: { type: "interval", seconds: 3600 },
		policyMode: "autonomous",
		timeoutSeconds: 180,
		retryPolicy: { maxRetries: 1, delaySeconds: 60, strategy: "fixed" },
	},
	{
		id: "systemd-service-watchdog",
		title: "Critical Service Watchdog",
		category: "sysadmin",
		description:
			"Supervises mission-critical systemd units, validates active state, and attempts automatic service restart on failure.",
		goal: "Check the operational state of critical services (nginx, redis, docker, postgresql). If any service is inactive, failed, or crash-looping, inspect journalctl for root cause and attempt systemctl restart. Send an alert if the service fails to recover.",
		profile: "sysadmin",
		schedule: { type: "interval", seconds: 60 },
		policyMode: "autonomous",
		timeoutSeconds: 90,
		retryPolicy: { maxRetries: 2, delaySeconds: 30, strategy: "fixed" },
	},
	{
		id: "memory-leak-detector",
		title: "Memory Saturation & Leak Detector",
		category: "sre",
		description: "Tracks resident set size (RSS) of top processes and alerts on memory exhaustion patterns.",
		goal: "Inspect system memory consumption and top 5 processes by resident memory. If system memory utilization exceeds 90% or a single process exhibits rapid RSS growth, record memory maps and dispatch an alert with top consumer breakdown.",
		profile: "sre",
		schedule: { type: "interval", seconds: 300 },
		policyMode: "autonomous",
		timeoutSeconds: 60,
	},
	{
		id: "postgres-nightly-backup",
		title: "PostgreSQL Automated Nightly Backup",
		category: "sre",
		description: "Nightly pg_dump with gzip compression, checksum verification, and 7-day retention rotation.",
		goal: "Execute pg_dump for all active databases, compress archives with gzip, generate SHA-256 checksums, save to /var/backups/postgres, and delete backup files older than 7 days. Verify archive integrity before completion.",
		profile: "sre",
		schedule: { type: "cron", expression: "0 2 * * *" },
		policyMode: "autonomous",
		timeoutSeconds: 600,
		retryPolicy: { maxRetries: 2, delaySeconds: 60, strategy: "exponential" },
	},
	{
		id: "ssl-cert-expiry-check",
		title: "TLS/SSL Certificate Expiration Auditor",
		category: "security",
		description:
			"Daily audit of TLS certificates in /etc/letsencrypt and web server configs; alerts if expiration is within 14 days.",
		goal: "Audit all TLS/SSL certificate files in /etc/letsencrypt/live and web server configs using openssl x509 -enddate. Calculate remaining days until expiration. If any certificate expires in less than 14 days, send an urgent renewal reminder.",
		profile: "security",
		schedule: { type: "cron", expression: "0 8 * * *" },
		policyMode: "safe",
		timeoutSeconds: 90,
		toolsAllow: ["bash", "read", "send_notification"],
	},
	{
		id: "docker-unhealthy-pruner",
		title: "Docker Container Health & Image Pruner",
		category: "devops",
		description: "Supervises container healthchecks and cleans up dangling Docker images and build caches.",
		goal: "Inspect all running Docker containers. If any container has status 'unhealthy' or high restart count, capture logs and restart it. Prune dangling container images and build cache if disk usage is high.",
		profile: "devops",
		schedule: { type: "interval", seconds: 900 },
		policyMode: "autonomous",
		timeoutSeconds: 180,
	},
	{
		id: "security-port-auditor",
		title: "Listening Ports & SSH Session Auditor",
		category: "security",
		description: "Non-destructive hourly scan of open TCP/UDP listening ports and active login sessions.",
		goal: "Scan all listening TCP and UDP sockets using ss -tulpn. Compare against baseline authorized ports (22, 80, 443). Inspect active SSH sessions with w and last. Alert immediately on unexpected listening sockets or suspicious remote logins.",
		profile: "security",
		schedule: { type: "interval", seconds: 3600 },
		policyMode: "safe",
		timeoutSeconds: 90,
		toolsAllow: ["bash", "read", "send_notification"],
	},
];

/**
 * Returns all available curated task templates.
 */
export function listTaskTemplates(): TaskTemplate[] {
	return [...TASK_TEMPLATES];
}

/**
 * Find a task template by ID.
 */
export function getTaskTemplate(id: string): TaskTemplate | undefined {
	const lower = id.toLowerCase().trim();
	return TASK_TEMPLATES.find((t) => t.id.toLowerCase() === lower || t.title.toLowerCase().includes(lower));
}

/**
 * Instantiate a CreateTaskInput from a template with optional overrides.
 */
export function instantiateTemplate(templateId: string, overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
	const template = getTaskTemplate(templateId);
	if (!template) {
		throw new Error(
			`Template not found: "${templateId}". Run "forge task template list" to see available templates.`,
		);
	}

	return {
		name: overrides.name ?? template.id,
		goal: overrides.goal ?? template.goal,
		profile: overrides.profile ?? template.profile,
		schedule: overrides.schedule ?? template.schedule,
		enabled: overrides.enabled ?? true,
		overlapPolicy: overrides.overlapPolicy ?? "skip",
		timeoutSeconds: overrides.timeoutSeconds ?? template.timeoutSeconds,
		retryPolicy: overrides.retryPolicy ?? template.retryPolicy,
		policyMode: overrides.policyMode ?? template.policyMode,
		modelTier: overrides.modelTier ?? template.modelTier,
		toolsAllow: overrides.toolsAllow ?? template.toolsAllow,
		toolsDeny: overrides.toolsDeny ?? template.toolsDeny,
		notifications: overrides.notifications,
	};
}
