# Spike: Claude-Code Integration Surface Map

**Date:** 2026-06-09
**Issue:** #4
**Status:** Complete

## Executive Summary

NanoClaw uses two Anthropic packages to run agents inside containers:

- **`@anthropic-ai/claude-code`** (v2.1.154) — the Claude Code CLI binary, installed globally via pnpm in the container image. The SDK's `query()` function spawns this binary as a subprocess.
- **`@anthropic-ai/claude-agent-sdk`** (v0.3.154) — the TypeScript SDK that wraps the CLI. The agent-runner imports `query()` from this package to start and manage agent sessions.

Together they provide: LLM query execution with tool use, session continuation via `.jsonl` transcripts, MCP server wiring, hook callbacks (PreToolUse, PostToolUse, PreCompact), context compaction, and permission bypass. The host never calls these packages directly — all SDK interaction happens inside the container through the `ClaudeProvider` class (`container/agent-runner/src/providers/claude.ts`).

## Quick-Reference Table

| # | Touchpoint | Layer | File | E/I |
|---|-----------|-------|------|-----|
| 1 | `@anthropic-ai/claude-code` global install | Build | `container/Dockerfile:111` | Incidental |
| 2 | `CLAUDE_CODE_VERSION` build arg | Build | `container/Dockerfile:22` | Incidental |
| 3 | `only-built-dependencies` allowlist | Build | `container/Dockerfile:104` | Incidental |
| 4 | `pathToClaudeCodeExecutable` | Build/Runtime | `claude.ts:405` | Incidental |
| 5 | `@anthropic-ai/claude-agent-sdk` dependency | Build | `package.json:12` | Incidental |
| 6 | `CLAUDE_CODE_*` env vars in settings.json | Spawn | `group-init.ts:13-15` | Incidental |
| 7 | PreCompact shell hook in settings.json | Spawn | `group-init.ts:18-28` | Incidental |
| 8 | `.claude-shared/` directory + mount | Spawn | `container-runner.ts:256,311` | Incidental |
| 9 | CLAUDE.md / CLAUDE.local.md composition | Spawn | `claude-md-compose.ts:43` | Mixed |
| 10 | Skill symlinks in `.claude/skills/` | Spawn | `container-runner.ts:342-396` | Incidental |
| 11 | `/home/node/.claude` mount path | Spawn | `container-runner.ts:311` | Incidental |
| 12 | `sdkQuery()` call | Runtime | `claude.ts:399-427` | Essential (capability) |
| 13 | `allowedTools` list | Runtime | `claude.ts:43-62,407-410` | Essential (capability) |
| 14 | `disallowedTools` list | Runtime | `claude.ts:26-36,411` | Essential (capability) |
| 15 | `permissionMode: 'bypassPermissions'` | Runtime | `claude.ts:416` | Essential (capability) |
| 16 | `allowDangerouslySkipPermissions` | Runtime | `claude.ts:417` | Incidental (SDK-specific flag) |
| 17 | `settingSources` | Runtime | `claude.ts:418` | Incidental |
| 18 | `systemPrompt` (preset + append) | Runtime | `claude.ts:406` | Essential (capability) |
| 19 | `mcpServers` passthrough | Runtime | `claude.ts:419` | Essential (capability) |
| 20 | `model` / `effort` passthrough | Runtime | `claude.ts:413-415` | Essential (capability) |
| 21 | `resume` (continuation) | Runtime | `claude.ts:404` | Essential (capability) |
| 22 | `env` passthrough | Runtime | `claude.ts:412` | Essential (capability) |
| 23 | `cwd` | Runtime | `claude.ts:403` | Essential (capability) |
| 24 | `additionalDirectories` | Runtime | `claude.ts:404` | Incidental |
| 25 | PreToolUse hook (tool-in-flight + block) | Runtime | `claude.ts:161-180` | Mixed |
| 26 | PostToolUse / PostToolUseFailure hooks | Runtime | `claude.ts:183-189` | Incidental |
| 27 | PreCompact hook (transcript archiving) | Runtime | `claude.ts:236-242` | Incidental |
| 28 | `MessageStream` (async iterable input) | Runtime | `claude.ts:81-113` | Essential (capability) |
| 29 | Event translation (init/result/error/progress/activity) | Runtime | `claude.ts:431-459` | Essential (capability) |
| 30 | Transcript rotation (size/age) | Runtime | `claude.ts:251-391` | Incidental |
| 31 | Stale session detection regex | Runtime | `claude.ts:329` | Incidental |
| 32 | `CLAUDE_CODE_AUTO_COMPACT_WINDOW` env var | Runtime | `claude.ts:322` | Incidental |
| 33 | `CLAUDE_TRANSCRIPT_ROTATE_BYTES` env var | Runtime | `claude.ts:252` | Incidental |
| 34 | `CLAUDE_TRANSCRIPT_ROTATE_AGE_DAYS` env var | Runtime | `claude.ts:260` | Incidental |
| 35 | `CLAUDE_CONFIG_DIR` env var | Runtime | `claude.ts:269` | Incidental |
| 36 | `.jsonl` transcript file format | Runtime | `claude.ts:122-141,278-310` | Incidental |
| 37 | `supportsNativeSlashCommands` | Runtime | `claude.ts:332` | Incidental |
| 38 | `compact-instructions.ts` (PreCompact stdout) | Runtime | `compact-instructions.ts:1-34` | Incidental |
| 39 | `setup/verify.ts` env var check | Setup | `verify.ts:142` | Incidental |
| 40 | `setup/lib/claude-assist.ts` CLI spawning | Setup | `claude-assist.ts:1-30` | Incidental |

**Legend:** E = Essential (any replacement must provide this), I = Incidental (specific to claude-code), Mixed = the capability is essential but the mechanism is incidental.

## End-to-End Flow Walkthrough

### Stage 1: Container Image Build

The Dockerfile (`container/Dockerfile`) bakes the Claude Code CLI into the agent image. This is the only build-time dependency on claude-code.

**Touchpoint 1.1: Version pinning (`Dockerfile:22`)**

```dockerfile
ARG CLAUDE_CODE_VERSION=2.1.154
```

A build-time argument pins the Claude Code CLI version for reproducibility. Every container spawned from this image runs the same CLI version. Bumping this is the most common Dockerfile change.

**Classification: Incidental.** The version pin and ARG mechanism are specific to how claude-code distributes its CLI. A different runtime would have its own versioning.

**Touchpoint 1.2: Supply-chain allowlist (`Dockerfile:104`)**

```dockerfile
echo "only-built-dependencies[]=@anthropic-ai/claude-code" >> /root/.npmrc
```

pnpm's `only-built-dependencies` policy blocks postinstall scripts by default. Claude Code's postinstall downloads a platform-specific native binary (linux-arm64). Without this allowlist entry, the binary isn't downloaded and the SDK fails at runtime with "native binary not found."

**Classification: Incidental.** This is an artifact of claude-code's distribution model (native binary downloaded via postinstall). A different runtime might ship as a pure JS package or a standalone binary.

**Touchpoint 1.3: Global CLI install (`Dockerfile:110-111`)**

```dockerfile
RUN --mount=type=cache,target=/root/.cache/pnpm \
    pnpm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"
```

Installs the CLI globally so it's available at `/pnpm/claude`. The SDK's `query()` function spawns this binary as a subprocess — the SDK is a thin wrapper, not a standalone runtime.

**Classification: Incidental.** The two-package architecture (SDK wrapper + CLI binary) is specific to claude-code.

**Touchpoint 1.4: Agent SDK dependency (`container/agent-runner/package.json:12`)**

```json
"@anthropic-ai/claude-agent-sdk": "^0.3.154"
```

The TypeScript SDK installed via `bun install` in the agent-runner workspace. Provides the `query()` function and hook types imported by `claude.ts`.

**Classification: Incidental.** This is the specific SDK package. A replacement would substitute a different package.

**Touchpoint 1.5: Entrypoint (`container/entrypoint.sh`)**

```bash
cat > /tmp/input.json
exec bun run /app/src/index.ts < /tmp/input.json
```

The entrypoint captures stdin (host-provided config JSON) then runs the agent-runner. This is provider-agnostic — it doesn't reference claude-code directly. However, the runner's `index.ts` imports the Claude provider which in turn requires the CLI binary at `/pnpm/claude`.

**Classification: Not a direct touchpoint** — included for context. The entrypoint is provider-agnostic.

### Stage 2: Host-Side Group Initialization

Group init (`src/group-init.ts`) creates the per-agent-group filesystem scaffold. Several artifacts are Claude Code-specific conventions.

**Touchpoint 2.1: `settings.json` with `CLAUDE_CODE_*` env vars (`group-init.ts:9-32`)**

```typescript
const DEFAULT_SETTINGS_JSON = JSON.stringify({
  env: {
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0',
  },
  hooks: {
    PreCompact: [{
      hooks: [{ type: 'command', command: 'bun /app/src/compact-instructions.ts' }],
    }],
  },
}, null, 2);
```

Written to `.claude-shared/settings.json` on first group init. Claude Code reads this file at startup for environment overrides and hook definitions.

- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`: Enables agent teams/delegation (Task tool).
- `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`: Loads CLAUDE.md from additional directories.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY`: Controls whether Claude Code auto-saves memories.

**Classification: Incidental.** The `settings.json` format, env var names, and hook definition schema are all Claude Code-specific. A replacement runtime would have its own configuration mechanism.

**Touchpoint 2.2: PreCompact shell hook (`group-init.ts:106-133`)**

```typescript
const PRE_COMPACT_COMMAND = 'bun /app/src/compact-instructions.ts';
```

`ensurePreCompactHook()` patches existing `settings.json` files to include the PreCompact shell hook if missing. This is a Claude Code convention: shell hooks defined in `settings.json` are executed as subprocesses, with stdout captured as custom compaction instructions.

**Classification: Incidental.** Shell hooks in `settings.json` are a Claude Code-specific mechanism. The underlying need (custom compaction instructions) is essential, but this delivery mechanism is not.

**Touchpoint 2.3: `.claude-shared/` directory structure (`group-init.ts:74-94`)**

Creates:
- `.claude-shared/` — mounted at `/home/node/.claude` inside the container
- `.claude-shared/settings.json` — Claude Code reads this on startup
- `.claude-shared/skills/` — skill symlinks; Claude Code discovers skills here

**Classification: Incidental.** The `.claude/` directory convention is Claude Code-specific.

### Stage 3: Host-Side Container Spawn

Container spawn (`src/container-runner.ts`) builds the mount list and Docker args. Several mounts exist specifically for Claude Code conventions.

**Touchpoint 3.1: `.claude-shared` mounted at `/home/node/.claude` (`container-runner.ts:311`)**

```typescript
mounts.push({ hostPath: claudeDir, containerPath: '/home/node/.claude', readonly: false });
```

Claude Code looks for its state directory at `$HOME/.claude`. This mount provides the per-group `settings.json`, skill symlinks, and any other Claude Code state.

**Classification: Incidental.** The `$HOME/.claude` convention is Claude Code-specific.

**Touchpoint 3.2: CLAUDE.md composition and RO mount (`container-runner.ts:259-294, claude-md-compose.ts`)**

The host regenerates `CLAUDE.md` on every spawn from:
- Shared base (`container/CLAUDE.md` → `/app/CLAUDE.md`)
- Skill fragments (`instructions.md` from enabled skills)
- MCP server fragments (inline instructions from container.json)

The composed file is mounted read-only. `CLAUDE.local.md` (per-group memory) remains read-write.

Claude Code auto-loads `CLAUDE.md` from the working directory and `CLAUDE.local.md` as a local override. This naming convention is specific to Claude Code.

**Classification: Mixed.** The capability (injecting system-level instructions and per-group memory) is essential. The specific file names (`CLAUDE.md`, `CLAUDE.local.md`) and auto-load behavior are Claude Code conventions.

**Touchpoint 3.3: Skill symlinks (`container-runner.ts:342-396`)**

```typescript
fs.symlinkSync(`/app/skills/${skill}`, linkPath);
```

Skills are symlinked into `.claude-shared/skills/` (→ `/home/node/.claude/skills/` inside the container). Claude Code discovers skills by scanning this directory and loading `SKILL.md` files.

**Classification: Incidental.** The skill discovery mechanism (directory scan + `SKILL.md`) is Claude Code-specific.

**Touchpoint 3.4: Shared CLAUDE.md mount (`container-runner.ts:304-307`)**

```typescript
mounts.push({ hostPath: sharedClaudeMd, containerPath: '/app/CLAUDE.md', readonly: true });
```

The shared base `CLAUDE.md` is mounted read-only at `/app/CLAUDE.md`. The composed per-group `CLAUDE.md` imports it via a symlink.

**Classification: Incidental.** The import-via-symlink composition model is a Claude Code convention.

### Stage 4: Container Boot

The agent-runner entry point (`container/agent-runner/src/index.ts`) is provider-agnostic. It imports the provider barrel, reads `container.json` for the provider name, and calls `createProvider()`.

**Touchpoint 4.1: Provider barrel import (`index.ts:32`)**

```typescript
import './providers/index.js';
```

The barrel imports `claude.ts` (and any other installed providers), which calls `registerProvider('claude', ...)` at module scope. This is the only import-time side effect.

**Classification: Essential (pattern).** The self-registration pattern is provider-agnostic, but the Claude provider is the default and only built-in provider. The barrel ensures the Claude provider is always available.

**Touchpoint 4.2: Provider factory (`index.ts:44, factory.ts:11-13`)**

```typescript
const providerName = config.provider.toLowerCase() as ProviderName;
const provider = createProvider(providerName, { ... });
```

Reads `provider` from `container.json` (default: `"claude"`), looks it up in the registry, and instantiates it with options (assistantName, mcpServers, env, additionalDirectories, model, effort).

**Classification: Essential (pattern).** The factory pattern is provider-agnostic. The `"claude"` default is incidental.

### Stage 5: Poll Loop → Provider Query

The poll loop (`container/agent-runner/src/poll-loop.ts`) is the main runtime loop. It interacts with the provider through the `AgentProvider` interface — most of the loop is provider-agnostic.

**Touchpoint 5.1: Continuation management (`poll-loop.ts:84-97`)**

```typescript
let continuation = migrateLegacyContinuation(config.providerName);
if (continuation) {
  const rotateReason = config.provider.maybeRotateContinuation?.(continuation, config.cwd);
  if (rotateReason) {
    clearContinuation(config.providerName);
    continuation = undefined;
  }
}
```

On boot, the poll loop loads a stored continuation token (per-provider). Before using it, it asks the provider whether the session should be rotated (too large/old). For Claude, this checks the `.jsonl` transcript file size and age.

**Classification: Essential (capability).** Session continuation is essential. The rotation mechanism (transcript size/age checks) is incidental — it's specific to claude-code's `.jsonl` transcript format.

**Touchpoint 5.2: `supportsNativeSlashCommands` (`poll-loop.ts:217,279-305`)**

```typescript
const prompt = formatMessagesWithCommands(keep, config.provider.supportsNativeSlashCommands);
```

When true (Claude), slash commands like `/compact` and `/cost` are passed as raw text so the Claude Code CLI can dispatch them natively. When false (other providers), they're formatted as regular XML messages.

**Classification: Incidental.** Native slash command handling is a Claude Code feature. Other providers handle commands differently or not at all.

**Touchpoint 5.3: `query()` call (`poll-loop.ts:221-226`)**

```typescript
const query = config.provider.query({
  prompt,
  continuation,
  cwd: config.cwd,
  systemContext: config.systemContext,
});
```

The poll loop calls the provider's `query()` method with the formatted prompt, continuation token, working directory, and system context. This is the interface boundary — the poll loop doesn't know what happens inside.

**Classification: Essential (interface).** The `QueryInput` shape is the provider contract.

**Touchpoint 5.4: Follow-up push into active query (`poll-loop.ts:393-395`)**

```typescript
query.push(prompt);
```

While a query is active, new messages arriving in `messages_in` are pushed into the existing query stream rather than starting a new one. This avoids re-spawning the CLI subprocess and re-loading the transcript.

**Classification: Essential (capability).** Streaming follow-up messages into an active query is a core capability. The motivation (avoiding CLI restart cost) is incidental.

**Touchpoint 5.5: Stale session recovery (`poll-loop.ts:247-250`)**

```typescript
if (continuation && config.provider.isSessionInvalid(err)) {
  continuation = undefined;
  clearContinuation(config.providerName);
}
```

On error, asks the provider whether the error means the continuation is invalid. For Claude, this matches a regex against "no conversation found" / "ENOENT .jsonl" error messages.

**Classification: Essential (capability).** Session invalidation detection is essential. The specific error regex is incidental.

**Touchpoint 5.6: Event consumption (`poll-loop.ts:436-471`)**

```typescript
for await (const event of query.events) {
  handleEvent(event, routing);
  touchHeartbeat();
  if (event.type === 'init') { ... }
  else if (event.type === 'result') { ... }
}
```

The poll loop consumes `ProviderEvent` from the query's async iterable. It handles `init` (save continuation), `result` (dispatch text), `error` (log), `progress` (log), and `activity` (heartbeat). The event types are defined in `types.ts` and are provider-agnostic.

**Classification: Essential (interface).** The `ProviderEvent` union is the output contract.

### Stage 6: SDK Query Options

The `ClaudeProvider.query()` method (`container/agent-runner/src/providers/claude.ts:393-427`) calls the SDK's `query()` function with a comprehensive options object. This is the deepest integration point.

**Touchpoint 6.1: `prompt` as async iterable (`claude.ts:81-113,394-395`)**

```typescript
const stream = new MessageStream();
stream.push(input.prompt);
const sdkResult = sdkQuery({ prompt: stream, ... });
```

The SDK accepts an `AsyncIterable<SDKUserMessage>` as its prompt, enabling streaming input. `MessageStream` is a custom push-based async iterable that bridges the poll loop's `push()` calls to the SDK's pull-based consumption.

**Classification: Essential (capability).** Streaming input is required for follow-up message injection. The specific message shape (`{ type: 'user', message: { role: 'user', content: string }, parent_tool_use_id: null, session_id: '' }`) is incidental.

**Touchpoint 6.2: `options.cwd` (`claude.ts:403`)**

Working directory for the agent. Set to `/workspace/agent`.

**Classification: Essential.** Any runtime needs a working directory.

**Touchpoint 6.3: `options.resume` (`claude.ts:404`)**

```typescript
resume: input.continuation,
```

Resumes a previous session by ID. The SDK reloads the `.jsonl` transcript file for this session and continues the conversation.

**Classification: Essential (capability).** Session resume is essential. The `.jsonl` mechanism is incidental.

**Touchpoint 6.4: `options.additionalDirectories` (`claude.ts:404`)**

```typescript
additionalDirectories: this.additionalDirectories,
```

Tells Claude Code to treat additional mount points as part of the workspace. Used for `/workspace/extra/*` mounts.

**Classification: Incidental.** This is a Claude Code-specific concept for multi-directory awareness.

**Touchpoint 6.5: `options.pathToClaudeCodeExecutable` (`claude.ts:405`)**

```typescript
pathToClaudeCodeExecutable: '/pnpm/claude',
```

Points the SDK to the globally installed Claude Code binary. Without this, the SDK searches `$PATH`.

**Classification: Incidental.** Only relevant because the SDK spawns an external binary.

**Touchpoint 6.6: `options.systemPrompt` (`claude.ts:406`)**

```typescript
systemPrompt: instructions
  ? { type: 'preset', preset: 'claude_code', append: instructions }
  : undefined,
```

Appends NanoClaw's runtime instructions (destinations map, agent identity) to Claude Code's built-in system prompt. The `preset: 'claude_code'` value uses the SDK's standard base prompt.

**Classification: Mixed.** Injecting system instructions is essential. The preset mechanism and `'claude_code'` preset value are incidental.

**Touchpoint 6.7: `options.allowedTools` (`claude.ts:407-410`)**

```typescript
allowedTools: [
  ...TOOL_ALLOWLIST,
  ...Object.keys(this.mcpServers).map(mcpAllowPattern),
],
```

Whitelist of tools the agent can use. Includes 22 built-in tools (Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, Task, TaskOutput, TaskStop, TeamCreate, TeamDelete, SendMessage, TodoWrite, ToolSearch, Skill, NotebookEdit) plus `mcp__<serverName>__*` patterns for all registered MCP servers.

**Classification: Essential (capability).** Tool allowlisting is essential for security. The specific tool names are Claude Code's vocabulary — a replacement would have its own tool names.

**Touchpoint 6.8: `options.disallowedTools` (`claude.ts:411`)**

```typescript
disallowedTools: SDK_DISALLOWED_TOOLS,
```

Blocklist: CronCreate, CronDelete, CronList, ScheduleWakeup (NanoClaw has its own scheduling), AskUserQuestion (NanoClaw has its own via MCP), EnterPlanMode, ExitPlanMode, EnterWorktree, ExitWorktree (UI affordances that hang headless).

**Classification: Incidental.** The specific tools blocked are Claude Code built-ins that conflict with NanoClaw's own implementations.

**Touchpoint 6.9: `options.env` (`claude.ts:412`)**

```typescript
env: this.env,
```

Passes environment variables to the CLI subprocess. Includes `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (controls auto-compaction threshold).

**Classification: Essential (capability).** Passing env to the runtime is essential. The specific env vars are incidental.

**Touchpoint 6.10: `options.model` and `options.effort` (`claude.ts:413-415`)**

Model alias or full ID, and reasoning effort level. Passed through from container.json.

**Classification: Essential.** Any runtime needs model selection.

**Touchpoint 6.11: `options.permissionMode` and `options.allowDangerouslySkipPermissions` (`claude.ts:416-417`)**

```typescript
permissionMode: 'bypassPermissions',
allowDangerouslySkipPermissions: true,
```

Skips all interactive permission prompts. Required for headless operation — without this, the CLI would block on "Allow this tool?" prompts.

**Classification: Essential (capability).** Permission bypass for headless operation is essential. The two-flag mechanism is incidental.

**Touchpoint 6.12: `options.settingSources` (`claude.ts:418`)**

```typescript
settingSources: ['project', 'user', 'local'],
```

Controls which `settings.json` files Claude Code loads: project-level, user-level, and local. These provide env var overrides and hook definitions.

**Classification: Incidental.** The multi-level settings cascade is a Claude Code feature.

**Touchpoint 6.13: `options.mcpServers` (`claude.ts:419`)**

```typescript
mcpServers: this.mcpServers,
```

Passes MCP server configurations to the SDK. The SDK starts each server as a subprocess and exposes its tools under the `mcp__<name>__*` namespace.

**Classification: Essential.** MCP server wiring is essential for the NanoClaw tool interface.

**Touchpoint 6.14: `options.hooks` (`claude.ts:420-425`)**

```typescript
hooks: {
  PreToolUse: [{ hooks: [preToolUseHook] }],
  PostToolUse: [{ hooks: [postToolUseHook] }],
  PostToolUseFailure: [{ hooks: [postToolUseHook] }],
  PreCompact: [{ hooks: [createPreCompactHook(this.assistantName)] }],
},
```

Four hook registrations (detailed in Stage 7).

**Classification: Mixed.** The capability (intercepting tool calls) is essential. The hook registration format is incidental.

### Stage 7: Hooks

**Touchpoint 7.1: PreToolUse hook — tool-in-flight tracking + disallowed tool blocking (`claude.ts:161-180`)**

```typescript
const preToolUseHook: HookCallback = async (input) => {
  const toolName = i.tool_name ?? '';
  if (SDK_DISALLOWED_TOOLS.includes(toolName)) {
    return { decision: 'block', stopReason: '...' };
  }
  setContainerToolInFlight(toolName, declaredTimeoutMs);
  return { continue: true };
};
```

Two responsibilities:
1. **Defense-in-depth blocking:** If a disallowed tool slips through the SDK's filter, block it here.
2. **Tool-in-flight tracking:** Records the current tool name and declared timeout in the session DB (`outbound.db:container_state`). The host sweep reads this to widen its stuck-detection tolerance during long Bash runs.

**Classification: Mixed.** Tool-in-flight tracking (for host sweep coordination) is essential — any replacement must signal what tool is running. The hook callback format is incidental.

**Touchpoint 7.2: PostToolUse / PostToolUseFailure hooks (`claude.ts:183-189`)**

Clear the tool-in-flight state after a tool completes or fails.

**Classification: Same as 7.1** — the clear signal is essential, the hook format is incidental.

**Touchpoint 7.3: PreCompact SDK hook — transcript archiving (`claude.ts:236-242`)**

```typescript
function createPreCompactHook(assistantName?: string): HookCallback {
  return async (input) => {
    const preCompact = input as PreCompactHookInput;
    archiveTranscriptFile(preCompact.transcript_path, preCompact.session_id, assistantName);
    return {};
  };
}
```

Before Claude Code compacts context, this hook reads the `.jsonl` transcript and writes a human-readable markdown summary to `conversations/`. This preserves conversation history that would otherwise be lost during compaction.

**Classification: Incidental.** Transcript archiving is specific to claude-code's compaction model. The `.jsonl` parsing, `PreCompactHookInput` shape, and `conversations/` output are all claude-code-specific.

**Touchpoint 7.4: PreCompact shell hook — compact instructions (`compact-instructions.ts`)**

```typescript
// Registered in settings.json: "command": "bun /app/src/compact-instructions.ts"
const destinations = getAllDestinations();
console.log(instructions.join('\n'));
```

A shell hook (defined in `settings.json`, not the SDK hook API) that outputs custom compaction instructions to stdout. Claude Code captures this output and includes it in the compaction prompt, ensuring destination routing context survives compaction.

**Classification: Mixed.** The need to preserve routing context through compaction is essential. The shell-hook mechanism (stdout capture in settings.json) is incidental.

### Stage 8: Event Translation + Session Management

**Touchpoint 8.1: Event translation (`claude.ts:431-459`)**

```typescript
async function* translateEvents(): AsyncGenerator<ProviderEvent> {
  for await (const message of sdkResult) {
    yield { type: 'activity' };
    if (message.type === 'system' && message.subtype === 'init') { ... }
    else if (message.type === 'result') { ... }
    else if (message.subtype === 'api_retry') { ... }
    else if (message.subtype === 'rate_limit_event') { ... }
    else if (message.subtype === 'compact_boundary') { ... }
    else if (message.subtype === 'task_notification') { ... }
  }
}
```

Maps SDK-specific message types to the provider-agnostic `ProviderEvent` union:
- `system/init` → `{ type: 'init', continuation: session_id }` — captures the session ID for continuation
- `result` → `{ type: 'result', text }` — the agent's final response text
- `system/api_retry` → `{ type: 'error', retryable: true }` — transient API errors
- `system/rate_limit_event` → `{ type: 'error', classification: 'quota' }` — quota exhaustion
- `system/compact_boundary` → `{ type: 'result', text: 'Context compacted...' }` — context compaction notification
- `system/task_notification` → `{ type: 'progress', message }` — agent teams task notifications
- Every event also yields `{ type: 'activity' }` for heartbeat liveness

**Classification: Essential (interface).** The translation to `ProviderEvent` is the output contract. The specific SDK event types and subtypes consumed are incidental.

**Touchpoint 8.2: Transcript rotation (`claude.ts:251-310,358-391`)**

`maybeRotateContinuation()` checks the `.jsonl` transcript size and age before resuming:
- Size cap: `CLAUDE_TRANSCRIPT_ROTATE_BYTES` (default 12MB)
- Age cap: `CLAUDE_TRANSCRIPT_ROTATE_AGE_DAYS` (default 14 days)

If either threshold is exceeded, the transcript is archived to markdown and renamed to `.rotated-<timestamp>`, forcing a fresh session.

**Classification: Incidental.** The entire rotation mechanism is specific to claude-code's `.jsonl` transcript format. A different runtime might not accumulate on-disk state at all.

**Touchpoint 8.3: Stale session detection (`claude.ts:329,353-356`)**

```typescript
const STALE_SESSION_RE = /no conversation found|ENOENT.*\.jsonl|session.*not found/i;

isSessionInvalid(err: unknown): boolean {
  return STALE_SESSION_RE.test(msg);
}
```

Matches error messages indicating a corrupt or missing session transcript. Used by the poll loop to clear invalid continuations.

**Classification: Incidental.** The specific error patterns are claude-code-specific.

**Touchpoint 8.4: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (`claude.ts:322`)**

```typescript
const CLAUDE_CODE_AUTO_COMPACT_WINDOW = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW || '165000';
```

Controls the token threshold at which Claude Code automatically compacts context. Injected into the SDK's env.

**Classification: Incidental.** The auto-compact window and env var name are claude-code-specific.

## Essential vs Incidental Classification

### Essential Capabilities

Any replacement agent runtime must provide these capabilities:

| Capability | Touchpoints | Rationale |
|-----------|-------------|-----------|
| LLM query with tool use | 6.1, 5.3 | Core function — send a prompt, get a response with tool calls |
| Streaming input (follow-up messages) | 6.1, 5.4 | Required for NanoClaw's "push into active query" model |
| Session continuation | 6.3, 5.1, 5.5 | Agents must resume conversations across container restarts |
| Tool allow/deny lists | 6.7, 6.8 | Security boundary — agents must not access arbitrary tools |
| Permission bypass | 6.11 | Headless operation — no interactive prompts |
| System prompt injection | 6.6 | Runtime instructions (destinations, identity) must be injectable |
| MCP server wiring | 6.13 | NanoClaw's tool interface (scheduling, messaging, file ops) relies on MCP |
| Model/effort selection | 6.10 | Per-group model configuration |
| Environment passthrough | 6.9, 6.2 | Runtime env and cwd must be configurable |
| Event streaming | 8.1, 5.6 | Must emit init (session ID), result (text), error, and activity (liveness) events |
| Tool-in-flight signaling | 7.1, 7.2 | Host sweep needs to know what tool is running for stuck detection |
| Custom compaction instructions | 7.4 | Destination routing context must survive context compaction |

### Incidental Mechanisms

These are specific to claude-code's architecture and would not carry over to a replacement:

| Mechanism | Touchpoints | Why incidental |
|----------|-------------|----------------|
| Two-package architecture (SDK + CLI binary) | 1.1-1.4, 6.5 | Distribution model — another runtime might be a single package |
| `.jsonl` transcript files | 8.2, 8.3, 5.1 | On-disk session format — another runtime might use a database or API |
| `settings.json` hook/env configuration | 2.1, 2.2, 6.12 | Configuration mechanism — another runtime would configure differently |
| `$HOME/.claude` directory convention | 2.3, 3.1 | State directory — another runtime has its own state location |
| `CLAUDE.md` / `CLAUDE.local.md` auto-load | 3.2, 3.4 | Instruction delivery — another runtime would use system prompt or config |
| Skill discovery via `.claude/skills/` | 3.3 | Skill loading — another runtime would need its own skill mechanism |
| Native slash commands | 5.2 | CLI-specific feature — `/compact`, `/cost` are Claude Code UI commands |
| `CLAUDE_CODE_*` env vars | 2.1, 8.4, 6.9 | Configuration namespace — another runtime has different env vars |
| PreCompact transcript archiving | 7.3 | Compaction-specific — another runtime's context management differs |
| `only-built-dependencies` postinstall | 1.2 | pnpm supply-chain workaround for native binary download |

### Setup-Layer Touchpoints

Two setup files reference claude-code but are not part of the runtime flow:

**`setup/verify.ts:142`** — Checks for `CLAUDE_CODE_OAUTH_TOKEN` (among other auth vars) in `.env` during post-install verification. Used to confirm authentication is configured.

**Classification: Incidental.** The specific env var name is claude-code-specific.

**`setup/lib/claude-assist.ts`** — Spawns the `claude` CLI (`claude -p --output-format text`) to provide AI-assisted debugging when a setup step fails. This is an optional UX convenience, not part of the agent runtime.

**Classification: Incidental.** Uses the Claude Code CLI directly for interactive assistance. Not related to agent runtime.

## Detailed Appendix

### A. All `sdkQuery()` Options Passed

| Option | Value | Source |
|--------|-------|--------|
| `prompt` | `MessageStream` (async iterable) | `claude.ts:394` |
| `options.cwd` | `input.cwd` (= `/workspace/agent`) | `claude.ts:403` |
| `options.additionalDirectories` | `/workspace/extra/*` subdirs | `claude.ts:404` |
| `options.resume` | Stored continuation token | `claude.ts:404` |
| `options.pathToClaudeCodeExecutable` | `'/pnpm/claude'` | `claude.ts:405` |
| `options.systemPrompt` | `{ type: 'preset', preset: 'claude_code', append: instructions }` | `claude.ts:406` |
| `options.allowedTools` | `TOOL_ALLOWLIST` + MCP patterns | `claude.ts:407-410` |
| `options.disallowedTools` | `SDK_DISALLOWED_TOOLS` | `claude.ts:411` |
| `options.env` | `{ ...process.env, CLAUDE_CODE_AUTO_COMPACT_WINDOW }` | `claude.ts:412` |
| `options.model` | From container.json | `claude.ts:413` |
| `options.effort` | From container.json | `claude.ts:415` |
| `options.permissionMode` | `'bypassPermissions'` | `claude.ts:416` |
| `options.allowDangerouslySkipPermissions` | `true` | `claude.ts:417` |
| `options.settingSources` | `['project', 'user', 'local']` | `claude.ts:418` |
| `options.mcpServers` | From `index.ts` (nanoclaw + container.json) | `claude.ts:419` |
| `options.hooks` | PreToolUse, PostToolUse, PostToolUseFailure, PreCompact | `claude.ts:420-425` |

### B. All `ProviderEvent` Types Handled

| Event Type | Fields | Source (SDK message) | Consumer |
|-----------|--------|---------------------|----------|
| `init` | `continuation: string` | `system/init` → `session_id` | `poll-loop.ts:440-448` |
| `result` | `text: string \| null` | `result` → `result` field | `poll-loop.ts:450-470` |
| `error` | `message, retryable, classification?` | `system/api_retry`, `system/rate_limit_event` | `poll-loop.ts:488-492` |
| `progress` | `message: string` | `system/task_notification` | `poll-loop.ts:494-496` |
| `activity` | (none) | Every SDK event | `poll-loop.ts:438` |

### C. All Hooks Registered

**SDK hooks (registered in `options.hooks`):**

| Hook | Callback | Purpose |
|------|----------|---------|
| `PreToolUse` | `preToolUseHook` | Block disallowed tools + record tool-in-flight state |
| `PostToolUse` | `postToolUseHook` | Clear tool-in-flight state |
| `PostToolUseFailure` | `postToolUseHook` | Clear tool-in-flight state (same callback) |
| `PreCompact` | `createPreCompactHook()` | Archive transcript to markdown before compaction |

**Shell hooks (registered in `.claude-shared/settings.json`):**

| Hook | Command | Purpose |
|------|---------|---------|
| `PreCompact` | `bun /app/src/compact-instructions.ts` | Output custom compaction instructions (stdout) |

### D. All Tools in Allow/Disallow Lists

**Allowed (22 built-in + MCP):**

`Bash`, `Read`, `Write`, `Edit`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, `Task`, `TaskOutput`, `TaskStop`, `TeamCreate`, `TeamDelete`, `SendMessage`, `TodoWrite`, `ToolSearch`, `Skill`, `NotebookEdit` + `mcp__<serverName>__*` for each registered MCP server.

**Disallowed (9):**

`CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup` (NanoClaw has its own scheduling via MCP), `AskUserQuestion` (NanoClaw has its own via MCP), `EnterPlanMode`, `ExitPlanMode`, `EnterWorktree`, `ExitWorktree` (UI affordances that hang headless).

### E. All `.claude/` Filesystem Conventions

| Path (container) | Host source | Purpose |
|------------------|-------------|---------|
| `/home/node/.claude/` | `data/v2-sessions/<group-id>/.claude-shared/` | Claude Code state directory |
| `/home/node/.claude/settings.json` | Same, created by `group-init.ts` | Env overrides + shell hooks |
| `/home/node/.claude/skills/<name>/` | Symlink → `/app/skills/<name>` | Skill discovery |
| `/home/node/.claude/projects/*/` | Auto-created by SDK | Per-cwd session transcripts |
| `/workspace/agent/CLAUDE.md` | `groups/<folder>/CLAUDE.md` (composed) | Auto-loaded system instructions |
| `/workspace/agent/CLAUDE.local.md` | `groups/<folder>/CLAUDE.local.md` | Per-group memory (RW) |

### F. All `CLAUDE_CODE_*` Environment Variables

| Variable | Default | Set by | Purpose |
|----------|---------|--------|---------|
| `CLAUDE_CODE_VERSION` | `2.1.154` | Dockerfile ARG | Pins CLI version at build time |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `'1'` | settings.json | Enables agent teams (Task tool delegation) |
| `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD` | `'1'` | settings.json | Loads CLAUDE.md from additional directories |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | `'0'` | settings.json | Controls auto-memory behavior |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `'165000'` | claude.ts env | Auto-compaction token threshold |
| `CLAUDE_CODE_OAUTH_TOKEN` | (user-set) | .env | OAuth authentication (checked by setup/verify.ts) |
| `CLAUDE_CONFIG_DIR` | `$HOME/.claude` | (optional override) | Claude Code config directory |
| `CLAUDE_TRANSCRIPT_ROTATE_BYTES` | `12MB` | (optional override) | Transcript rotation size threshold |
| `CLAUDE_TRANSCRIPT_ROTATE_AGE_DAYS` | `14` | (optional override) | Transcript rotation age threshold |

### G. NPM Packages

| Package | Version | Where | Purpose |
|---------|---------|-------|---------|
| `@anthropic-ai/claude-code` | `2.1.154` | Dockerfile (global install) | Claude Code CLI binary |
| `@anthropic-ai/claude-agent-sdk` | `^0.3.154` | `container/agent-runner/package.json` | TypeScript SDK wrapping the CLI |
| `@anthropic-ai/sdk` | `^0.100.0` | `container/agent-runner/package.json` | Base Anthropic SDK (used by agent-sdk) |
