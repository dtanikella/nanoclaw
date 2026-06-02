---
name: obsidian-vault-agent
description: Design spec for a dedicated NanoClaw agent group that reads and writes an Obsidian vault via the Local REST API plugin
date: 2026-06-02
status: approved
---

# Obsidian Vault Agent — Design Spec

## Overview

A dedicated NanoClaw agent group (`vault-agent`) that can read, write, search, and query an Obsidian vault running on the same Mac. The agent communicates with Obsidian through the Local REST API plugin via a custom MCP server (`obsidian-mcp.ts`) that lives in the agent group folder.

No image rebuild is required — the MCP server is a Bun script in `groups/vault-agent/`, which is mounted into every container session at `/workspace/agent/`.

---

## Components

### 1. `groups/vault-agent/obsidian-mcp.ts`

A Bun MCP server (~250 lines) using `@modelcontextprotocol/sdk`. Spawned by the container as a stdio subprocess:

```
command: bun
args: ["/workspace/agent/obsidian-mcp.ts"]
env: { OBSIDIAN_API_KEY: "<key>", OBSIDIAN_HOST: "https://host.docker.internal:27124" }
```

Reads `OBSIDIAN_API_KEY` and `OBSIDIAN_HOST` from env at startup. All HTTP calls go to `OBSIDIAN_HOST` with `Authorization: Bearer <key>`.

The Local REST API plugin uses a self-signed TLS certificate by default. Bun rejects this unless TLS verification is disabled. The MCP server sets `NODE_TLS_REJECT_UNAUTHORIZED=0` via env, or uses Bun's `tls: { rejectUnauthorized: false }` fetch option. The HTTP (port 27123) variant avoids this entirely if the user enables it in the plugin settings.

### 2. `groups/vault-agent/CLAUDE.md`

Agent personality stub. The user fills in vault-specific context: folder structure, frontmatter schema, note conventions, standing instructions (e.g. "always add a `created` date to new notes").

### 3. Central DB config (via `ncl`)

MCP server wired into the `vault-agent` group config. API key stored plaintext in the `env` field of the MCP server config — acceptable for a personal install.

---

## MCP Tools

| Tool | REST Endpoint | Purpose |
|---|---|---|
| `vault_read(path)` | `GET /vault/{path}` | Read note content |
| `vault_write(path, content)` | `PUT /vault/{path}` | Create or overwrite a note |
| `vault_append(path, content)` | `POST /vault/{path}` | Append to an existing note |
| `vault_delete(path)` | `DELETE /vault/{path}` | Delete a note |
| `vault_list(folder?)` | `GET /vault/{folder}/` | List files in a folder (or vault root) |
| `vault_search(query)` | `POST /search/simple/` | Full-text search across vault |
| `vault_query(dql)` | `POST /search/` | Dataview DQL — filter by frontmatter, tags, dates, etc. |
| `vault_get_active()` | `GET /active/` | Get the file currently open in Obsidian |

`vault_query` uses `Content-Type: application/vnd.olrapi.dataview.dql+txt` and requires the Dataview plugin to be installed in Obsidian.

---

## Data Flow

```
User message
  → channel adapter
  → host routes to vault-agent session
  → container wakes
  → container spawns obsidian-mcp.ts as stdio MCP subprocess
  → Claude calls vault_* tools as needed
  → obsidian-mcp.ts → HTTPS → host.docker.internal:27124 → Obsidian REST API
  → Claude processes results, writes response to outbound.db
  → host delivers through channel
```

---

## Error Handling & Retry

### Failure taxonomy

| Failure | HTTP status | Retryable | Behavior |
|---|---|---|---|
| Obsidian not running / REST API unreachable | network error | Yes | Notify user + schedule retry in 1 hour |
| Wrong API key | 401 | No | Tell user to check API key in MCP server config |
| Note not found | 404 | No | Tell user the note doesn't exist |
| Bad DQL query | 400 | No | Claude self-corrects and retries the query immediately |

### Retry mechanism

The MCP server returns a structured error with `retryable: true` on connection failures. The vault-agent CLAUDE.md instructs Claude: when a tool returns a retryable error, send the user a message explaining what happened, then call `schedule_task` with the original user request as the prompt and `processAfter` = now + 1 hour.

The scheduling flow uses the existing NanoClaw task infrastructure:

1. Claude calls `schedule_task` → writes a `system` action to `outbound.db`
2. Host delivery loop reads `outbound.db`, writes a `task` row to `inbound.db` with `process_after` = +1 hour
3. Host sweep (runs every 60s) wakes the container when `process_after <= now`
4. Container re-processes the original request; if Obsidian is now running, it succeeds

No new mechanisms required — this is standard NanoClaw task scheduling.

---

## Setup Sequence

### Prerequisites

- Obsidian running on the same Mac
- **Local REST API** plugin installed and enabled in Obsidian (Settings → Local REST API). Note the API key.
- **Dataview** plugin installed and enabled in Obsidian.

### Steps

```bash
# 1. Create the agent group
ncl groups create --name vault-agent

# 2. Copy the MCP server into the group folder
cp obsidian-mcp.ts groups/vault-agent/

# 3. Wire the MCP server (replace <group-id> and <your-key>)
ncl groups config add-mcp-server \
  --id <group-id> \
  --name obsidian \
  --command bun \
  --args '["/workspace/agent/obsidian-mcp.ts"]' \
  --env '{"OBSIDIAN_API_KEY":"<your-key>","OBSIDIAN_HOST":"https://host.docker.internal:27124"}'

# 4. Wire a channel to the agent group
ncl wirings create --messaging-group-id <mg-id> --agent-group-id <group-id>
```

Then edit `groups/vault-agent/CLAUDE.md` to describe your vault structure and conventions.

---

## Files to Create

| File | Description |
|---|---|
| `groups/vault-agent/obsidian-mcp.ts` | MCP server — the main deliverable |
| `groups/vault-agent/CLAUDE.md` | Agent personality stub (user fills in vault context) |

No changes to host code, container image, or DB schema.
