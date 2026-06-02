# MCP Secret Resolution + Git-Committable Config

**Date:** 2026-06-02  
**Status:** Approved

## Goals

1. Move MCP server API keys out of the database so `container_configs` contains no secrets and can be safely committed to git.
2. Make group configuration (agent groups, MCP servers, model settings, wirings, per-group instructions, custom scripts) persistent in the personal fork.
3. Enable full config restore on a fresh machine from git + `.env`.

## Decisions

- **Secret store:** `.env` (portable, copied between machines independently, never committed).
- **Reference syntax:** `$VARNAME` in MCP server `env` values inside `container_configs`. Non-`$` values pass through unchanged.
- **Resolution point:** `materializeContainerJson()` in `src/container-config.ts` — immediately after reading from DB, before writing `container.json`. `container.json` is ephemeral and gitignored; the DB and git always hold refs.
- **Config baseline:** `config/db-config.sql` — committed SQL seed for restore.
- **Third-party MCP servers:** supported via env var injection (same `$VAR` ref mechanism). No changes to MCP server code required.

## Architecture

### `$VAR` Resolution Flow

```
container_configs.mcp_servers (DB — has $VAR refs)
  │
  ▼  materializeContainerJson() in src/container-config.ts
  │  reads .env via readEnvFile(), resolves $VAR → real value
  │
  ▼
container.json (ephemeral, gitignored, has real values)
  │
  ▼
agent-runner → MCP server process env
```

`readEnvFile()` already exists in `src/env.ts` and is the correct tool — it parses `.env` without loading into `process.env`.

Resolution in `materializeContainerJson()`:
- After `configFromDb()` builds the config, scan each MCP server's `env` block to collect all `$VARNAME` values
- Pass the collected var names to `readEnvFile(varNames)` (existing API requires upfront key list)
- Substitute each `$VAR` with its resolved value
- If a var name is missing from `.env`, throw: `MCP server "<name>" references $<VAR> but it is not set in .env`
- Non-`$` values (like `OBSIDIAN_HOST`, `NO_PROXY`) pass through unchanged

### `.gitignore` Changes

Remove:
```
groups/*
**/CLAUDE.local.md
```

Add:
```
# Groups — ignore derived/ephemeral/build artifacts, track everything else
groups/*/node_modules/
groups/*/container.json
groups/*/CLAUDE.md
groups/*/.claude-shared.md
groups/*/.claude-fragments/
groups/*/conversations/
```

**Committed from `groups/`:**
- `groups/*/CLAUDE.local.md` — per-group instructions and agent memory
- `groups/vault-agent/obsidian-mcp.ts` + `obsidian-mcp.test.ts` + `package.json` + `bun.lock`
- Any future custom scripts added to group folders

**Stays gitignored:**
- `node_modules/` — build artifact
- `container.json` — ephemeral, materialized at spawn
- `CLAUDE.md` — auto-composed at spawn from fragments
- `.claude-shared.md` / `.claude-fragments/` — same
- `conversations/` — session transcripts

### Export Script: `scripts/export-config.ts`

Run on any machine to snapshot current DB config to git:

```
pnpm exec tsx scripts/export-config.ts
```

Dumps as `INSERT OR REPLACE` statements into `config/db-config.sql`:

| Table | Contents |
|---|---|
| `agent_groups` | Group names, folders, personalities |
| `container_configs` | Model, MCP servers (`$VAR` refs), packages, mounts, cli_scope |
| `messaging_groups` | Channel registrations |
| `messaging_group_agents` | Channel → agent group wirings |
| `agent_destinations` | Per-group send destinations |
| `user_roles` | Owner/admin assignments |

Skips: `sessions`, `pending_*`, `chat_sdk_*`, `user_dms`, `unregistered_senders`, `schema_version`.

Re-run and commit `config/db-config.sql` whenever groups or wirings change via `ncl`.

### Restore Script: `scripts/restore-config.ts`

Run on a fresh machine after `git clone` + `pnpm install` + `pnpm build`:

```
pnpm exec tsx scripts/restore-config.ts
```

Steps:
1. Creates `data/` if missing
2. Opens `data/v2.db`, runs all migrations (creates schema)
3. Executes `config/db-config.sql` — inserts all config rows with original IDs preserved
4. Prints summary of restored rows
5. Prints checklist of remaining manual steps (see below)

**IDs are preserved** — agent group IDs in `CLAUDE.local.md` cross-references stay valid.

## Manual Steps (Always Required on Fresh Machine)

These cannot be automated — they require external setup or secret files:

1. Install and start OneCLI daemon; add Anthropic API key to vault
2. Copy `.env` to the new machine (contains `DISCORD_BOT_TOKEN`, `OBSIDIAN_API_KEY`, etc.)
3. Confirm Discord bot is invited to your server
4. `bun install` inside any group folders that have `package.json` (currently: `groups/vault-agent/`)
5. Start the nanoclaw service (`launchctl load` / `systemctl --user start`)

The restore script prints this checklist after completing the DB restore.

## `.env.example` Updates

Add placeholder entries for all MCP-referenced secrets so the file documents what's needed:

```bash
ONECLI_URL=http://127.0.0.1:10254
TZ=America/New_York
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
OBSIDIAN_API_KEY=
```

## Save Agent — Remove Direct Obsidian Access

`groups/save/CLAUDE.local.md` currently has the Obsidian API key hardcoded in a `curl` command. Since `CLAUDE.local.md` is being committed to git, this must be fixed before committing.

**Fix:** Remove the direct curl from save agent's instructions. Save agent sends a `CLIPPING_SAVE` message to vault-agent instead. Vault-agent already owns the CLIPPING_SAVE protocol in its `CLAUDE.local.md` and handles the write via the obsidian MCP server. Save agent never touches Obsidian credentials.

Updated save agent flow:
```
user message → save agent → formats CLIPPING_SAVE → sends to vault-agent → vault-agent writes via MCP
```

Save agent replies `✓` after receiving confirmation from vault-agent. This is already the intended architecture — vault-agent's `CLAUDE.local.md` documents the CLIPPING_SAVE protocol it receives from save.

## Migration (One-Time, Current Machine)

1. Update vault-agent container config: `ncl groups config remove-mcp-server --name obsidian`, then `ncl groups config add-mcp-server` with the same config but `OBSIDIAN_API_KEY` value set to `$OBSIDIAN_API_KEY`
2. Add `OBSIDIAN_API_KEY=<actual-value>` to `.env`
3. Update `groups/save/CLAUDE.local.md` — remove the direct curl block, replace with agent-to-agent delegation to vault-agent using the CLIPPING_SAVE protocol
4. Update `.gitignore` per above
5. Write and run `scripts/export-config.ts` → generates `config/db-config.sql`
6. Write `scripts/restore-config.ts`
7. Update `.env.example` with placeholders
8. Commit: `config/db-config.sql`, `groups/*/CLAUDE.local.md`, `groups/vault-agent/obsidian-mcp.ts` + friends, both scripts, updated `.gitignore`, updated `.env.example`
9. Verify: send a test message to save agent, confirm vault-agent writes the note, confirm no credentials appear in any committed file

## Files Changed

| File | Change |
|---|---|
| `src/container-config.ts` | Add `$VAR` resolution in `materializeContainerJson()` |
| `src/env.ts` | No change — `readEnvFile()` is already correct |
| `.gitignore` | Replace `groups/*` + `**/CLAUDE.local.md` with surgical rules |
| `.env.example` | Add MCP secret placeholders |
| `scripts/export-config.ts` | New — DB config snapshot |
| `scripts/restore-config.ts` | New — fresh machine restore |
| `config/db-config.sql` | New — committed config baseline (generated) |
