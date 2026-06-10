# Spike Design: Map claude-code Integration Surface

**Date:** 2026-06-09
**Issue:** #4
**Output:** `docs/superpowers/spikes/2026-06-09-claude-code-surface-map.md`

## Goal

Produce a document that maps every place `@anthropic-ai/claude-code` and `@anthropic-ai/claude-agent-sdk` touch the NanoClaw system. The document catalogs touchpoints across three layers (build, spawn, runtime), classifies each as essential or incidental, and provides enough context to understand where each sits in the message lifecycle.

**Explicitly out of scope:** evaluating alternatives or proposing replacements.

## Document Structure

### 1. Executive Summary
One paragraph describing what claude-code is in this system, followed by a quick-reference table of all touchpoints with layer and essential/incidental classification.

### 2. End-to-End Flow Walkthrough
Eight stages, each annotating every claude-code touchpoint with file:line references:

1. **Image build** — Dockerfile: pinned version ARG, pnpm global install, `only-built-dependencies` allowlist for native binary postinstall
2. **Host-side group init** — `group-init.ts`: `.claude-shared/settings.json` with `CLAUDE_CODE_*` env vars and PreCompact shell hook; `claude-md-compose.ts`: CLAUDE.md/CLAUDE.local.md composition (Claude Code auto-loads these)
3. **Host-side spawn** — `container-runner.ts`: `.claude-shared` mount at `/home/node/.claude`, skill symlinks, CLAUDE.md RO mounts, entrypoint override
4. **Container boot** — `index.ts`: provider factory, provider barrel import; `factory.ts`: provider selection; `provider-registry.ts`: self-registration pattern
5. **Poll loop → provider query** — `poll-loop.ts`: continuation management (resume/rotate/clear), `query()` call, `supportsNativeSlashCommands`, follow-up push into active query stream
6. **SDK query options** — `claude.ts`: `sdkQuery()` call with all options (cwd, resume, pathToClaudeCodeExecutable, systemPrompt, allowedTools, disallowedTools, env, model, effort, permissionMode, settingSources, mcpServers, hooks)
7. **Hooks** — `claude.ts`: PreToolUse (tool-in-flight tracking + disallowed-tool blocking), PostToolUse/PostToolUseFailure (clear in-flight), PreCompact (transcript archiving); `group-init.ts`: PreCompact shell hook (compact-instructions.ts)
8. **Event translation + session management** — `claude.ts`: `translateEvents()` mapping SDK messages to `ProviderEvent` types (init, result, error, progress, activity); transcript rotation (size/age caps); stale session detection

### 3. Essential vs Incidental Classification
Each touchpoint classified using these criteria:
- **Essential:** Any replacement runtime must provide equivalent capability
- **Incidental:** Specific to claude-code's design; a replacement could work differently

One-line rationale per touchpoint.

### 4. Detailed Appendix
Raw catalogs:
- All `sdkQuery()` options passed
- All `ProviderEvent` types handled
- All hooks registered (SDK hooks + shell hooks)
- All tools in allow/disallow lists
- All `.claude/` filesystem conventions
- All `CLAUDE_CODE_*` env vars
- All npm packages (`@anthropic-ai/claude-code`, `@anthropic-ai/claude-agent-sdk`)

## Files in Scope

| File | Layer |
|------|-------|
| `container/Dockerfile` | Build |
| `container/entrypoint.sh` | Build |
| `container/agent-runner/package.json` | Build (dependency) |
| `src/group-init.ts` | Host spawn |
| `src/claude-md-compose.ts` | Host spawn |
| `src/container-runner.ts` | Host spawn |
| `container/agent-runner/src/index.ts` | Runtime boot |
| `container/agent-runner/src/providers/claude.ts` | Runtime (primary) |
| `container/agent-runner/src/providers/types.ts` | Runtime (interface) |
| `container/agent-runner/src/providers/provider-registry.ts` | Runtime |
| `container/agent-runner/src/providers/factory.ts` | Runtime |
| `container/agent-runner/src/poll-loop.ts` | Runtime |
| `container/agent-runner/src/compact-instructions.ts` | Runtime (hook) |
| `setup/verify.ts` | Setup |
| `setup/lib/claude-assist.ts` | Setup |

## Classification Criteria

- **Essential:** The capability is required for any agent runtime — executing LLM queries with tool use, streaming events back, session continuation, MCP server wiring, tool allow/deny lists, permission bypass, system prompt injection.
- **Incidental:** Implementation-specific to claude-code — `.jsonl` transcript format, `settings.json` hook configuration, SDK-specific event subtypes (`compact_boundary`, `task_notification`), `pathToClaudeCodeExecutable`, native binary postinstall, specific env var names.
