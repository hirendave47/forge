# AGENTS Instructions & Architectural Guide for Forge CLI

Forge is a lightweight, ultra-fast, and modular general-purpose autonomous AI Agent CLI for Linux, Systems Engineering, DevOps, SRE, and automation.

---

## 1. Core Philosophy & Agent Intentions

### General-Purpose Autonomous Agent
* **Role-Agnostic Philosophy**: Forge is not limited to software development or coding tasks. It is an autonomous general-purpose Linux operational agent capable of system diagnostics, log monitoring, service management, file processing, and workflow automation.
* **Goal-Driven Execution**: Given any instruction (from complex requests to simple one-liners), Forge must keep working independently until the specified Goal and Exit Criteria are satisfied.
* **Task Decomposition**: The agent formulates:
  1. **Purpose**: High-level objective.
  2. **Operational Plan**: Concrete sequential actions.
  3. **Success Criteria (Goal)**: Verifiable conditions indicating completion.

---

## 2. Operational Patterns & Built-in Tool Architecture

### A. Intelligent Log Processing
* **Chunked Ingestion**: Never read thousands of log lines at once. Use bounded chunk commands (`tail -n +N`, `grep -n`, `journalctl --since`) tracking line offsets.
* **Deduplication**: Filter repeated identical log lines to conserve LLM context.
* **Contextual Windowing**: For critical error or warning lines, capture 3–5 lines of surrounding context before and after the event for root cause analysis.

### B. Interval Waiting (`wait_interval`)
* **File**: `packages/coding-agent/src/core/tools/wait-interval.ts`
* **Rule**: Never run busy loops in shell commands. Use `wait_interval(seconds, reason)` for polling service health, waiting for log accumulation, or monitoring background jobs.

### C. Email & Webhook Notifications (`send_notification`)
* **File**: `packages/coding-agent/src/core/tools/notify.ts`
* **Rule**: Dispatch milestone updates, periodic monitoring digests, and final reports via email (default: `localhost:25` Postfix SMTP, from `noreply@example.com` to `hirendave@exapmle.com`) or configured webhooks.

### D. Production Safety Guardrails
* **File**: `packages/coding-agent/src/core/tools/bash.ts`
* **Rule**: All shell commands are intercepted before execution. The following destructive operations are strictly blocked:
  - System reboot / shutdown (`reboot`, `poweroff`, `shutdown`, `halt`, `init 0/6`, `systemctl reboot`)
  - Killing init / PID 1 (`kill -9 1`, `kill 1`, `killall init/systemd`)
  - Disk / partition formatting (`mkfs`, `wipefs`, `fdisk`, `parted`, `dd of=/dev/sd*`)
  - Root destruction (`rm -rf /`, `rm -rf ~`)
  - Network disconnection (`iptables -F`, `ufw disable`, `ip link set ... down`)

---

## 3. Codebase Structure

```
forge/
├── packages/
│   ├── coding-agent/          # CLI entry point, session loop, and core tools
│   │   └── src/
│   │       ├── cli/            # Argument parsing (args.ts) and CLI help
│   │       ├── core/
│   │       │   ├── agent-session.ts    # Main autonomous session loop
│   │       │   ├── system-prompt.ts    # General-purpose system prompt builder
│   │       │   ├── bash-executor.ts    # Bash process spawning & monitoring
│   │       │   └── tools/              # Built-in agent tools
│   │       │       ├── bash.ts         # Shell execution with safety interceptor
│   │       │       ├── wait-interval.ts# Non-blocking async interval sleep
│   │       │       ├── notify.ts       # Postfix SMTP and webhook dispatcher
│   │       │       ├── read.ts         # File reading & line chunking
│   │       │       ├── write.ts        # File creation & overwrite
│   │       │       ├── edit.ts         # Exact search/replace editor
│   │       │       ├── grep.ts         # Regex file search
│   │       │       └── index.ts        # Tool registry & definitions
│   │       └── main.ts         # Application entry point
│   ├── ai/                     # Unified LLM provider client (30+ providers)
│   ├── tui/                    # Terminal UI with differential rendering
│   └── agent/                  # Core agent abstractions and message types
├── scripts/
│   └── build-binaries.sh       # Standalone Bun binary compilation script
└── CLI_USAGE.md                # Comprehensive CLI user guide
```

---

## 4. Development Loop & Commands

### Setup & Hydration
```bash
# 1. Install dependencies
npm install --ignore-scripts

# 2. Hydrate model catalog data (offline snapshot)
npm run hydrate:model-data
```

### Zero-Build Development Execution (Direct from Source)
No build or bundling step is needed when developing. `tsx` executes TypeScript source directly using root `tsconfig.json` path mappings:
```bash
# Run one-shot tasks directly from source
./forge-test.sh run "Investigate system memory usage and top 5 processes"

# Run persistent task subcommands directly from source
./forge-test.sh task list

# Run print mode or interactive TUI
./forge-test.sh -p "Say hello"
./forge-test.sh

# Alternatively using npm script
npm run dev -- run "Investigate system memory usage and top 5 processes"
```

### Static Check & Testing
```bash
# Code formatting and TypeScript typechecking
npm run check

# Run test suite
./test.sh
```

### Optional Offline Build & Packaging
```bash
# Offline build of all workspace packages (when needed for bundling/releases)
npm run build:offline
```

### Packaging Standalone Linux Binary & Local Installation
To compile a 100% self-contained binary targeting `GNU/Linux 3.2.0+` using Docker and Bun and automatically install it to `/usr/local/bin/forge`:
```bash
./build-and-install.sh
# or
npm run install:local
```

Or manually package with Docker:
```bash
docker run --rm --network host --entrypoint /bin/bash -v "$PWD":/src -w /src oven/bun /src/scripts/build-binaries.sh \
  --skip-install --skip-deps --skip-build --offline-model-data --platform linux-x64 --out /src/out
```
Output artifacts:
- Binary: `out/linux-x64/forge`
- Tarball: `out/forge-linux-x64.tar.gz`

---

## 5. Rules for Future Customizations

1. **Tool Creation Protocol**:
   - Define schemas using `Type` from `typebox`.
   - Tool `execute` methods must return `{ content: [...], details: undefined, isError?: boolean }`.
   - Wrap tool definitions with `wrapToolDefinition()` for agent compatibility.
   - Register new tools in `packages/coding-agent/src/core/tools/index.ts` and add descriptions to `packages/coding-agent/src/cli/args.ts`.
2. **System Prompt Parity**:
   - Maintain the goal-oriented autonomous guidelines in `packages/coding-agent/src/core/system-prompt.ts`.
   - Never regress into purely coding-assistant prompts; keep the general-purpose Linux agent framing intact.
3. **No Inline Imports**:
   - Use top-level imports only. Avoid dynamic `import()` or `import("pkg").Type`.
4. **Code Quality**:
   - Erasable TypeScript syntax only (no `enum`, no `namespace`).
   - Run `npm run check` after all edits and ensure zero errors or warnings before committing.

