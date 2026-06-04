# Trip Agent — Design Spec

**Date:** 2026-06-03
**Issue:** [#2](https://github.com/dtanikella/nanoclaw/issues/2)
**Branch:** `trip-agent`

## Purpose

A script-only NanoClaw agent that passively logs every message from authorized members in a Discord trip-planning channel to a Google Sheet. No LLM invocation — pure TypeScript processing in a custom agent-runner overlay.

## Scope

**In scope (MVP):**
- Log every message from members in a trip channel to a Google Sheet
- Extract and log URLs and domains from messages
- Confirm logging with a "✅ Logged" text reply
- One channel per trip, sheet ID configured via a local config file

**Out of scope (future):**
- Onboarding flow for new trip channels ([#11](https://github.com/dtanikella/nanoclaw/issues/11))
- Categorization or summarization of logged entries
- Reading data back from the sheet
- Multi-tab or multi-sheet support within a single channel
- Bare domain detection (e.g., `booking.com/hotel` without `http://`)

## Architecture

```
Discord #trip-channel
  → NanoClaw host (router.ts)
  → inbound.db (member-gated via agent_group_members)
  → Container: custom poll-loop (agent-runner-src/ overlay)
    → Parse message, extract URLs, extract domains
    → Google Sheets API: append row (googleapis npm package)
    → outbound.db: write "✅ Logged" text reply
  → Host delivery: send reply to Discord channel
```

The trip agent uses NanoClaw's container infrastructure (access control, session DB, heartbeat, delivery) but replaces the LLM call entirely. A new `custom_entrypoint` field on `container_configs` tells the container runner to execute `bun run /workspace/agent/trip-src/index.ts` instead of the default agent-runner. The custom entry point runs a simplified poll loop that processes messages with pure TypeScript and writes results to `outbound.db`.

No Claude API tokens are consumed. No MCP servers are needed.

## Access Control

Handled entirely by NanoClaw's entity model — no custom filtering needed:

- **`agent_group_members`**: Only Dhanu and Beth are added as members of the trip agent group via `ncl members add`.
- **`messaging_groups.unknown_sender_policy`**: Set to `request_approval` (default). Messages from non-members are dropped or trigger an approval request.
- **`canAccessAgentGroup()`** in `src/modules/permissions/access.ts` enforces the gate: owner → global admin → scoped admin → member. Non-members are rejected at the router level, before the message ever reaches the container.

## Custom Entrypoint

A new `custom_entrypoint` column on `container_configs` (nullable TEXT) tells the container runner to use a different command instead of the default `bun run /app/src/index.ts`. The trip agent sets this to `bun run /workspace/agent/trip-src/index.ts` — its source files live in the agent group folder at `groups/trip-agent/trip-src/`, which is mounted RW at `/workspace/agent/trip-src/` in the container.

### Custom Poll Loop (`poll-loop.ts`)

Simplified version of the default poll loop. Follows the same DB contract:

1. Poll `inbound.db` for pending messages via `getPendingMessages()`
2. Skip non-trigger messages (same accumulate gate as default: `messages.some(m => m.trigger === 1)`)
3. For each triggered batch:
   a. `markProcessing(ids)` — claim the messages
   b. Parse message content → extract raw text
   c. Extract URLs via regex
   d. Extract domains via `new URL(url).hostname`
   e. Format row: `[raw_content, urls_comma_separated, domains_comma_separated, created_at_iso]`
   f. Call Google Sheets API to append the row
   g. Write "✅ Logged" text reply to `outbound.db` via `writeMessageOut()`
   h. `markCompleted(ids)` — release the messages
4. Touch heartbeat on schedule (reuse `touchHeartbeat()` from `db/connection.ts`)
5. No continuation/session state — stateless processor

**Error handling:**
- Google Sheets API failure: log the error, write an error message to `outbound.db` (user sees it in Discord), mark message completed (no infinite retry).
- Auth failure: same pattern — surface the error to the user.

### URL Parser (`url-parser.ts`)

**URL extraction patterns:**
- `https?://[^\s<>"]+` — standard HTTP/HTTPS URLs
- `(?:www\.)[^\s<>"]+` — URLs prefixed with `www.` but missing protocol

Bare domains without protocol or `www.` prefix (e.g., `booking.com/hotel`) are not matched to avoid false positives.

**Domain extraction:**
- `new URL(url).hostname` on each extracted URL
- Strip leading `www.` for cleanliness (e.g., `www.booking.com` → `booking.com`)

### Sheets API Wrapper (`sheets.ts`)

Thin wrapper around `googleapis` for appending a single row:

```typescript
appendRow(sheetId: string, tabName: string, row: string[]): Promise<void>
```

Internally calls `spreadsheets.values.append` with `valueInputOption: USER_ENTERED`.

## Google Sheet Schema

| Column | Header | Content | Example |
|--------|--------|---------|---------|
| A | raw_content | Full message text | "Check out this hotel https://booking.com/hotel-123" |
| B | url | Comma-separated URLs (empty if none) | "https://booking.com/hotel-123, https://kayak.com/flights" |
| C | domain | Comma-separated domains (empty if none) | "booking.com, kayak.com" |
| D | created_at | ISO 8601 timestamp | "2026-06-04T03:00:00.000Z" |

**Multi-URL messages:** URLs and domains are comma-separated in their respective cells. One row per message regardless of URL count.

**Messages with no URLs:** Still logged. URL and domain columns are empty strings.

## Google Sheets Authentication

Google service account JSON key file, mounted into the container from the host. The overlay reads it from a known path (`/workspace/agent/service-account.json`) and uses the `googleapis` library's `GoogleAuth` to authenticate directly — no OneCLI proxy needed for this (the Sheets API is called server-side with the service account, not through an HTTP gateway).

**Setup steps (manual, one-time):**
1. Create a GCP project and enable the Google Sheets API
2. Create a service account and download the JSON key file
3. Share the target Google Sheet with the service account email (Editor role)
4. Place the JSON key at `groups/trip-agent/service-account.json` (mounted into the container automatically as part of the agent group folder)

## Sheet ID Configuration

For MVP, the target sheet ID and tab name are stored in a static config file:

```json
// groups/trip-agent/trip-config.json
{
  "sheetId": "<google-sheet-id>",
  "tabName": "Sheet1"
}
```

This file is mounted into the container at `/workspace/agent/trip-config.json` (same path as other per-group files). The custom poll-loop reads it on startup.

The onboarding flow ([#11](https://github.com/dtanikella/nanoclaw/issues/11)) will automate sheet ID configuration per channel in a future iteration.

## Confirmation Delivery

On successful logging, the overlay writes a text reply to `outbound.db`:

```typescript
writeMessageOut({
  id: generateId(),
  kind: 'chat',
  platform_id: routing.platformId,
  channel_type: routing.channelType,
  thread_id: routing.threadId,
  content: JSON.stringify({ text: '✅ Logged' }),
});
```

This uses the existing delivery pipeline — no adapter changes needed. The host picks it up from `outbound.db` and delivers via the Discord adapter's `deliver()` method.

## File Layout

```
groups/trip-agent/
  CLAUDE.md                 — Minimal (group scaffold requirement)
  trip-config.json          — { "sheetId": "...", "tabName": "..." }
  service-account.json      — Google service account key (gitignored)
  trip-src/
    index.ts                — Entry point: load config, run poll loop
    poll-loop.ts            — Custom poll-loop (no LLM)
    sheets.ts               — Google Sheets API wrapper
    url-parser.ts           — URL extraction + domain parsing
    url-parser.test.ts      — Unit tests for URL parsing
```

## Container Config

Set via `ncl groups config update`:

- **`provider`**: `"claude"` (required field, but the custom entrypoint never invokes it)
- **`custom_entrypoint`**: `"bun run /workspace/agent/trip-src/index.ts"`
- **`packages_npm`**: `["googleapis"]` — installed in a per-group container image
- **`cli_scope`**: `"disabled"` — no ncl access needed
- **No MCP servers** — direct API calls from the trip source

## Dependencies

- `googleapis` npm package (added to container packages for this agent group)
- No new host-side dependencies

## Testing

- **`url-parser.test.ts`**: Unit tests for URL extraction and domain parsing (runs with `bun test` inside the container tree)
- **Manual integration test**: Send messages in a test Discord channel, verify rows appear in the Google Sheet
