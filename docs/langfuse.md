# Langfuse Tracing (OpenCode provider)

NanoClaw can send full LLM traces to [Langfuse](https://langfuse.com) for any agent group running the `opencode` provider. Every inference is recorded with its input context, the model's reasoning, its outputs in order, and any tool calls it made — an audit log of the agent's cognitive work.

## How it works

Tracing uses the official [Langfuse OpenCode observability plugin](https://github.com/langfuse/opencode-observability-plugin) rather than any custom instrumentation in NanoClaw:

1. The host reads `LANGFUSE_*` from `.env` and injects them into opencode containers at spawn (`src/providers/opencode.ts`, same passthrough path as `OPENCODE_*`). If the key pair is absent, nothing is injected and tracing is entirely off.
2. Inside the container, the agent-runner sees the keys and adds two things to the OpenCode server config (`container/agent-runner/src/providers/opencode.ts`): `experimental.openTelemetry = true` and the plugin, pinned to an exact version (`LANGFUSE_PLUGIN_SPEC`).
3. OpenCode installs the plugin on first run (cached under the per-session `opencode-xdg` mount) and streams session telemetry to it; the plugin converts it to Langfuse traces.

No NanoClaw code is on the tracing hot path — enable/disable is purely env-driven.

## Setup

1. Create a Langfuse project ([cloud](https://cloud.langfuse.com) or self-hosted) and copy the API keys from **Settings → API Keys**.
2. Add to `.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASEURL=https://cloud.langfuse.com   # us.cloud.langfuse.com for US region
LANGFUSE_ENVIRONMENT=production                # optional label, defaults to "development"
```

(`LANGFUSE_BASE_URL` is accepted as an alias for `LANGFUSE_BASEURL`.)

3. Rebuild the container image (the OpenCode CLI version pin matters — see below) and restart the service:

```bash
./container/build.sh
launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
# systemctl --user restart nanoclaw                # Linux
```

Running containers pick up the change on their next respawn; `ncl groups restart --id <group-id>` forces it.

## What you see in Langfuse

- **One trace per turn** — from the prompt batch NanoClaw sends to the final answer. The trace input is the formatted `<message>` XML, so the triggering sender, timestamps, and quoted context are all visible.
- **One generation per model response** within the turn, with model id, token usage (→ cost), reasoning output captured separately, and the text/tool-call output in sequence.
- **Tool spans** nested under the generation that requested them, with inputs, outputs, errors, and timings. Retries, failed steps, and context compaction are surfaced too.
- **Session** — the Langfuse session id is the OpenCode session id.
- **User** — `userId` on every trace is the **agent group name** (override with `LANGFUSE_USER_ID` in `.env`), so traces filter by group in the Users view.

### Mapping a trace back to a NanoClaw session

The OpenCode session id shown in Langfuse is stored per NanoClaw session as the provider continuation. To find which NanoClaw session (messaging thread + agent group pairing) produced a trace:

```bash
pnpm exec tsx scripts/q.ts data/v2-sessions/<agent-group>/<session>/outbound.db \
  "SELECT value FROM session_state WHERE key = 'continuation:opencode'"
```

or grep across sessions for the id shown in Langfuse.

## Scope and caveats

- **OpenCode provider only.** Agent groups on the default `claude` provider are not traced.
- **Traces contain message content** — user chat messages, reasoning, and tool inputs/outputs are sent to your Langfuse project. Point the keys at a project you control, and don't enable tracing for groups handling data you don't want stored there.
- **Version coupling.** The plugin targets OpenCode's 1.15+ plugin API; the container image pins `OPENCODE_VERSION=1.18.3` (with `@opencode-ai/sdk` matched in the agent-runner). If you change one, keep the other in sync and re-check the plugin still loads (`docker logs` will show `[langfuse] OTEL tracing initialized` from the OpenCode server on wake).
- **First run needs npm access** from inside the container (via the OneCLI proxy) to fetch the pinned plugin; afterwards it's cached in the session's `opencode-xdg` mount.
