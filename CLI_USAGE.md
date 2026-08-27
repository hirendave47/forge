# Forge Autonomous AI Agent CLI — User & Operational Guide

Forge is a lightweight, ultra-fast, and modular general-purpose autonomous AI Agent platform for Linux, Systems Engineering, DevOps, SRE, and automation.

---

## Table of Contents

1. [Overview & Core Architecture](#1-overview--core-architecture)
2. [Installation & Quick Start](#2-installation--quick-start)
3. [One-Shot Tasks (`forge run`)](#3-one-shot-tasks-forge-run)
4. [Persistent Scheduled Tasks (`forge task`)](#4-persistent-scheduled-tasks-forge-task)
5. [Task YAML Configuration Specification](#5-task-yaml-configuration-specification)
6. [Agent Profiles & Personas](#6-agent-profiles--personas)
7. [Deterministic Processors & Checkpoints](#7-deterministic-processors--checkpoints)
8. [Policy Engine & Production Guardrails](#8-policy-engine--production-guardrails)
9. [Automated Verification Engine](#9-automated-verification-engine)
10. [Model Context Protocol (MCP) Integration](#10-model-context-protocol-mcp-integration)
11. [systemd Background Daemon (`forge-taskd`)](#11-systemd-background-daemon-forge-taskd)
12. [Notifications (Email & Webhook)](#12-notifications-email--webhook)
13. [Operational Skills Reference](#13-operational-skills-reference)

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
| `create "<goal>"` | Create a new scheduled task | `forge task create --name mem-check --every 5m "Check RAM"` |
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

### Task Referencing

Tasks can be referenced by **name**, **full UUID**, or **UUID prefix** (e.g. `nginx-mon` or `e1330c04`).

---

## 5. Task YAML Configuration Specification

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

## 6. Agent Profiles & Personas

Forge includes 5 specialized operating personas:

| Profile | Focus | Principles & Verification |
|---|---|---|
| `sysadmin` | Linux administration & service maintenance | Reversible configuration, syntax validation (`nginx -t`, `sshd -t`), `systemctl is-active` checks. |
| `devops` | Automation, CI/CD, and containers | Infrastructure-as-code, repeatable steps, container & health endpoint validation. |
| `sre` | Reliability, SLIs/SLOs, and incident triage | Observability-first, error deduplication, resource saturation normalization. |
| `software-engineer` | Code debugging, refactoring, and tests | Adherence to codebase conventions, test execution (`npm test`), regression checks. |
| `security` | Auditing, hardening, and secret detection | Least privilege, secret masking, file permissions (`600`/`640`), listening socket audits. |

---

## 7. Deterministic Processors & Checkpoints

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

## 8. Policy Engine & Production Guardrails

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

## 9. Automated Verification Engine

Every modifying operational action triggers independent automated verification:

| Action | Automated Verification Check | Success Condition |
|---|---|---|
| Nginx Config Edit | `nginx -t` | Syntax is OK and test is successful |
| SSH Config Edit | `sshd -t` | No fatal syntax errors |
| Service Restart | `systemctl is-active <service>` | Service state is `active` |
| Web Service Change | `curl -f http://localhost:<port>/health` | HTTP 200 response |

The agent is blocked from reporting success if verification fails.

---

## 10. Model Context Protocol (MCP) Integration

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

## 11. systemd Background Daemon (`forge-taskd`)

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

## 12. Notifications (Email & Webhook)

Dispatch status updates, error alerts, and periodic digests via Postfix SMTP or Webhooks:

```bash
# SMTP Configuration
export FORGE_SMTP_HOST="localhost"
export FORGE_SMTP_PORT=25
export FORGE_NOTIFICATION_FROM="noreply@qforge.dev.fyre.ibm.com"
export FORGE_NOTIFICATION_TO="hiren.dave@ibm.com"

# Webhook Configuration (Slack, Discord, Teams)
# export FORGE_NOTIFICATION_WEBHOOK="https://hooks.slack.com/services/..."
```

---

## 13. Model Providers & Custom OpenAI-Compatible Endpoints

Forge supports 30+ LLM providers out of the box (Anthropic, OpenAI, Google Gemini, Groq, DeepSeek, Cerebras, xAI, OpenRouter, Mistral, etc.) as well as custom self-hosted or proxy OpenAI-compatible inference servers (such as Ollama, vLLM, QForge, LocalAI, LM Studio, etc.).

### Interactive Setup via `/login`
Run `/login` in interactive mode and select **`Custom (OpenAI-compatible)`**:
```bash
/login
```
Forge will prompt you for:
1. **Endpoint URL**: `http://127.0.0.1:8000/v1` (or your private inference endpoint)
2. **API Token / Key**: (optional, press Enter if unauthenticated)
3. **Model Name / ID**: `gemini-3.7-flash`, `qwen3-coder-next`, `llama3`, etc.
4. **Custom Provider ID**: `qforge`, `ollama`, `custom`, etc.
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
    "qforge": {
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

## 14. Operational Skills Reference

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
