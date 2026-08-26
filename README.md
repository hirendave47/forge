# Forge — Autonomous AI Agent Framework for Linux

Forge is a lightweight, ultra-fast, and modular general-purpose autonomous AI Agent CLI for Linux, Systems Engineering, DevOps, SRE, and automation.

Author & Maintainer: **[Hiren Dave](https://github.com/hirendave47)**

* **[@earendil-works/forge-linux-agent](packages/linux-agent)**: Linux autonomous task platform, scheduler daemon, and deterministic processors
* **[@earendil-works/forge-coding-agent](packages/coding-agent)**: Interactive & headless autonomous agent CLI (`forge`)
* **[@earendil-works/forge-agent-core](packages/agent)**: Agent runtime with tool calling, goal decomposition, and state management
* **[@earendil-works/forge-ai](packages/ai)**: Unified multi-provider LLM API (30+ providers: Anthropic, OpenAI, Google, DeepSeek, Bedrock, Ollama, etc.)

---

## All Packages

| Package | Description |
|---|---|
| **[@earendil-works/forge-linux-agent](packages/linux-agent)** | Linux autonomous agent platform, scheduler daemon, state store, and processors |
| **[@earendil-works/forge-coding-agent](packages/coding-agent)** | Autonomous AI agent CLI and operational loop (`forge`) |
| **[@earendil-works/forge-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/forge-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/forge-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@earendil-works/forge-telemetry](packages/telemetry)** | Telemetry contracts, reference adapter, and schemas |
| **[@earendil-works/forge-protocol](packages/protocol)** | Binary & RPC protocol definitions |
| **[@earendil-works/forge-client](packages/client)** | RPC client library |
| **[@earendil-works/forge-server](packages/server)** | RPC server daemon |
| **[@earendil-works/forge-session-backend-sqlite-node](packages/session-backends/sqlite-node)** | SQLite session storage backend |
| **[@earendil-works/forge-evals](packages/evals)** | Evaluation harnesses and judge suites |

---

## Quick Start & Usage

```bash
# 1. One-Shot Autonomous Execution
forge run "Investigate system memory usage and top 5 processes"
forge run --profile sysadmin "Why is nginx returning HTTP 502?"

# 2. Persistent Scheduled Tasks
forge task create --name nginx-monitor --every 30s --profile sysadmin "Monitor nginx error log"
forge task list
forge task status nginx-monitor
forge task runs nginx-monitor
forge task service install && forge task service start

# 3. Interactive TUI
forge
```

See **[CLI_USAGE.md](CLI_USAGE.md)** for full documentation.

---

## Building Standalone Linux Executable

To compile a 100% self-contained binary targeting `GNU/Linux 3.2.0+` using Docker and Bun and automatically install it to `/usr/local/bin/forge`:

```bash
./build-and-install.sh
# or
npm run install:local
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for architectural rules and operational patterns.

---

## Disclosure & Attribution

This repository was cloned from the original [`earendil-works/pi`](https://github.com/earendil-works/pi) repository and customized for specific autonomous Linux systems engineering, DevOps, SRE, and operational automation purposes.

---

## License

[MIT](LICENSE) © 2025-2026 [Hiren Dave](https://github.com/hirendave47) (originally derived from [earendil-works/pi](https://github.com/earendil-works/pi))

