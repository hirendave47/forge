# Forge Autonomous AI Agent CLI — User & Operational Guide

Forge is a lightweight, ultra-fast, and modular general-purpose autonomous AI Agent platform for Linux, Systems Engineering, DevOps, SRE, and automation.

---

## Table of Contents

1. [Overview & Core Architecture](#1-overview--core-architecture)
2. [Installation & Quick Start](#2-installation--quick-start)
3. [One-Shot Tasks (`forge run`)](#3-one-shot-tasks-forge-run)
4. [Persistent Scheduled Tasks (`forge task`)](#4-persistent-scheduled-tasks-forge-task)
5. [Step-by-Step How-To Guides & Recipes](#5-step-by-step-how-to-guides--recipes)
6. [Task YAML Configuration Specification](#6-task-yaml-configuration-specification)
7. [Agent Profiles & Personas](#7-agent-profiles--personas)
8. [Deterministic Processors & Checkpoints](#8-deterministic-processors--checkpoints)
9. [Policy Engine & Production Guardrails](#9-policy-engine--production-guardrails)
10. [Automated Verification Engine](#10-automated-verification-engine)
11. [Model Context Protocol (MCP) Integration](#11-model-context-protocol-mcp-integration)
12. [systemd Background Daemon (`forge-taskd`)](#12-systemd-background-daemon-forge-taskd)
13. [Notifications (Email & Webhook)](#13-notifications-email--webhook)
14. [Model Providers & Custom OpenAI Endpoints](#14-model-providers--custom-openai-compatible-endpoints)
15. [Operational Skills Reference](#15-operational-skills-reference)

---

## 1. Overview & Core Architecture

Forge bridges conversational LLMs with deterministic Linux operational engineering. It provides:

* **Dual Execution Modes**: One-shot immediate execution (`forge run`) and persistent scheduled execution (`forge task`).
* **Deterministic Pre-LLM Processors**: Perform bounded chunk reading, log rotation detection, error deduplication (SHA-256), and system metrics capture *before* invoking the LLM to conserve token context.
* **Concurrency Prevention (Leases)**: Atomic lease locking in SQLite with TTL heartbeats prevents duplicate task execution.
* **Crash Recovery**: Automatically reclaims stale leases and fixes orphaned runs after node reboots or process crashes.
* **Production Guardrails**: Hard interceptors block destructive system commands (`rm -rf /`, `reboot`, `mkfs`, `kill -9 1`, `iptables -F`).
* **Automated Verification**: Independent validation rules (`nginx -t`, `systemctl is-active`, `sshd -t`) before reporting task success.

```text
┌──────────────────────────────────────────────────────────┐
│                      User / CLI                          │
└────────────┬─────────────────────────────────┬───────────┘
             │                                 │
             ▼                                 ▼
   forge run "<goal>"                 forge task create ...
             │                                 │
             ▼                                 ▼
    ┌─────────────────┐               ┌──────────────────┐
    │ One-Shot Runner │               │ Task Scheduler   │
    └────────┬────────┘               └────────┬─────────┘
             │                                 │
             └───────────────┬─────────────────┘
                             ▼
              ┌─────────────────────────────┐
              │     TaskRuntime Pipeline    │
              │  - Lease acquisition        │
              │  - Incremental Checkpoints  │
              │  - Deterministic Processors │
              │  - Policy Engine Check      │
              │  - Automated Verification   │
              │  - Audit Event Trail        │
              └──────────────┬──────────────┘
                             ▼
              ┌─────────────────────────────┐
              │      Forge Core SDK         │
              │  (createAgentSession)       │
              └──────────────┬──────────────┘
                             ▼
              ┌─────────────────────────────┐
              │     30+ LLM Providers       │
              │  (Anthropic, OpenAI, etc.)  │
              └─────────────────────────────┘
```

---

## 2. Installation & Quick Start

### Standalone Linux Binary

```bash
# Build standalone binary with Bun & Docker
./build-and-install.sh
# Binary installed to /usr/local/bin/forge
```

### Running Directly From Source (Zero-Build Development Workflow)

During local development, you do **not** need to compile, bundle, or build the monorepo when testing code changes. Forge provides instant execution wrappers that use `tsx` to load and execute all TypeScript packages directly from their source files:

```bash
# 1. Install workspace dependencies (one-time setup)
npm install --ignore-scripts

# 2. Run any command directly from TypeScript source:
./forge-test.sh run "Investigate system memory usage and top 5 processes"
./forge-test.sh task list
./forge-test.sh -p "Check system health"
./forge-test.sh                     # Launches interactive TUI directly from source

# Alternatively via npm script:
npm run dev -- run "Investigate system memory usage and top 5 processes"
npm run dev -- task list
npm run dev -- --help
```

* **No Build Step Required**: Changes to any TypeScript file in `packages/*/src/` take effect immediately on your next `./forge-test.sh` invocation.
* **Path Resolution**: `tsconfig.json` paths automatically route package imports (`@earendil-works/forge-coding-agent`, `@earendil-works/forge-linux-agent`, `@earendil-works/forge-ai`, etc.) directly to their active `src/` directories.
* **Testing without Environment API Keys**: Pass `--no-env` to temporarily unset environment API keys and test local/unauthenticated fallbacks:
  ```bash
  ./forge-test.sh --no-env --help
  ```
* **Cross-Platform Development Wrappers**:
  - Linux/macOS: `./forge-test.sh <args>`
  - Windows PowerShell: `.\forge-test.ps1 <args>`
  - Windows Command Prompt: `.\forge-test.bat <args>`

---

## 3. One-Shot Tasks (`forge run`)

Execute an autonomous task with specific profiles, timeouts, or tool filters.

### Usage

```bash
forge run "<goal>" [options]
```

### Options

| Option | Description | Default |
|---|---|---|
| `--profile <name>` | Agent profile: `sysadmin`, `devops`, `sre`, `software-engineer`, `security` | `default` |
| `--timeout <seconds>` | Maximum execution duration | `120` |
| `--debug`, `-d` | Trace full logs with timestamps, tool execution metrics, and input/output token telemetry | `false` |
| `--pretty` | Format output with styled terminal Markdown (box borders for tables, colors, syntax highlighting) | `true` in TTY |
| `--plain`, `--no-pretty` | Output raw plain Markdown text without ANSI styling (ideal for scripting / piping) | `true` if piped |
| `--tools, -t <tools>` | Comma-separated allowlist of tools | (dynamic selection) |
| `--exclude-tools, -xt` | Comma-separated denylist of tools | — |
| `--append-system-prompt` | Additional prompt instructions | — |
| `--help, -h` | Show help text | — |

### Examples

```bash
# 1. Investigate system memory usage (renders styled tables & Markdown in terminal)
forge run "Investigate system memory usage, identify top 5 processes"

# 2. Run with detailed debug tracing (timestamps, tool timings, input/output token counts)
forge run --debug "Investigate system memory usage and top 5 processes"

# 3. Explicitly force styled terminal Markdown
forge run --pretty "Check disk usage across all mountpoints"

# 4. Output raw plain Markdown for piping into files or downstream scripts
forge run --plain "List active docker containers" > containers.md

# 5. Sysadmin troubleshooting with custom profile
forge run --profile sysadmin "Why is nginx returning HTTP 502 Bad Gateway?"

# 6. Security audit with 5-minute timeout
forge run --profile security --timeout 300 "Audit /etc/ssh/sshd_config and open listening ports"

# 7. Safe read-only inspection
forge run --tools read,grep,find,ls "Examine /var/log/syslog for kernel errors"
```

### Exit Codes

| Code | Status | Meaning |
|---|---|---|
| `0` | Success | Goal achieved and verified |
| `1` | Failure | Task failed or agent could not reach goal |
| `2` | Policy Rejection | Action blocked by active policy mode |
| `3` | Invalid Task | Bad configuration or syntax |
| `4` | Timeout | Execution exceeded timeout limit |
| `5` | Infrastructure | Runtime or SQLite database error |

---

## 4. Persistent Scheduled Tasks (`forge task`)

Manage durable, recurring, or one-time persistent tasks backed by SQLite.

### Subcommand Reference

```bash
forge task <command> [options]
```

| Subcommand | Description | Example |
|---|---|---|
| `wizard` | Launch interactive guided task creation wizard | `forge task wizard` |
| `template [list|show]` | Browse & inspect curated production templates | `forge task template list` |
| `explain <schedule>` | Natural language schedule explainer & timeline | `forge task explain "*/15 * * * *"` |
| `test <task|goal>` | Safe dry-run task simulation | `forge task test nginx-monitor` |
| `create "<goal>" [options]` | Create a new scheduled or one-time task | `forge task create --name mem-check --every 5m "Check RAM"` |
| `create --template <name>` | Create task from curated template | `forge task create --template nginx-error-monitor` |
| `create --interactive` / `-i` | Launch interactive guided wizard | `forge task create -i` |
| `create --from <file>` | Create task from YAML config | `forge task create --from tasks/nginx-monitor.yaml` |
| `list` / `ls` | List all tasks with status & schedules | `forge task list` |
| `show <task>` | Show detailed configuration | `forge task show nginx-monitor` |
| `status <task>` | Show live status, active lease, recent runs | `forge task status nginx-monitor` |
| `runs <task>` | View execution history | `forge task runs nginx-monitor` |
| `logs <task>` | View event audit log | `forge task logs nginx-monitor` |
| `run <task>` | Manually trigger a task execution | `forge task run nginx-monitor` |
| `pause <task>` | Disable a task | `forge task pause nginx-monitor` |
| `resume <task>` | Re-enable a paused task | `forge task resume nginx-monitor` |
| `cancel <task>` | Cancel task and release lock lease | `forge task cancel nginx-monitor` |
| `doctor` | Diagnose and recover stale leases | `forge task doctor` |
| `cleanup` | Remove completed runs older than N days | `forge task cleanup --days 14` |
| `daemon` | Run task scheduler in foreground | `forge task daemon` |
| `service <action>` | Manage systemd user service | `forge task service install` |

### Curated Task Templates (`forge task template`)

Forge ships with built-in production templates for common operational patterns:

```bash
# List all available templates
forge task template list

# Inspect template definition and goal
forge task template show nginx-error-monitor

# Create task from template
forge task create --template nginx-error-monitor --name prod-nginx-mon
```

| Template ID | Category | Profile | Schedule | Description |
|---|---|---|---|---|
| `nginx-error-monitor` | Sysadmin | `sysadmin` | `every 30s` | High-frequency /var/log/nginx/error.log monitoring & root cause context windowing |
| `disk-space-cleaner` | SRE | `sre` | `every 1h` | Mount point utilization check & safe dry-run cache/temp purge when >85% |
| `systemd-service-watchdog` | Sysadmin | `sysadmin` | `every 1m` | Supervise critical units (nginx, docker, redis) with automatic restart on crash |
| `memory-leak-detector` | SRE | `sre` | `every 5m` | Track top process resident set size (RSS) and saturation alerts |
| `postgres-nightly-backup` | SRE | `sre` | `0 2 * * *` | Compressed pg_dump with SHA-256 checksums and 7-day retention |
| `ssl-cert-expiry-check` | Security | `security` | `0 8 * * *` | Daily TLS certificate expiration audit with alerts if <14 days remaining |
| `docker-unhealthy-pruner` | DevOps | `devops` | `every 15m` | Container healthcheck watchdog and dangling image cleanup |
| `security-port-auditor` | Security | `security` | `every 1h` | Non-destructive listening TCP/UDP port and SSH login session audit |

---

### Schedule Explainer & Timeline Visualizer (`forge task explain`)

Convert cryptic cron expressions and intervals into clear plain English and preview upcoming execution times:

```bash
# Explain a 5-part UTC cron expression
forge task explain "*/15 * * * *"

# Explain a recurring interval
forge task explain "every 30s"

# Explain the schedule of an existing task
forge task explain nginx-monitor
```

---

### Safe Dry-Run Task Simulation (`forge task test`)

Execute a task in safe, read-only mode to verify tool calls, token usage, and exit criteria without modifying system state or task schedules:

```bash
# Test an existing task
forge task test nginx-monitor

# Test a raw operational goal
forge task test "Check system memory usage and top 5 processes" --timeout 30
```

---

### Interactive Task Wizard (`forge task wizard` / `forge task create -i`)

Forge includes a terminal wizard that guides you step-by-step through configuring tasks with automated host discovery and dynamic follow-up questions:

```bash
# Launch interactive wizard
forge task wizard

# Launch wizard with an initial goal
forge task wizard "Monitor disk usage and alert when full"

# Launch wizard with instant smart AI follow-up refinement
forge task wizard --smart "Supervise postgres health"
```

**Wizard Features & Workflow:**
1. **Goal Formulation**: Specify what operational objective the agent should achieve.
2. **Host Environment Auto-Discovery**: Automatically inspects local OS version, running systemd services, disk mount utilization, accessible log files in `/var/log`, and open TCP ports.
3. **Dynamic AI Follow-Up Questions**: Generates 2–3 contextual operational questions tailored to your goal and local host environment (e.g. asking for exact log file paths from detected logs, disk utilization thresholds, auto-remediation restart policies).
4. **Smart Persona & Schedule Recommendations**: Automatically recommends the optimal Agent Persona (`sysadmin`, `sre`, `devops`, `security`, `software-engineer`) and schedule frequency based on your task intent.
5. **Live Schedule Previews**: Previews the next 3 trigger timestamps for cron and interval schedules in local time.
6. **Safety & Execution Limits**: Choose between `autonomous`, `supervised`, or `safe` (read-only diagnostics), with optional retry policies and notification alerts.
7. **Action**: Save directly to SQLite database and activate, or export to a declarative `task.yaml` file for version control.

---

### `forge task create` Options Reference

```bash
forge task create "<goal>" [options]
```

#### 1. Schedule Options (Mutually Exclusive)
| Option | Description | Example |
|---|---|---|
| `--every <interval>` | Recurring interval (`30s`, `5m`, `1h`) | `--every 5m` |
| `--cron <expr>` | UTC 5-part cron expression | `--cron "*/15 * * * *"` |
| `--at <datetime>` | Run once at ISO 8601 datetime | `--at "2026-08-30T15:00:00Z"` |

#### 2. Operational & Execution Options
| Option | Description | Default |
|---|---|---|
| `--name <name>` | Unique task name (auto-generated if omitted) | Slug from goal |
| `--profile <name>` | Agent persona (`sysadmin`, `devops`, `sre`, `software-engineer`, `security`) | `default` |
| `--policy <mode>` | Safety policy mode (`safe`, `supervised`, `autonomous`) | `autonomous` |
| `--model-tier <tier>` | Model tier routing (`fast`, `default`, `reasoning`, `coding`) | `default` |
| `--timeout <seconds>` | Maximum execution duration in seconds | `120` |
| `--overlap <policy>` | Concurrency policy (`skip`, `queue`) | `skip` |
| `--disabled` | Create task in disabled state | `false` (enabled) |

#### 3. Retry & Fault Tolerance
| Option | Description | Default |
|---|---|---|
| `--retries <n>` | Maximum retry attempts upon failure | `0` |
| `--retry-delay <sec>` | Delay between retry attempts | `30` |
| `--retry-strategy <type>` | Backoff strategy (`fixed`, `exponential`) | `fixed` |

#### 4. Tools, Skills & Notifications
| Option | Description | Example |
|---|---|---|
| `--tools, -t <list>` | Comma-separated allowlist of tools | `--tools read,grep,send_notification` |
| `--exclude-tools, -xt <l>` | Comma-separated denylist of tools | `--exclude-tools bash,edit` |
| `--skills <list>` | Comma-separated skill names | `--skills linux-log-analysis` |
| `--notify-email <emails>` | Comma-separated notification emails | `--notify-email oncall@example.com` |
| `--notify-webhook <url>` | Notification webhook endpoint | `--notify-webhook https://hooks.slack.com/...` |

### CLI Creation Examples

```bash
# 1. Interval-based system monitoring
forge task create --name disk-check --every 5m "Check disk usage across mounts and alert if >90%"

# 2. Cron-scheduled database vacuum with retries
forge task create --name db-vacuum --cron "0 2 * * *" --retries 2 --retry-strategy exponential "Vacuum PostgreSQL tables"

# 3. Security audit with safe read-only tools and email notifications
forge task create --name sec-audit --profile security --policy safe --tools read,grep \
  --notify-email "security@example.com" --cron "0 0 * * 1" "Audit /etc/ssh/sshd_config and listening ports"

# 4. One-time scheduled maintenance
forge task create --name cert-renew --at "2026-08-30T18:00:00Z" "Renew TLS certificates via certbot"
```

### Task Referencing

Tasks can be referenced by **name**, **full UUID**, or **UUID prefix** (e.g. `nginx-mon` or `e1330c04`).

---

## 5. Step-by-Step How-To Guides & Practical Recipes

This section provides end-to-end operational recipes and practical workflows for managing autonomous tasks with Forge CLI.

---

### How-To 1: Interactive Wizard with Host Auto-Discovery & Dynamic AI Questions

The interactive wizard is the recommended way to create tasks when you want Forge to inspect your system environment and guide you through operational edge cases:

```bash
# Launch interactive wizard with smart refinement
forge task wizard --smart
```

#### Walkthrough Transcript:
```text
┌────────────────────────────────────────────────────────┐
│             FORGE TASK CREATION WIZARD                 │
│       Configure autonomous Linux background tasks      │
└────────────────────────────────────────────────────────┘

? What is the operational goal for this task? (or type 'template' for presets): Supervise postgres database health and disk storage
  [Host Context] OS: Ubuntu | Services: postgresql, containerd, cron | Disk /: 82%

  Operational Clarifications:
? What is the database name or connection port? [5432]: 5432
? What disk usage percentage should trigger table vacuuming or log pruning? [85]: 80
? Should the agent send email alerts on connection failure? (Y/n): Y
? Task Name (unique identifier) [supervise-postgres-database]: postgres-watchdog

? Select an Agent Persona / Profile:
  1) sysadmin — Linux administration, service status
  2) sre (default) — Observability, error deduplication, resource saturation (Recommended)
  3) devops — Infrastructure automation, containers, CI/CD
  4) security — Security auditing, file permissions, open ports
  5) software-engineer — Code fixes, unit tests, regression detection
  6) default — General-purpose agent without specialized profile
  Select [1-6] [2]: 2

? How should this task be scheduled?
  1) Interval (default) — Repeat every N seconds, minutes, or hours (e.g. 30s, 5m, 1h)
  2) Cron Expression — Standard 5-part UTC cron (e.g. */15 * * * *)
  3) One-Time (Once) — Run once at a scheduled ISO datetime
  4) Manual Only — No automatic schedule, triggered on-demand via CLI
  Select [1-4] [1]: 1
? Repeat interval (e.g. 30s, 5m, 1h) [5m]: 5m
  → Next execution in: 5m (2:25:00 PM)

? Select safety policy mode:
  1) autonomous (default) — Execute all operations independently within safety guardrails
  2) supervised — Require human confirmation for state-changing commands
  3) safe — Strictly read-only diagnostics (no filesystem/service modifications)
  Select [1-3] [1]: 1

? Configure advanced settings (retries, timeouts, tool restrictions, notifications)? (y/N): n

┌────────────────────────────────────────────────────────┐
│                   TASK CONFIGURATION                   │
└────────────────────────────────────────────────────────┘
  Name:        postgres-watchdog
  Goal:        Supervise postgres database health and disk storage
               - Target Port: 5432
               - Disk Threshold: 80%
               - Alert On Failure: true
  Profile:     sre
  Schedule:    every 5m
  Policy Mode: autonomous
  Timeout:     120s

? What would you like to do with this task?
  1) Save and Enable in Task Store (default)
  2) Export as YAML Configuration File
  3) Cancel and Exit
  Select [1-3] [1]: 1

✓ Task "postgres-watchdog" created and enabled (ID: a1b2c3d4-e5f6-7890)
```

---

### How-To 2: High-Frequency Nginx Log Watchdog with Error Deduplication

Monitor Nginx error logs every 30 seconds, automatically deduplicating repeated error lines and capturing 5 lines of surrounding context when error bursts occur.

#### Command:
```bash
forge task create \
  --name nginx-watchdog \
  --profile sysadmin \
  --every 30s \
  --timeout 60 \
  --policy autonomous \
  --tools read,grep,wait_interval,send_notification \
  --notify-email "sre-alerts@example.com" \
  "Inspect /var/log/nginx/error.log for HTTP 500, upstream timed out, or connection refused errors. \
   If more than 3 errors occur in the interval, capture 5 lines of context before and after the event, \
   deduplicate identical stack traces, and email an incident root-cause report."
```

---

### How-To 3: Automated Nightly Database Backup with Exponential Retries

Schedule a nightly PostgreSQL backup at 02:00 UTC with gzip compression, SHA-256 integrity verification, 7-day retention rotation, and automated exponential backoff on failure.

#### Command:
```bash
forge task create \
  --name pg-nightly-backup \
  --profile sre \
  --cron "0 2 * * *" \
  --timeout 600 \
  --retries 2 \
  --retry-delay 60 \
  --retry-strategy exponential \
  --notify-email "db-admins@example.com" \
  "Run pg_dumpall with gzip compression into /var/backups/postgres/$(date +%Y%m%d_%H%M%S).sql.gz. \
   Generate SHA-256 checksums and verify gzip integrity with gzip -t. \
   Purge backups older than 7 days from /var/backups/postgres. Report total backup size and status."
```

---

### How-To 4: Instant Instantiation from Curated Templates

Forge includes 8 battle-tested production templates (`nginx-error-monitor`, `disk-space-cleaner`, `systemd-service-watchdog`, `memory-leak-detector`, `postgres-nightly-backup`, `ssl-cert-expiry-check`, `docker-unhealthy-pruner`, `security-port-auditor`).

#### Steps:
```bash
# 1. View all available templates
forge task template list

# 2. Inspect a template's definition and default policy
forge task template show ssl-cert-expiry-check

# 3. Create a production task from the template with custom name and overrides
forge task create \
  --template ssl-cert-expiry-check \
  --name prod-ssl-auditor \
  --notify-email "security-oncall@example.com"
```

---

### How-To 5: Explaining & Visualizing Execution Timelines

Use `forge task explain` to convert cron syntax or intervals into plain English and visualize the exact local and UTC execution timestamps with countdown durations.

#### Examples:
```bash
# Explain a 5-part UTC cron expression
forge task explain "*/15 * * * *"
```
```text
┌────────────────────────────────────────────────────────┐
│             FORGE SCHEDULE EXPLAINER                   │
└────────────────────────────────────────────────────────┘
  Schedule:    */15 * * * *
  Explanation: Every 15 minutes past the hour (UTC)

  Upcoming Execution Timeline:
  #   Local Time                 UTC Time                 Countdown
  ───────────────────────────────────────────────────────────────────
  1   8/27/2026, 2:30:00 PM      2026-08-27 09:00:00 UTC  in 14m
  2   8/27/2026, 2:45:00 PM      2026-08-27 09:15:00 UTC  in 29m
  3   8/27/2026, 3:00:00 PM      2026-08-27 09:30:00 UTC  in 44m
  4   8/27/2026, 3:15:00 PM      2026-08-27 09:45:00 UTC  in 59m
  5   8/27/2026, 3:30:00 PM      2026-08-27 10:00:00 UTC  in 1h 14m
```

```bash
# Explain an interval or existing task
forge task explain "every 1h"
forge task explain pg-nightly-backup
```

---

### How-To 6: Safe Dry-Run Testing & Verifying Tasks Before Enabling

Always test newly defined tasks in safe mode (`PolicyMode.SAFE`) before scheduling them in production to verify tool invocations, token costs, and exit criteria without modifying system state.

#### Examples:
```bash
# Test an existing configured task
forge task test nginx-watchdog

# Test a raw operational goal directly with a custom timeout
forge task test "Inspect memory usage and top 5 processes by RSS" --timeout 30
```
```text
┌────────────────────────────────────────────────────────┐
│             FORGE TASK DRY-RUN SIMULATION              │
│        Safe non-mutating diagnostic execution          │
└────────────────────────────────────────────────────────┘
  Task:    ephemeral-test
  Goal:    Inspect memory usage and top 5 processes by RSS
  Profile: default
  Policy:  safe (read-only mode)

  [agent] Creating agent session...
  [agent] Executing diagnostic tools: ps, free...
  [verify] Verifying exit criteria...

✓ Simulation SUCCEEDED in 1.42s
  Tokens: 780 in / 115 out | Tool Calls: 2
```

---

### How-To 7: Declarative GitOps Workflow with YAML Configuration

Manage task definitions in source control (e.g. in a Git repository under `tasks/`):

#### 1. Define `tasks/disk-cleaner.yaml`:
```yaml
name: disk-pressure-cleaner
goal: |
  Inspect all mounted filesystems. If any mount point exceeds 85% capacity,
  identify stale log archives in /var/log/*.gz and cache directories in /var/cache.
  Perform a safe dry-run before deleting unneeded archives.
profile: sre
schedule:
  type: interval
  seconds: 3600
execution:
  overlap: skip
  timeout: 180
  retries: 1
  retry_delay_seconds: 60
  retry_strategy: fixed
policy:
  mode: autonomous
```

#### 2. Deploy or update task in SQLite store:
```bash
forge task create --from tasks/disk-cleaner.yaml
```

---

### How-To 8: Daemon Operation & Systemd User Service Automation

Run Forge unattended as a non-root background daemon managed by systemd:

```bash
# 1. Install and enable user service unit
forge task service install
forge task service start

# 2. Check service status and live journal output
forge task service status

# 3. Ensure user service continues running across logouts:
loginctl enable-linger $USER
```

---

### How-To 9: Task Maintenance, Health Diagnostics & Lease Recovery

If a task process was abruptly terminated (e.g. unexpected server reboot or kernel panic), use `doctor` to audit and release stale leases:

```bash
# Audit SQLite store for orphaned leases or stalled executions
forge task doctor

# Manually trigger a task on-demand
forge task run nginx-watchdog

# View recent execution run history
forge task runs nginx-watchdog

# View detailed audit logs for a task
forge task logs nginx-watchdog

# Clean up completed runs older than 14 days
forge task cleanup --days 14
```

---

## 6. Task YAML Configuration Specification

Define declarative, version-controlled tasks using YAML:

```yaml
# tasks/nginx-error-monitor.yaml
name: nginx-error-monitor
goal: |
  Monitor /var/log/nginx/error.log for HTTP 500 and upstream timeout errors.
  If error spike occurs, diagnose upstream backend service and email summary report.

enabled: true
profile: sysadmin

# Schedule options: interval, cron, or once
schedule:
  type: interval
  seconds: 30
  # Alternatively:
  # type: cron
  # expression: "*/5 * * * *"
  # type: once
  # at: "2026-08-30T15:00:00Z"

execution:
  overlap: skip            # skip | queue | replace | allow
  timeout: 180             # Execution timeout in seconds
  retries: 2               # Maximum retry attempts
  retry_delay_seconds: 30
  retry_strategy: exponential # fixed | exponential

tools:
  allow: [bash, read, grep, wait_interval, send_notification]

skills:
  - linux-log-analysis
  - nginx-troubleshooting
  - email-reporting

model_tier: fast           # fast | default | reasoning | coding
policy:
  mode: autonomous         # safe | supervised | autonomous

notifications:
  email:
    to:
      - sre-team@example.com
      - oncall@example.com
  on: [failure, always]    # failure | success | always
```

Load and activate the task:
```bash
forge task create --from tasks/nginx-error-monitor.yaml
```

---

## 7. Agent Profiles & Personas

Forge includes 5 specialized operating personas:

| Profile | Focus | Principles & Verification |
|---|---|---|
| `sysadmin` | Linux administration & service maintenance | Reversible configuration, syntax validation (`nginx -t`, `sshd -t`), `systemctl is-active` checks. |
| `devops` | Automation, CI/CD, and containers | Infrastructure-as-code, repeatable steps, container & health endpoint validation. |
| `sre` | Reliability, SLIs/SLOs, and incident triage | Observability-first, error deduplication, resource saturation normalization. |
| `software-engineer` | Code debugging, refactoring, and tests | Adherence to codebase conventions, test execution (`npm test`), regression checks. |
| `security` | Auditing, hardening, and secret detection | Least privilege, secret masking, file permissions (`600`/`640`), listening socket audits. |

---

## 8. Deterministic Processors & Checkpoints

Deterministic processors execute local computation **before** calling the LLM, reducing context tokens and eliminating noise:

### 1. Log Reader (`LogReaderProcessor`)
* Tracks file identity using `device` and `inode`.
* Automatically detects log rotation (when inode changes or file shrinks).
* Reads only new byte ranges since the last successful execution checkpoint.

### 2. Log Deduplicator (`LogDeduplicatorProcessor`)
* Normalizes ephemeral tokens (timestamps, PIDs, UUIDs, IP addresses).
* Generates SHA-256 error hashes.
* Aggregates 100 identical raw errors into a single compact incident summary with first/last timestamps, occurrence counts, and ±3-line context windows.

### 3. System Health (`SystemHealthProcessor`)
* Instantly collects memory usage, load averages, top consuming processes, and disk utilization without wasting LLM tool calls.

---

## 9. Policy Engine & Production Guardrails

The Policy Engine evaluates operations independently of the LLM:

### Operation Risk Classification

* **`READ`**: `read`, `grep`, `find`, `ls`, `ps`, `df`, `journalctl`, `systemctl status`.
* **`LOW_RISK`**: Generating reports, writing to scratch paths.
* **`MODIFY`**: Editing `/etc/` configurations, `systemctl restart`, `service reload`.
* **`HIGH_RISK`**: `apt-get install`, `yum install`, `iptables`, `ufw`, `useradd`.
* **`DESTRUCTIVE`**: `rm -rf /`, `reboot`, `shutdown`, `mkfs`, `kill -9 1`.

### Policy Modes

* **`safe`**: Permits `READ` and `LOW_RISK`. Blocks `MODIFY`, `HIGH_RISK`, `DESTRUCTIVE`.
* **`supervised`**: Permits `READ`, `LOW_RISK`, `MODIFY`. Requires confirmation for `HIGH_RISK`. Blocks `DESTRUCTIVE`.
* **`autonomous`**: Permits `READ`, `LOW_RISK`, `MODIFY`, `HIGH_RISK`. **Strictly blocks `DESTRUCTIVE`**.

---

## 10. Automated Verification Engine

Every modifying operational action triggers independent automated verification:

| Action | Automated Verification Check | Success Condition |
|---|---|---|
| Nginx Config Edit | `nginx -t` | Syntax is OK and test is successful |
| SSH Config Edit | `sshd -t` | No fatal syntax errors |
| Service Restart | `systemctl is-active <service>` | Service state is `active` |
| Web Service Change | `curl -f http://localhost:<port>/health` | HTTP 200 response |

The agent is blocked from reporting success if verification fails.

---

## 11. Model Context Protocol (MCP) Integration

Forge supports external tools via MCP (Model Context Protocol).

Configure MCP servers in `~/.forge/agent/mcp.json`:

```json
{
  "mcpServers": {
    "kubernetes": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-kubernetes"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "BSA..." }
    }
  }
}
```

Tools are automatically discovered and prefixed (e.g. `mcp_kubernetes_list_pods`, `mcp_brave_search_search`).

---

## 12. systemd Background Daemon (`forge-taskd`)

Forge operates unattended in the background as a systemd **user service** without requiring root privileges.

### Managing the Service

```bash
# 1. Install user service unit (~/.config/systemd/user/forge-taskd.service)
forge task service install

# 2. Start and enable service
forge task service start

# 3. Check service status and journald logs
forge task service status

# 4. Stop service
forge task service stop

# 5. Uninstall service unit
forge task service uninstall
```

### systemd Unit Definition

```ini
[Unit]
Description=Forge Autonomous Task Scheduler Daemon (forge-taskd)
Documentation=https://github.com/hirendave47/forge
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/forge task daemon
Restart=always
RestartSec=5s
Environment=FORGE_CODING_AGENT_DIR=%h/.forge/agent
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=default.target
```

---

## 13. Notifications (Email & Webhook)

Dispatch status updates, error alerts, and periodic digests via Postfix SMTP or Webhooks:

```bash
# SMTP Configuration
export FORGE_SMTP_HOST="localhost"
export FORGE_SMTP_PORT=25
export FORGE_NOTIFICATION_FROM="noreply@example.com"
export FORGE_NOTIFICATION_TO="hiren.dave@example.com"

# Webhook Configuration (Slack, Discord, Teams)
# export FORGE_NOTIFICATION_WEBHOOK="https://hooks.slack.com/services/..."
```

---

## 14. Model Providers & Custom OpenAI-Compatible Endpoints

Forge supports 30+ LLM providers out of the box (Anthropic, OpenAI, Google Gemini, Groq, DeepSeek, Cerebras, xAI, OpenRouter, Mistral, etc.) as well as custom self-hosted or proxy OpenAI-compatible inference servers (such as Ollama, vLLM, forge-local, LocalAI, LM Studio, etc.).

### Interactive Setup via `/login`
Run `/login` in interactive mode and select **`Custom (OpenAI-compatible)`**:
```bash
/login
```
Forge will prompt you for:
1. **Endpoint URL**: `http://127.0.0.1:8000/v1` (or your private inference endpoint)
2. **API Token / Key**: (optional, press Enter if unauthenticated)
3. **Model Name / ID**: `gemini-3.7-flash`, `qwen3-coder-next`, `llama3`, etc.
4. **Custom Provider ID**: `forge-local`, `ollama`, `custom`, etc.
5. **Context Window Size**: `128000` (default) or `256000`

The configuration is automatically persisted to `~/.forge/agent/models.json` and selected as the active model for immediate use.

### Manual Configuration via `~/.forge/agent/models.json`
You can also configure one or more custom OpenAI-compatible endpoints directly:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:8000/v1",
      "api": "openai-completions",
      "apiKey": "llama",
      "models": [
        {
          "id": "gemini-3.7-flash",
          "name": "gemini-3.7-flash",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 256000,
          "maxTokens": 256000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    },
    "forge-local": {
      "baseUrl": "http://127.0.0.1:8082/v1",
      "api": "openai-completions",
      "apiKey": "a313d06dbbe31d4c4dffa26f4f6097efe5f355a103e15c996f143c1da1fcf569",
      "models": [
        {
          "id": "qwen3-coder-next",
          "name": "qwen3-coder-next",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 128000,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
```

---

## 15. Operational Skills Reference

Skills in `.forge/skills/` are loaded progressively on demand:

* **[`linux-log-analysis.md`](.forge/skills/linux-log-analysis.md)** — Bounded ingestion, journalctl filtering, log spike diagnosis.
* **[`systemd-troubleshooting.md`](.forge/skills/systemd-troubleshooting.md)** — Failed units, dependency loops, safe restart protocol.
* **[`nginx-troubleshooting.md`](.forge/skills/nginx-troubleshooting.md)** — HTTP 502/504 root cause analysis, upstream timeouts, `nginx -t` validation.
* **[`memory-investigation.md`](.forge/skills/memory-investigation.md)** — OOM killer inspection, RSS process ranking, memory pressure analysis.
* **[`disk-investigation.md`](.forge/skills/disk-investigation.md)** — Inode exhaustion, unlinked open file recovery (`lsof +L1`), large directory ranking.
* **[`security-audit.md`](.forge/skills/security-audit.md)** — Sudoers inspection, listening ports (`ss -tulpn`), sshd hardening verification.
* **[`kubernetes-investigation.md`](.forge/skills/kubernetes-investigation.md)** — CrashLoopBackOff triage, pod event correlation.
* **[`software-debugging.md`](.forge/skills/software-debugging.md)** — Stack trace isolation, regression testing, surgical code edits.
* **[`email-reporting.md`](.forge/skills/email-reporting.md)** — Structured executive digests and incident summary formats.
