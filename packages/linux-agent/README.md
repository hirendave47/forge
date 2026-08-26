# @earendil-works/forge-linux-agent

The production-grade Linux Autonomous Agent Platform for Forge.

Provides durable state management, persistent interval/cron scheduling, deterministic pre-LLM processors, lease-based concurrency locking, profile personas, safety policy enforcement, automated verification, MCP integration, crash recovery, and systemd user daemon supervision.

---

## 1. Package Architecture

```text
packages/linux-agent/
├── src/
│   ├── index.ts                      # Public package exports
│   ├── cli/
│   │   ├── run-command.ts            # forge run "<goal>" handler
│   │   ├── task-command.ts           # forge task <subcommand> handler
│   │   └── index.ts
│   ├── store/
│   │   ├── schema.ts                 # SQLite schema (8 tables, WAL mode)
│   │   └── task-store.ts             # CRUD, events, checkpoints, lease manager
│   ├── runtime/
│   │   ├── task-model.ts             # Task/Run domain types, UUID factories, YAML parser
│   │   ├── state-machine.ts          # 14 task states and transition validator
│   │   ├── task-runtime.ts           # Execution pipeline bridging to createAgentSession()
│   │   ├── tool-selector.ts          # Dynamic tool schema filter
│   │   ├── model-router.ts           # fast/default/reasoning/coding tier router
│   │   └── crash-recovery.ts         # Orphaned run & stale lease recovery
│   ├── scheduler/
│   │   ├── cron.ts                   # Standard 5-part UTC cron & interval calculator
│   │   ├── scheduler.ts              # Polling loop, overlap prevention, retries
│   │   └── daemon.ts                 # UNIX signal runner (SIGTERM/SIGINT/SIGHUP)
│   ├── processors/
│   │   ├── types.ts                  # Processor & ProcessorResult interfaces
│   │   ├── log-reader.ts             # Bounded chunk reader & inode rotation detection
│   │   ├── log-deduplicator.ts       # SHA-256 error normalizer & context windowing
│   │   ├── system-health.ts          # Memory, load, top processes, and disk metrics
│   │   └── index.ts
│   ├── profiles/
│   │   └── index.ts                  # sysadmin, devops, sre, software-engineer, security
│   ├── policy/
│   │   └── policy-engine.ts          # safe, supervised, autonomous risk classifier
│   ├── verification/
│   │   └── verification-engine.ts    # Automated checks (nginx -t, is-active, sshd -t)
│   ├── integrations/
│   │   ├── mcp-client.ts             # Stdio JSON-RPC MCP client
│   │   └── mcp-loader.ts             # ~/.forge/agent/mcp.json server loader
│   └── systemd/
│       └── installer.ts              # forge-taskd.service user service installer
└── test/                             # 125 Vitest tests across 9 test suites
```

---

## 2. Programmatic API

### One-Shot Execution

```typescript
import { TaskRuntime } from "@earendil-works/forge-linux-agent";

const runtime = new TaskRuntime({
  cwd: process.cwd(),
  onProgress: (event) => console.log(`[${event.timestamp}] ${event.message}`)
});

const result = await runtime.executeOneShot("Investigate system memory usage", {
  profile: "sysadmin",
  timeoutSeconds: 120
});

console.log(result.resultSummary);
runtime.close();
```

### Persistent Task Scheduling & Execution

```typescript
import { TaskStore, TaskScheduler, TaskRuntime } from "@earendil-works/forge-linux-agent";

const store = new TaskStore("/var/lib/forge/tasks.db");

// Create a task
const task = store.createTask({
  name: "nginx-error-monitor",
  goal: "Monitor /var/log/nginx/error.log and alert on HTTP 500 spikes",
  profile: "sysadmin",
  schedule: { type: "interval", seconds: 30 },
  overlapPolicy: "skip",
  retryPolicy: { maxRetries: 2, delaySeconds: 30, strategy: "exponential" }
});

// Run task scheduler daemon
const scheduler = new TaskScheduler({
  dbPath: "/var/lib/forge/tasks.db",
  pollIntervalMs: 1000
});

await scheduler.start();
```

---

## 3. Database Schema (SQLite in WAL Mode)

The storage layer initializes 8 relational tables with index optimization:

1. **`tasks`**: Task definitions, goals, schedules, profiles, retry policies, and tools allow/deny lists.
2. **`task_runs`**: Individual execution instances with duration, status, exit reasons, input/output tokens, and tool call counts.
3. **`task_locks`**: Active lease locks for concurrency prevention with `expires_at` TTL and heartbeat tracking.
4. **`task_events`**: Immutable chronological audit event trail.
5. **`task_checkpoints`**: Transactional byte/line offsets, inodes, and hashes for file monitoring.
6. **`task_artifacts`**: Artifact files and reports produced during executions.
7. **`task_notifications`**: Dispatched notification records with unique idempotency keys.
8. **`dedup_entries`**: SHA-256 error fingerprints with `first_seen`, `last_seen`, and occurrence counts.

---

## 4. State Machine (14 States)

```text
[CREATED] ──► [ENABLED] ──► [DUE] ──► [ACQUIRING] ──► [RUNNING]
     │             │                                       │
     ▼             ▼                                       ├─► [VERIFYING] ──► [SUCCEEDED]
 [DISABLED]    [PAUSED]                                    │
                                                           ├─► [FAILED] ──► [RETRY_WAIT] ──► [DUE]
                                                           │
                                                           ├─► [TIMED_OUT]
                                                           │
                                                           └─► [CANCELLED]
```

---

## 5. Development & Testing

```bash
# Run all 125 tests
npm test

# Run specific test suites
npx vitest --run test/scheduler.test.ts
npx vitest --run test/concurrency.test.ts
npx vitest --run test/processors.test.ts

# Typecheck and build
npm run build
```

---

## License

[MIT](../../LICENSE) © 2025-2026 [Hiren Dave](https://github.com/hirendave47)
