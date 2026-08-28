# Forge Autonomous AI Agent CLI — User & Operational Guide

Forge is a lightweight, ultra-fast, and modular general-purpose autonomous AI Agent platform for Linux, Systems Engineering, DevOps, SRE, and automation.

---

## Table of Contents

1. [Overview & Core Architecture](#1-overview--core-architecture)
   - [1.1. Design Philosophy: Scripting vs. AI Agent vs. Hybrid](#11-design-philosophy-deterministic-scripting-vs-ai-agent-vs-hybrid)
   - [1.2. The Three Operational Paradigms](#12-the-three-operational-paradigms)
   - [1.3. Checkpoints & Historical Context Across Task Runs](#13-checkpoints--historical-context-across-task-runs)
2. [Installation & Quick Start](#2-installation--quick-start)
3. [One-Shot Tasks (`forge run`)](#3-one-shot-tasks-forge-run)
4. [Persistent Scheduled Tasks (`forge task`)](#4-persistent-scheduled-tasks-forge-task)
5. [Step-by-Step How-To Guides & Recipes](#5-step-by-step-how-to-guides--recipes)
6. [Task YAML Configuration Specification](#6-task-yaml-configuration-specification)
7. [Agent Profiles & Personas](#7-agent-profiles--personas)
8. [Deterministic Processors & Checkpoints](#8-deterministic-processors--checkpoints)
9. [Policy Engine & Production Guardrails](#9-policy-engine--production-guardrails)
10. [Root & Sudo Privileges Architecture (`forge task sudoers`)](#10-root--sudo-privileges-architecture-forge-task-sudoers)
11. [Automated Verification Engine](#11-automated-verification-engine)
12. [Model Context Protocol (MCP) Integration](#12-model-context-protocol-mcp-integration)
13. [systemd Background Daemon (`forge-taskd`)](#13-systemd-background-daemon-forge-taskd)
14. [Notifications (Email & Webhook)](#14-notifications-email--webhook)
15. [Model Providers & Custom OpenAI Endpoints](#15-model-providers--custom-openai-compatible-endpoints)
16. [Operational Skills Reference](#16-operational-skills-reference)

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
              │  - Historical Run Context   │
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

### 1.1. Design Philosophy: Deterministic Scripting vs. AI Agent vs. Hybrid

A common architectural question in autonomous systems is: **"If a task can be solved with a 10-line Bash script, why use an AI Agent?"**

The answer is that **simple, predictable tasks *should* be done by deterministic scripts or low-cost pre-processors**, while the **AI Agent is reserved for tasks requiring logical reasoning, multi-system correlation, hypothesis testing, code analysis, and adaptive remediation.**

| Dimension | Deterministic Script / Cron | Hybrid Probe + AI Escalation | Autonomous AI Agent (`forge run` / `forge task`) |
|---|---|---|---|
| **Problem Scope** | Known signatures, fixed regex, predictable thresholds (e.g. `df > 85%`, `systemctl restart nginx`). | Deterministic filter handles 99.9% of normal checks; escalates to AI only on unknown anomalies. | Unknown root causes, multi-service outage cascades, forensic investigation, code/config drift. |
| **Logic Type** | Rigid, static branching (`if/else`). Breaks on unexpected log formats or cascading dependencies. | Fast deterministic filtering with intelligent adaptive fallback. | Goal-driven reasoning loop (`observe → formulate hypothesis → test with tools → verify → remediate`). |
| **Token Cost** | $0 (0 LLM tokens, microseconds). | Near $0 on healthy runs; tokens spent only when anomalies occur. | Token usage proportional to diagnostic complexity and tool execution steps. |
| **Execution Ownership** | **Script / OS Crontab / systemd**. | **Fast Script/Processor filters**; **AI Agent steps in on anomaly**. | **AI Agent** controls tool selection, diagnosis, and remediation. |

---

### 1.2. The Three Operational Paradigms

Forge supports three distinct operational models depending on cost, frequency, and cognitive complexity:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              FORGE OPERATIONAL EXECUTION PARADIGMS                          │
├────────────────────────────────┬────────────────────────────┬───────────────────────────────┤
│ 1. Cognitive Reasoning Agent   │ 2. AI as Script Author     │ 3. Hybrid Filter + Escalation │
│ (Dynamic Root-Cause Analysis)  │ (Generate & Install Script)│ (Zero-Token Polling Fast-Path)│
├────────────────────────────────┼────────────────────────────┼───────────────────────────────┤
│ • Cross-service crash analysis │ • User prompts Forge once  │ • Fast local script/processor │
│ • Diagnosing unknown stacktraces│ • AI inspects host env     │   checks line offsets & regex │
│ • Git bisect & code regression │ • AI writes robust script  │ • If healthy (99%): exit in   │
│ • Forensic security timeline   │ • AI configures systemd    │   10ms with 0 tokens          │
│ • Multi-step safe remediation  │ • Zero recurring LLM cost  │ • If anomaly: summon AI Agent │
└────────────────────────────────┴────────────────────────────┴───────────────────────────────┘
```

#### Paradigm 1: Cognitive Reasoning Agent (`mode: agent`)
* **When to use**: High-complexity diagnostic tasks where a static script cannot know what to inspect in advance.
* **Examples**: 
  - Correlating reverse proxy HTTP 502s with upstream Go worker pool lock contention and PostgreSQL unindexed query spikes.
  - Analyzing Linux kernel OOM killer events and adjusting JVM heap parameters safely.
  - Investigating anomalous SSH brute-force attempts, correlating with open listening sockets and crontabs, and constructing an attacker timeline.

#### Paradigm 2: AI as Script Author (`forge run "Write a hardened script..."`)
* **When to use**: You want high-quality automation for recurring checks without paying recurring token costs.
* **Workflow**:
  1. Tell Forge: `"Inspect my system, write a hardened Python/Bash script with file locking and log rotation to monitor postgres health, test it with dry-run, and install a systemd service + timer."`
  2. Forge explores the host, tests commands, writes the script, checks syntax, and configures the native Linux scheduler.
  3. All future executions run 100% natively in sub-milliseconds with zero API costs.

#### Paradigm 3: Hybrid Deterministic Pre-Filtering + AI Escalation
* **When to use**: High-frequency monitoring (e.g. every 15s or 30s) where 99.9% of cycles have no errors.
* **Workflow**:
  1. Deterministic Pre-LLM Processors (e.g. `LogReaderProcessor`, `LogDeduplicatorProcessor`, `SystemHealthProcessor`) read byte offsets and SHA-256 hashes in SQLite.
  2. If no anomalies exist, the task completes in 5ms with **0 input/output tokens**.
  3. If an anomaly threshold is breached or an unknown error pattern emerges, the AI Agent is activated with the exact contextual window to troubleshoot and remediate.

---

### 1.3. Checkpoints & Historical Context Across Task Runs

When an AI Agent is invoked repeatedly on a schedule, it requires **temporal awareness** to avoid repeating failed attempts, track trends over time, and evaluate whether previous remediations held.

Forge implements stateful continuity using SQLite:

1. **Incremental Checkpoints (`task_checkpoints`)**:
   - Stores `(task_id, checkpoint_key, byte_offset, line_offset, inode, last_hash)`.
   - Ensures the agent never re-reads already processed log bytes and automatically detects file rotation or truncation.

2. **Historical Run Context (`task_runs` & `task_step_logs`)**:
   - Before each run, `TaskRuntime` retrieves the last 3 runs from SQLite.
   - Injects previous statuses, error messages, and execution summaries into the agent's prompt:
     ```markdown
     ## Historical Execution Context (Previous Runs)
     - Run 8f1b2c34 (2026-08-27 22:45:00 UTC): Status=FAILED
       Summary: Detected high disk pressure on /var. Attempted journalctl vacuum.
       Error: Command timed out.
     - Run 7a4d9e12 (2026-08-27 22:40:00 UTC): Status=SUCCEEDED
       Summary: Disk utilization was 74%. All health checks passed.
     ```
   - **Benefit**: The agent recognizes that its previous vacuum attempt failed, preventing duplicate failing loops and guiding it toward alternative remediations (e.g., checking Docker container overlay storage).

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
| `ai-wizard [goal]` | Interactive AI Task Architect to design & configure tasks | `forge task ai-wizard "Monitor PostgreSQL"` |
| `refine <task>` | Evolve & refine an existing task configuration with AI | `forge task refine nginx-monitor` |
| `wizard` | Launch interactive guided task creation wizard | `forge task wizard` |
| `template [list|show]` | Browse & inspect curated production templates | `forge task template list` |
| `sudoers [show|install|check]` | Configure & audit non-interactive sudoers rules | `forge task sudoers show` |
| `audit <task|run-id>` | View forensic execution trace & tool step logs | `forge task audit nginx-monitor` |
| `audit show <run-id>` | Deep dive into specific run tool calls & output | `forge task audit show 98c06897` |
| `audit export <task>` | Export compliance audit report (MD / JSON / JSONL) | `forge task audit export nginx-mon --format md` |
| `explain <schedule>` | Natural language schedule explainer & timeline | `forge task explain "*/15 * * * *"` |
| `test <task|goal>` | Safe dry-run task simulation | `forge task test nginx-monitor` |
| `create "<goal>" [options]` | Create a new scheduled or one-time task | `forge task create --name mem-check --every 5m "Check RAM"` |
| `create --template <name>` | Create task from curated template | `forge task create --template nginx-error-monitor` |
| `create --sudo` / `--elevated` | Create task requiring elevated privileges | `forge task create --sudo --name sec-log "Audit auth.log"` |
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
| `doctor` | Diagnose privileges, daemon, and stale leases | `forge task doctor` |
| `cleanup` | Remove completed runs older than N days | `forge task cleanup --days 14` |
| `daemon` | Run task scheduler in foreground | `forge task daemon` |
| `service <action>` | Manage systemd service (install, start, stop, status) | `forge task service install` |

### Interactive Task Management in Forge TUI (`/task`)

You can manage, inspect, and trigger tasks directly inside the Forge interactive TUI session using the `/task` (or `/tasks`) command:

* **Interactive Task Manager**: Type `/task` (without arguments) to open the full interactive Task Selector UI:
  - **Fuzzy Search**: Filter tasks dynamically by name, goal, profile, or schedule.
  - **Run Now (`Enter` / `r`)**: Trigger immediate manual execution with live status and duration feedback.
  - **Pause / Resume (`Space` / `p`)**: Toggle task schedule enabled/disabled state instantly.
  - **Template Browser (`t`)**: Browse curated production templates and instantiate new persistent tasks directly from the TUI.
  - **Run History (`h`)**: View execution history, token consumption, and result summaries for the selected task.
  - **Tool Step Logs (`l`)**: View forensic tool execution traces and error logs.
  - **Delete Task (`d`)**: Safely delete a task with confirmation.
  - **Close (`Esc` / `q`)**: Return back to the chat prompt.

* **Slash Subcommands with Autocomplete**: Execute any task subcommand directly from the input prompt:
  ```bash
  /task list                          # List all persistent tasks and schedules in chat
  /task status <task-name>            # View live status, active lease, and recent runs
  /task show <task-name>              # Show full task configuration and notification hooks
  /task runs <task-name>              # Inspect execution history table
  /task logs <task-name>              # Inspect tool step logs and audit events
  /task run <task-name>               # Execute task manually and display output
  /task pause <task-name>             # Pause scheduled executions
  /task resume <task-name>            # Resume scheduled executions
  /task doctor                        # Run system, scheduler, and privileges health check
  /task explain "*/15 * * * *"        # Natural language cron schedule explainer
  /task test <task-name>              # Run safe dry-run task simulation
  /task audit <task-name>             # View forensic audit log
  /task template list                 # List all curated templates
  ```
  *(Press `Tab` while typing `/task ` to autocomplete subcommands, task names, and templates).*

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

### Forensic Auditing & Step Execution Traces (`forge task audit`)

Forge records an immutable, granular audit trail of every task, run, and step:
* **Host & Execution Context**: Hostname, username, UID, privilege level (`elevated`), working directory, and AI model used.
* **Step-by-Step Tool Trace**: Every tool called (`bash`, `read`, `write`, `edit`), exact arguments/commands, duration in ms, and full stdout/stderr output.
* **Compliance & Post-Mortem Export**: Export full audit trails into Markdown incident reports, JSON, or JSONL for compliance and ticketing systems.

```bash
# 1. View task execution overview and latest run step trace
forge task audit nginx-error-monitor

# 2. Deep-dive into a specific execution run
forge task audit show 98c06897-6a4a-42c2-8418-874e0d7c181b

# 3. Export full compliance report in Markdown
forge task audit export nginx-error-monitor --format md --out incident-report.md

# 4. Export structured JSON for SIEM / external log pipelines
forge task audit export nginx-error-monitor --format json > audit.json
```

---

### AI Task Architect (`forge task ai-wizard` / `forge task ai` / `forge task create --ai`)

Forge includes a genuinely AI-driven **Task Architect** session where the LLM dynamically evaluates missing information, requests safe progressive host inspection, asks structured operational questions, recommends optimal execution strategies (Deterministic Script, Autonomous AI Agent, or Hybrid), and configures schedulers, policies, and notifications.

```bash
# Launch AI Task Architect
forge task ai-wizard

# Launch AI Task Architect with initial goal
forge task ai-wizard "Keep PostgreSQL healthy and alert me on failures"

# Aliases
forge task ai "Monitor disk usage and alert when /var exceeds 90%"
forge task create --ai "Inspect nginx 502 error spikes"
forge task wizard --ai "Audit ssh security and open ports"
```

**Architect Features & Workflow:**
1. **Goal Formulation**: Specify the high-level operational objective.
2. **Progressive Host Discovery**: The AI evaluates the host context and requests safe, non-destructive discovery checks (`service`, `port`, `log`, `disk`, `process`, `command`).
3. **Dynamic Structured Questioning**: The LLM asks only the minimal questions necessary to eliminate ambiguity and choose remediation rules.
4. **Execution Strategy Selection**:
   - `Deterministic Script`: Fixed thresholds and rules, zero recurring AI token cost.
   - `AI Agent`: Root cause diagnosis and adaptive multi-step troubleshooting.
   - `Hybrid`: High-frequency local probe + AI escalation on anomalies.
5. **Scheduler Recommendation**: Automatically selects `forge_sqlite`, `systemd_timer`, `native_cron`, or `manual`.
6. **Mandatory User Review**: Presents a complete architecture preview with rationale before task materialization.
7. **Materialization & Fast-Path Bundle**: Saves task to SQLite store, creates standalone bundle in `~/.forge/agent/tasks/<name>/` (`script.sh`, `manifest.json`, `verification.sh`, `README.md`), or exports to declarative YAML.

---

### Task Refinement & Evolution (`forge task refine <task>` / `forge task ai-edit <task>`)

Operators can refine existing tasks through a conversational AI session that loads the current configuration, recent run history, and architecture metadata:

```bash
# Evolve an existing task
forge task refine nginx-monitor

# Alias
forge task ai-edit db-vacuum
```

The AI Task Architect interprets requests like *"change the schedule from 1m to 5m"*, *"require human approval before restarting services"*, or *"tune the fast-path anomaly threshold"*, presents a preview diff, and atomically updates the task in the database and script bundle.

---

### Interactive Task Wizard (`forge task wizard` / `forge task create -i`)

Forge also includes a classic guided wizard for manual step-by-step configuration:

```bash
# Launch interactive wizard
forge task wizard

# Launch wizard with an initial goal
forge task wizard "Monitor disk usage and alert when full"

# Launch wizard with smart heuristic follow-up questions
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
| `--sudo, --elevated` | Flag task as requiring elevated root/sudo privileges | `false` |
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

### How-To 2: Cascading Multi-Service Incident Diagnosis & Root-Cause Triage (Cognitive Reasoning)

When a customer outage occurs, a static script cannot deduce why reverse proxy 502s are occurring across distributed components. The AI Agent acts as an on-call SRE: formulating hypotheses, inspecting logs, tracing network sockets, analyzing database locks, and synthesizing root-cause post-mortems.

#### Command:
```bash
forge run --profile sre "An outage was reported: Nginx is returning HTTP 502 Bad Gateway. \
  1. Inspect /var/log/nginx/error.log to identify failing upstream socket addresses. \
  2. Check status and journalctl logs of upstream backend services (e.g. api-server, node, go). \
  3. If backends are hung, inspect process socket queues using 'ss -s' and 'lsof' to check for connection exhaustion. \
  4. Query PostgreSQL pg_stat_activity to check for long-running unindexed locks or connection pool saturation. \
  5. Formulate a root cause hypothesis, verify service restoration, and synthesize a chronological incident post-mortem."
```

---

### How-To 3: AI as Script Author — Generate, Test & Install Zero-Token Automation

Instead of paying recurring LLM tokens on high-frequency cron jobs, let the AI Agent inspect your machine once, write a hardened native Bash/Python script with lockfiles and log rotation, test it, and install a native systemd timer.

#### Command:
```bash
forge run --profile devops "Inspect the local system environment and create a production-grade automated monitoring script: \
  1. Detect all active log files under /var/log/nginx and /var/log/apps. \
  2. Write a hardened, POSIX-compliant Bash script at /usr/local/bin/fast-log-watchdog.sh that uses lockfiles (flock), \
     traps for SIGINT/SIGTERM, performs zero-overhead bounded tailing with inode-rotation detection, and writes alerts to /var/log/watchdog-alerts.log. \
  3. Validate syntax using 'bash -n' and perform a safe dry-run test execution. \
  4. Generate and install a systemd user service and timer unit at ~/.config/systemd/user/log-watchdog.timer scheduled to run every 1 minute. \
  5. Enable and start the timer using systemctl --user."
```

> [!TIP]
> **Zero Recurring Cost**: Once Forge completes this one-shot task, your scheduled monitoring runs in microseconds with zero token costs and zero external API dependencies.

---

### How-To 4: Forensic Security Intrusion & Anomaly Timeline Construction

Investigate anomalous authentication spikes, audit open sockets, scan persistence vectors, and construct a forensic incident report.

#### Command:
```bash
forge run --profile security --timeout 300 "Conduct an emergency security audit: \
  1. Parse /var/log/auth.log for failed SSH password bursts, invalid users, and root escalation attempts. \
  2. Cross-reference source IP addresses against active listening sockets using 'ss -tulpn'. \
  3. Inspect cron persistence vectors: /etc/cron*, /var/spool/cron/crontabs, and systemd timers. \
  4. Check for anomalous world-writable executables in /tmp and /dev/shm. \
  5. Compile a chronological security incident timeline detailing source IPs, attempted usernames, and hardening recommendations."
```

---

### How-To 5: Stateful Memory Trend Diagnosis & Leak Detection Across Runs

Scheduled tasks in Forge automatically leverage historical SQLite context (`task_runs`) to compare current process metrics against previous runs, identifying slow memory degradation before the Linux OOM killer triggers.

#### Command:
```bash
forge task create \
  --name memory-trend-watchdog \
  --profile sre \
  --every 10m \
  --timeout 120 \
  --policy autonomous \
  --tools read,grep,bash,send_notification \
  --notify-email "sre-oncall@example.com" \
  "Inspect top 5 processes by resident set size (RSS). \
   Compare current memory consumption against previous run history in SQLite context. \
   If any service exhibits continuous RSS growth over the last 3 consecutive runs exceeding 15% delta, \
   capture thread counts from /proc/<pid>/status, take a thread dump or diagnostic snapshot, \
   and notify the on-call engineer before OOM threshold is reached."
```

---

### How-To 6: Automated Git Bisect & Regression Debugging

When a build or test suite breaks unexpectedly in staging, Forge navigates the git history, executes bisect iterations, locates the breaking commit diff, and generates a hotfix patch.

#### Command:
```bash
forge run --profile software-engineer "A regression was detected in the test suite: \
  1. Run the test suite to confirm the failing test case. \
  2. Initiate 'git bisect' between HEAD and origin/main to find the culprit commit. \
  3. Analyze the offending commit diff and explain the exact logical bug introduced. \
  4. Draft and apply a surgical code fix, rerun the tests to verify 100% pass rate, and output the git diff patch."
```

---

### How-To 7: Automated Nightly Database Backup with Integrity Verification

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

### How-To 8: Instant Instantiation from Curated Templates

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

### How-To 9: Explaining & Visualizing Execution Timelines

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

### How-To 10: Safe Dry-Run Testing & Verifying Tasks Before Enabling

Always test newly defined tasks in safe mode (`PolicyMode.SAFE`) before scheduling them in production to verify tool invocations, token costs, and exit criteria without modifying system state.

#### Examples:
```bash
# Test an existing configured task
forge task test memory-trend-watchdog

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

### How-To 11: Declarative GitOps Workflow with YAML Configuration

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

### How-To 12: Daemon Operation & Systemd User Service Automation

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

### How-To 13: Task Maintenance, Health Diagnostics & Lease Recovery

If a task process was abruptly terminated (e.g. unexpected server reboot or kernel panic), use `doctor` to audit and release stale leases:

```bash
# Audit SQLite store for orphaned leases or stalled executions
forge task doctor

# Manually trigger a task on-demand
forge task run memory-trend-watchdog

# View recent execution run history
forge task runs memory-trend-watchdog

# View detailed audit logs for a task
forge task logs memory-trend-watchdog

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

## 10. Root & Sudo Privileges Architecture (`forge task sudoers`)

Linux Systems Engineering, DevOps, and SRE tasks frequently require elevated permissions:
* **Audit & Secure Logs**: Reading `/var/log/audit/audit.log`, `/var/log/secure`, `/var/log/messages`, and system journalctl.
* **Service Management**: `systemctl restart`, `systemctl reload`, `docker restart`, `systemctl is-active`.
* **Network & Sockets**: Inspecting all socket PIDs with `ss -tulpn` or `lsof -i`.
* **Package & Maintenance**: Trimming rotated logs, vacuuming tables, clearing cache mountpoints.

Forge provides two production architectures for executing elevated tasks safely:

### Mode 1: Root System Service (Recommended for Dedicated SRE & Jump Box Nodes)
When running as `root` (`UID 0`) or installed via `sudo forge task service install`:
* Forge installs to `/etc/systemd/system/forge-taskd.service` (`WantedBy=multi-user.target`).
* Commands execute with native root capabilities.
* **Safety is guaranteed**: Even under root, Forge's Policy Engine strictly blocks destructive commands (`rm -rf /`, `reboot`, `shutdown`, `mkfs`, `kill -9 1`, `iptables -F`).

### Mode 2: Granular Sudoers (Recommended for Least-Privilege Environments)
When running under an unprivileged user (e.g. `kvmadmin` or `ubuntu`), background tasks cannot prompt for a password interactively.

Forge provides a built-in helper to audit, preview, and generate clean `/etc/sudoers.d/forge` rules:

```bash
# 1. Audit current privilege status
forge task sudoers check

# 2. Preview recommended granular sudoers file
forge task sudoers show

# 3. Preview full sudoers configuration
forge task sudoers show --full

# 4. Install /etc/sudoers.d/forge with visudo syntax validation
sudo forge task sudoers install
```

#### Example Granular `/etc/sudoers.d/forge` Rules:
```sudoers
# /etc/sudoers.d/forge - Granular sysadmin sudo privileges for Forge Autonomous Agent
kvmadmin ALL=(ALL) NOPASSWD: \
    /usr/bin/systemctl status *, \
    /usr/bin/systemctl restart *, \
    /usr/bin/systemctl reload *, \
    /usr/bin/systemctl start *, \
    /usr/bin/systemctl stop *, \
    /usr/bin/systemctl is-active *, \
    /usr/bin/journalctl *, \
    /usr/sbin/ss *, \
    /usr/bin/docker *, \
    /usr/bin/podman *, \
    /usr/bin/lsof *, \
    /usr/bin/df *, \
    /usr/bin/free *, \
    /usr/bin/dmesg *, \
    /usr/bin/cat /var/log/*, \
    /usr/bin/tail /var/log/*, \
    /usr/sbin/nginx -t, \
    /usr/sbin/sshd -t
```

### Non-Interactive Sudo Guardrail
Forge agent commands automatically execute with `sudo -n <cmd>`. If a command requires a password, it immediately fails fast with actionable diagnostics rather than hanging on background standard input.

---

## 11. Automated Verification Engine

Every modifying operational action triggers independent automated verification:

| Action | Automated Verification Check | Success Condition |
|---|---|---|
| Nginx Config Edit | `nginx -t` | Syntax is OK and test is successful |
| SSH Config Edit | `sshd -t` | No fatal syntax errors |
| Service Restart | `systemctl is-active <service>` | Service state is `active` |
| Web Service Change | `curl -f http://localhost:<port>/health` | HTTP 200 response |

The agent is blocked from reporting success if verification fails.

---

## 12. Model Context Protocol (MCP) Integration

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

## 13. systemd Background Daemon (`forge-taskd`)

Forge operates unattended in the background as a systemd system service (when root) or user service (when non-root).

### Managing the Service

```bash
# 1. Install service unit (auto-detects root vs user mode)
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

---

## 14. Notifications (Email & Webhook)

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

## 15. Model Providers & Custom OpenAI-Compatible Endpoints

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

## 16. Operational Skills Reference

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
