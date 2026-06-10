# Goose Capabilities Assessment

**Date:** 2026-06-10
**Issue:** [#5](https://github.com/dtanikella/nanoclaw/issues/5)
**Status:** Complete — neutral assessment, no go/no-go recommendation

---

## Executive Summary

Goose is an open-source (Apache 2.0), Rust-based AI agent framework now maintained under the Linux Foundation's Agentic AI Foundation (AAIF). It supports 30+ LLM providers (including local models via Ollama), builds its entire tool system on MCP, and exposes both an HTTP API and an ACP stdio interface for programmatic control. Containerization is viable — Goose ships a `--container` flag and all state paths are overridable via a single env var. Integration with NanoClaw's two-DB session protocol would require an adapter layer to bridge between the session DBs and Goose's HTTP or ACP interface; no fundamental blockers exist, but the adapter is non-trivial.

---

## 1. Goose Architecture Overview

### Identity

Originally built by Block (Square/CashApp parent), open-sourced mid-2024, migrated from Python to Rust late 2024, and transferred to the Linux Foundation's AAIF in April 2026. Repository: [`aaif-goose/goose`](https://github.com/aaif-goose/goose).

### Binaries

| Binary | Purpose |
|--------|---------|
| `goose` | CLI/TUI — interactive sessions, headless runs, ACP server |
| `goosed` | HTTP daemon — REST + SSE API for programmatic control |
| `goose-sdk` | SDK scaffold (uniffi Python/Kotlin bindings — currently a placeholder) |

### Crate Structure

| Crate | Path | Purpose |
|-------|------|---------|
| `goose` | `crates/goose/` | Core: agent loop, providers, session, config, MCP client, ACP |
| `goose-cli` | `crates/goose-cli/` | CLI/TUI binary |
| `goose-server` | `crates/goose-server/` | HTTP daemon binary |
| `goose-providers` | `crates/goose-providers/` | Provider format/conversion layers |
| `goose-mcp` | `crates/goose-mcp/` | Bundled MCP extension toolkits |
| `goose-sdk` | `crates/goose-sdk/` | SDK scaffold |

### Agent Loop

The agent loop lives in `crates/goose/src/agents/agent.rs` (~143KB). The primary method is `Agent::reply()`, returning a `BoxStream<AgentEvent>`:

1. **Pre-turn** — Build message list from session conversation, prepend system prompt, inject tool definitions from all loaded extensions
2. **LLM call** — Stream completion from the configured provider via `Provider::complete()`
3. **Parse response** — Accumulate streamed chunks into `Message` objects via `reply_parts.rs`
4. **Approval gate** — `handle_approval_tool_requests()` checks `PermissionLevel` via `PermissionManager`. For `AskBefore` tools, the loop pauses and yields an `action_required_msg` to the UI
5. **Tool dispatch** — Approved tools dispatched concurrently through `ExtensionManager`. Parallel tool batches supported natively
6. **Observe** — Tool results collected as `ToolResponse` messages, appended to conversation history
7. **Loop exit** — Model produces no tool calls, `max_turns` hit, or `CancellationToken` fires

```rust
pub enum AgentEvent {
    Message(Message),
    HistoryReplaced(Conversation),          // after context compaction
    McpNotification((String, ServerNotification)),
}
```

### Operating Modes

| Mode | Behavior |
|------|----------|
| `Auto` | Approve all tool calls automatically (suitable for headless/CI) |
| `Approve` | Ask before every tool call |
| `SmartApprove` | Ask only for write-annotated tools (uses MCP `read_only_hint`) |
| `Chat` | No tool calls — pure LLM conversation |

### Session Model

Sessions managed by `SessionManager`, persisted as local files under a configurable `state_dir()`. Each session carries: conversation history, working directory, token counts, enabled extensions, recipe parameters.

```rust
pub struct SessionConfig {
    pub id: String,
    pub schedule_id: Option<String>,
    pub max_turns: Option<u32>,
    pub retry_config: Option<RetryConfig>,
}
```

`RetryConfig` adds an automated outer retry loop: after task completion, runs `SuccessCheck::Shell { command }` validators; on failure, optionally runs `on_failure` shell commands, then re-runs up to `max_retries` times.

Sessions are purely local files — no cloud sync, no server-side state.

### Process Lifecycle

- **Startup (CLI):** Parse args → resolve provider from env/config → create `Agent` with `ExtensionManager` → load session → enter interactive or headless loop
- **Startup (Server):** `goosed agent` → bind HTTP server (default `127.0.0.1:3000`, TLS on) → `AgentManager` creates agents on-demand per session
- **Run:** Agent loop processes messages, dispatches tools, streams events
- **Shutdown:** `CancellationToken` triggers graceful stop → session state persisted → extensions disconnected

### Slash Commands (In-Band)

`/compact` (summarize context), `/clear` (wipe history), `/goal <text>` (verification target), `/grind <text>` (force work until max_turns), `/prompts` (MCP prompt access), `/skills` (list skills), `/doctor` (health check)

---

## 2. Extension & Toolkit System

### Core Design: Everything Is MCP

All tools in Goose — including built-ins — are delivered through MCP servers. This is a fundamental architectural difference from Claude Code, where built-in tools are native and only external tools use MCP.

### Extension Types

```rust
pub enum ExtensionConfig {
    Stdio { cmd, args, envs, timeout, ... },          // subprocess, MCP over stdin/stdout
    StreamableHttp { uri, headers, timeout, ... },     // HTTP MCP server
    Builtin { name, available_tools, timeout, ... },   // in-process bundled MCP server
    Platform { name, available_tools, bundled, ... },   // platform-level integration
    Frontend { name, ... },                             // UI-executed (desktop app only)
    Sse { ... },                                        // DEPRECATED
}
```

### Built-in Extensions (`crates/goose-mcp/`)

Bundled as in-process MCP servers spawned over `tokio::io::DuplexStream`:

| Extension | Purpose | Notes |
|-----------|---------|-------|
| `developer` | Shell execution, file ops, code editing | Default ON |
| `computercontroller` | Web scraping, browser automation, PDF/DOCX reading, GUI automation | Auto-disables GUI in headless |
| `memory` | Persistent agent memory/notes | |
| `autovisualiser` | Data visualization | |
| `tutorial` | Interactive onboarding | |
| `peekaboo` | macOS screenshot + accessibility APIs | macOS-only |
| `summon` | Subagent delegation | |
| `todo` | Task tracking | |
| `chat-recall` | Session history search | |
| `code-mode` | Specialized code editing | |
| `extension-manager` | Dynamic extension management | |

### Custom Extension Authoring

**Language:** Any language implementing MCP (JSON-RPC 2.0) — Python, TypeScript, Go, Rust, etc.

**Transport options:**
- `stdio` — Goose spawns subprocess, speaks MCP over stdin/stdout
- `streamable_http` — HTTP server; Goose connects as client
- `builtin` — Rust `rmcp::ServerHandler`, added to `BUILTIN_EXTENSIONS` map

**Registration paths:**
- `goose configure` interactive CLI
- `goosed` HTTP API: `POST /extensions/{session_id}`
- Direct `config.yaml` edit
- Plugin discovery: `~/.agents/plugins/` auto-discovers `.json` manifests

### Security

- Malware scanning before extension activation (`extension_malware_check.rs`)
- Per-tool permissions persisted in `~/.config/goose/permission.yaml`

| Level | Behavior |
|-------|----------|
| `AlwaysAllow` | Auto-approve |
| `AskBefore` | Per-use prompt (auto for write-annotated tools in SmartApprove) |
| `NeverAllow` | Permanently blocked |

Extensions support `available_tools: Vec<String>` for allowlisting specific tools.

---

## 3. Model Flexibility

### Provider Architecture

Providers implement a Rust trait (`Arc<dyn Provider>`) behind `SharedProvider = Arc<Mutex<Option<Arc<dyn Provider>>>>`, enabling runtime swap. Resolution order:

1. `GOOSE_PROVIDER` environment variable
2. `active_provider:` key in `config.yaml`
3. Legacy flat key (backward compat)

Model resolution follows the same pattern with `GOOSE_MODEL`.

### Supported Providers (30+)

| Category | Providers |
|----------|-----------|
| **Tier 1 (direct API)** | Anthropic Claude, OpenAI, Google Gemini, Azure OpenAI |
| **Cloud platforms** | AWS Bedrock, AWS SageMaker TGI, GCP Vertex AI, Databricks, Snowflake Cortex |
| **Local models** | Ollama, LM Studio, Docker Model Runner, local_inference (feature-gated) |
| **Proxies/routers** | OpenRouter, LiteLLM, OpenAI-compatible (generic) |
| **Specialized** | Groq, Mistral, xAI/Grok, HuggingFace Inference, NanoGPT, Kimicode |
| **Agent-to-agent (ACP)** | Claude Code, GitHub Copilot, Cursor, Amp, Pi |

A canonical model catalog (`provider_metadata.json`, 70+ entries) lists API endpoints, required env vars, and model capabilities.

### Provider Lock-in Assessment

**No lock-in.** Switching providers requires only changing env vars or running `goose configure`. However: *"Goose relies heavily on tool calling capabilities and currently works best with Claude 4 models"* — multi-provider support is genuine, but tool-calling quality varies by model.

---

## 4. Programmatic API & Headless Usage

### HTTP Server API (`goosed`)

Starts with `goosed agent`, default `127.0.0.1:3000` with TLS. Auth via `x-secret-key` header.

| Endpoint | Description |
|----------|-------------|
| `POST /reply` | Send message; returns SSE stream of `MessageEvent` |
| `POST /agent` | Create/initialize agent for session |
| `GET /sessions/{id}` | Full session (history + metadata) |
| `PUT /sessions/{id}/name` | Rename session |
| `POST /sessions/{id}/fork` | Fork session (copy + optional truncate) |
| `GET /sessions/{id}/extensions` | List session's loaded extensions |
| `POST /extensions/{id}` | Load extension into session |
| `DELETE /extensions/{id}` | Remove extension |
| `GET/POST /config/*` | Read/write provider and extension config |
| `POST /schedule` | Create scheduled task (cron) |
| `POST /session_events/{id}` | SSE subscription to session events |

**SSE event types:**
```rust
pub enum MessageEvent {
    Message { message, token_state },
    Error { error },
    Finish { reason, token_state },
    Notification { request_id, message },
    UpdateConversation { conversation },
    ActiveRequests { request_ids },
    Ping,
}
```

### Headless CLI

`goose run --text "prompt"` or `goose run -i input.md` — single prompt, then exit.

### ACP (Agent Client Protocol) over stdio

`goose acp` starts a JSON-RPC ACP server over stdin/stdout. External tools can drive Goose programmatically — the "embed Goose in another agent" path.

### Rust Library Embedding

```rust
let agent_manager = AgentManager::instance().await?;
let agent = agent_manager.get_or_create_agent(session_id).await?;
let stream = agent.reply(user_message, session_config, cancel_token).await?;
```

### SDK Status

The `goose-sdk` crate is **a scaffold only** — uniffi Python/Kotlin bindings are a placeholder. The real programmatic interface is the HTTP API or the Rust library.

---

## 5. NanoClaw Compatibility Assessment

### Containerization Feasibility: ✅ Viable

**Goose has explicit container support** via `--container CONTAINER_ID`:

> Run extensions (stdio and built-in) inside the specified container. The extension must exist in the container. For built-in extensions, goose must be installed inside the container.

When set, all stdio extension spawning routes through `docker exec`.

**Running Goose itself in a container:**

- Pure Rust, statically compiled — no interpreter/runtime dependency
- All state paths overridable via `GOOSE_PATH_ROOT=/mnt/data`
- `goosed` server mode works for programmatic control
- `GooseMode::Auto` enables fully unattended operation
- `max_turns` provides a hard stop for runaway loops

**Container env configuration:**
```bash
GOOSE_HOST=0.0.0.0
GOOSE_PORT=3000
GOOSE_TLS=false            # disable for container-internal traffic
GOOSE_SECRET_KEY=secret
GOOSE_PROVIDER=anthropic
GOOSE_MODEL=claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-...
GOOSE_PATH_ROOT=/data
```

**Known limitations:**
1. `computercontroller` GUI automation auto-disables in headless — not a blocker
2. `peekaboo` is macOS-only — unavailable in Linux containers
3. Browser automation needs headless Chromium installed
4. TLS defaults on — must set `GOOSE_TLS=false` for container-internal traffic

### Two-DB Session Protocol Fit: ⚠️ Significant Integration Work

NanoClaw's session protocol uses two SQLite databases as the sole IO surface. The host writes to `inbound.db`; the agent-runner polls it, calls the LLM, writes responses to `outbound.db`. The host polls `outbound.db` for delivery.

**Goose's native session model is fundamentally different:**
- Sessions are local YAML/JSON files, not SQLite
- The agent loop takes user input directly (stdin or HTTP), not via polling
- No concept of an external orchestrator writing messages into a queue

**Integration approaches (easiest to hardest):**

1. **Adapter wrapper (recommended):** A thin process that:
   - Polls `inbound.db` for new messages
   - Translates each into a `POST /reply` call to a local `goosed` instance
   - Streams the SSE response and writes results to `outbound.db`
   - Could be TypeScript/Bun (matching existing agent-runner), Rust, or Python

2. **ACP bridge:** Run `goose acp`, pipe JSON-RPC through a bridge mediating between session DBs and ACP stdin/stdout

3. **Direct Rust embedding:** Import the `goose` crate into a custom binary that natively speaks the two-DB protocol. Highest performance, highest effort.

**Protocol gaps the adapter must bridge:**
- `seq` parity (host = even, container = odd)
- `processing_ack` acknowledgments in `inbound.db`
- Heartbeat file touch at `/workspace/.heartbeat`
- `on_wake` first-poll-only messages
- System actions in `outbound.db` (schedule, approvals, CLI requests) — NanoClaw-specific with no Goose equivalent
- `journal_mode=DELETE` for cross-mount SQLite visibility

---

## 6. Claude (Anthropic Agent SDK) vs Goose Comparison

| Dimension | Claude (Anthropic Agent SDK) | Goose |
|-----------|------------------------------|-------|
| **Source** | Closed-source binary; Python SDK open | Fully open-source (Apache 2.0, Rust) |
| **Governance** | Anthropic | Linux Foundation AAIF |
| **Agent loop** | Black-box with 22+ observable hook events | Explicit Rust code, forkable |
| **Tool system** | Built-in tools + MCP for external | Everything is MCP (including built-ins) |
| **Model support** | Claude-primary; Bedrock/Vertex/Azure only | 30+ providers including local (Ollama, LM Studio) |
| **Session model** | Local `~/.claude` + cloud-managed (Environments API) | Local files only; Nostr-based sharing |
| **Customization** | CLAUDE.md + settings hierarchy + MDM + Hooks + Plugins | `.goosehints` + prompt template override + Recipes + custom distros |
| **MCP depth** | Integration layer; 4 transports; `mcp_servers` server-side param | Foundation of entire extension system; Roots protocol; malware scanning |
| **Permission model** | `allowedTools`/`deniedTools`; `PreToolUse` hooks | Per-tool `AlwaysAllow`/`AskBefore`/`NeverAllow` + `SmartApprove` |
| **Container support** | First-class dev container feature; worktree isolation | `--container` flag; `GOOSE_PATH_ROOT` for state |
| **Headless/CI** | `claude --print`, SDK agent loop | `goose run --text`, `goosed` HTTP API, `GooseMode::Auto` |
| **Programmatic API** | Python SDK; Environments API | HTTP REST+SSE; ACP over stdio; Rust crate |
| **Subagents** | `.claude/agents/` definitions; hooks | `summon` extension; subrecipes |
| **Context mgmt** | `PreCompact`/`PostCompact` hooks; automatic | `/compact` command; conversation truncation |
| **Enterprise** | MDM, registry policies, managed settings | Custom distributions (fork-based) |
| **Community** | ~131K GitHub stars | ~49K GitHub stars |
| **Binary footprint** | Node.js runtime required | Self-contained Rust binary |
| **NanoClaw integration** | Native — current agent-runner uses Claude SDK | Requires adapter layer (see §5) |

---

## 7. Open Questions

1. **ACP protocol stability** — The ACP server (`acp/server.rs`, 146KB) is the most promising embedding path, but the wire format isn't formally documented. Is the protocol stable enough to build against?

2. **Tool-calling quality across providers** — Goose docs state it "works best with Claude 4 models." How degraded is the experience with non-Claude models? Are there tool-calling failures with weaker models?

3. **Extension isolation in containers** — When `--container` is set, extensions run via `docker exec`. How does this interact with NanoClaw's container lifecycle (kill, restart, heartbeat)?

4. **Context window management** — `/compact` summarizes history, but does Goose handle context overflow automatically? Or does it require manual intervention?

5. **`goose-sdk` timeline** — The SDK crate is a placeholder. Is there a roadmap for a stable programmatic API? Would the AAIF accept contributions?

6. **System action mapping** — NanoClaw's `outbound.db` carries system actions (schedule, approvals, CLI). Can Goose extensions emit structured tool results the adapter can translate into these?

7. **Concurrent sessions** — NanoClaw runs one session per container. Can a single `goosed` instance handle multiple concurrent sessions? `AgentManager::get_or_create_agent(session_id)` suggests yes.

8. **Memory footprint** — Goose's Rust binary should be lean, but the 143KB `agent.rs` and 2.9MB model catalog suggest non-trivial runtime state. What's the actual memory consumption under sustained sessions?

9. **Extension hot-loading** — Can extensions be added/removed from a running session via the HTTP API? This would map to NanoClaw's `add_mcp_server` self-mod flow.

10. **Recipe system maturity** — Recipes (parameterized YAML workflows) could map to NanoClaw's scheduled tasks. Can recipes be triggered via the HTTP API?

---

## 8. References

| Source | URL |
|--------|-----|
| Goose GitHub (AAIF) | https://github.com/aaif-goose/goose |
| Goose Documentation | https://goose-docs.ai |
| Goose Provider List | https://goose-docs.ai/docs/getting-started/providers |
| Goose Extensions Guide | https://goose-docs.ai/docs/getting-started/using-extensions |
| Goose Custom Distributions | `aaif-goose/goose:CUSTOM_DISTROS.md` |
| Agent loop — tool execution | `aaif-goose/goose:crates/goose/src/agents/tool_execution.rs` |
| Agent loop — types | `aaif-goose/goose:crates/goose/src/agents/types.rs` |
| Agent struct | `aaif-goose/goose:crates/goose/src/agents/agent.rs` |
| Extension config | `aaif-goose/goose:crates/goose/src/config/extensions.rs` |
| Built-in extensions registry | `aaif-goose/goose:crates/goose-mcp/src/lib.rs` |
| Provider resolution | `aaif-goose/goose:crates/goose/src/config/providers.rs` |
| Provider modules | `aaif-goose/goose:crates/goose/src/providers/mod.rs` |
| GooseMode | `aaif-goose/goose:crates/goose/src/config/goose_mode.rs` |
| Paths & GOOSE_PATH_ROOT | `aaif-goose/goose:crates/goose/src/config/paths.rs` |
| Container support (CLI flag) | `aaif-goose/goose:crates/goose-cli/src/cli.rs` |
| Container extension routing | `aaif-goose/goose:crates/goose/src/agents/extension_manager.rs` |
| HTTP server routes | `aaif-goose/goose:crates/goose-server/src/routes/` |
| Server config | `aaif-goose/goose:crates/goose-server/src/configuration.rs` |
| SSE message events | `aaif-goose/goose:crates/goose-server/src/routes/reply.rs` |
| Headless mode | `aaif-goose/goose:crates/goose-cli/src/session/mod.rs` |
| ACP server | `aaif-goose/goose:crates/goose/src/acp/` |
| SDK scaffold | `aaif-goose/goose:crates/goose-sdk/src/lib.rs` |
| Prompt manager | `aaif-goose/goose:crates/goose/src/agents/prompt_manager.rs` |
| Permission system | `aaif-goose/goose:crates/goose/src/config/permission.rs` |
| Session manager | `aaif-goose/goose:crates/goose/src/session/session_manager.rs` |
| Model catalog | `aaif-goose/goose:crates/goose-providers/src/canonical/data/provider_metadata.json` |
| Anthropic Agent SDK (Python) | https://github.com/anthropics/anthropic-sdk-python |
| Claude Code (changelog/examples) | https://github.com/anthropics/claude-code |
| Claude Code Docs | https://code.claude.com/docs |
