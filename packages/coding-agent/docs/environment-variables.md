# Environment Variables

Forge uses environment variables in three ways:

- Variables such as `FORGE_OFFLINE` configure the Forge process.
- Forge sets process markers so child processes can identify Forge as the launching agent.
- Commands run by the LLM-callable shell tools receive `FORGE_*` variables describing the current session.

Provider API-key variables are documented separately in [Providers](providers.md#environment-variables-or-auth-file).

## Process Marker

The CLI and RPC entry points set two process markers:

- `AI_AGENT=forge` is a generic marker that lets tooling identify Forge as the agent that launched the process.
- `FORGE_CODING_AGENT=true` is Forge-specific and lets child processes detect that they run inside Forge.

Child processes inherit both markers. They are not session-specific and are not set automatically when Forge is embedded through the SDK.

## Shell Tool Session Environment

Commands run by the `bash` and `powershell` tools receive the current Forge session state:

| Variable | Description |
|----------|-------------|
| `FORGE_SESSION_ID` | Current session ID |
| `FORGE_SESSION_FILE` | Absolute path to the current session JSONL file; unset for ephemeral sessions |
| `FORGE_PROVIDER` | Currently selected model provider |
| `FORGE_MODEL` | Currently selected model ID |
| `FORGE_REASONING_LEVEL` | Current effective reasoning level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max` |

The values are resolved when each command starts. Switching models or changing the reasoning level therefore affects the next shell command without restarting Forge. `FORGE_PROVIDER` and `FORGE_MODEL` identify the selected Forge model, not a different upstream model that a router may choose internally.

When asked which model or provider is running, inspect these variables instead of inferring the answer from the system prompt:

```bash
printf '%s/%s\n' "$FORGE_PROVIDER" "$FORGE_MODEL"
printf 'reasoning=%s session=%s\n' "$FORGE_REASONING_LEVEL" "$FORGE_SESSION_ID"
```

The session file can be inspected directly when the session is persistent:

```bash
if [ -n "$FORGE_SESSION_FILE" ]; then
  tail -n 1 "$FORGE_SESSION_FILE"
fi
```

These variables are injected into the LLM-callable `bash` and `powershell` tools. They are not injected into user-entered `!` or `!!` commands.

### Custom Shell Tools

Tools created with `createBashTool()` or `createPowerShellTool()` expose the session environment by default when registered with Forge. Injection happens before `spawnHook`, so a hook receives the variables in `ctx.env`:

```typescript
const bashTool = createBashTool(cwd, {
  spawnHook: (ctx) => ({
    ...ctx,
    env: { ...ctx.env, CI: "1" },
  }),
});
```

Disable session metadata independently of the spawn hook:

```typescript
const powershellTool = createPowerShellTool(cwd, {
  exposeSessionEnvironment: false,
  spawnHook: (ctx) => ctx,
});
```

When disabled, Forge removes inherited values for these variables so nested Forge processes do not expose stale parent-session metadata.

## Forge Process Configuration

These variables are read by Forge itself:

| Variable | Description |
|----------|-------------|
| `FORGE_CODING_AGENT_DIR` | Override the config directory; default is `~/.forge/agent` |
| `FORGE_CODING_AGENT_SESSION_DIR` | Override session storage; overridden by `--session-dir` |
| `FORGE_PACKAGE_DIR` | Override the package directory, useful for Nix/Guix store paths |
| `FORGE_OFFLINE` | Disable startup network operations, including update checks, package updates, and install/update telemetry |
| `FORGE_SKIP_VERSION_CHECK` | Disable the latest-version request |
| `FORGE_TELEMETRY` | Override install/update telemetry and provider attribution headers: `1`/`true`/`yes` or `0`/`false`/`no` |
| `FORGE_CACHE_RETENTION` | Set to `long` for extended provider prompt caching where supported |
| `FORGE_SHARE_VIEWER_URL` | Override the base URL used by `/share` |
| `FORGE_HARDWARE_CURSOR` | Set to `1` to show the hardware cursor; see [Terminal setup](terminal-setup.md) |
| `FORGE_TUI_ESC_TIMEOUT` | How long to wait after a lone ESC before treating it as Escape, in milliseconds; defaults to `100` over SSH and `10` otherwise. Increase if Alt-key input is misread as Escape |
| `VISUAL`, `EDITOR` | External editor fallback when `externalEditor` is unset |
| `HTTP_PROXY`, `HTTPS_PROXY` | Proxy outbound HTTP requests |

Provider credentials such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and cloud-provider configuration are listed in [Providers](providers.md#environment-variables-or-auth-file).
