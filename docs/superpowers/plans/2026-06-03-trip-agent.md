# Trip Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a script-only NanoClaw agent that logs Discord trip-channel messages to a Google Sheet without invoking an LLM.

**Architecture:** A custom entrypoint feature is added to `container_configs` so per-group agents can replace the default agent-runner poll loop. The trip agent uses this to run a lightweight TypeScript processor that polls `inbound.db`, extracts URLs, appends rows to Google Sheets via the `googleapis` npm package, and writes confirmation replies to `outbound.db`. No Claude API calls — zero token cost.

**Tech Stack:** TypeScript (Bun runtime), `googleapis` npm package, `bun:sqlite`, NanoClaw container infrastructure

**Spec:** `docs/superpowers/specs/2026-06-03-trip-agent-design.md`

---

## File Structure

### New files (host-side — Node/better-sqlite3)

| File | Responsibility |
|------|---------------|
| `src/db/migrations/016-custom-entrypoint.ts` | DB migration: add `custom_entrypoint` column to `container_configs` |
| `src/db/migrations/016-custom-entrypoint.test.ts` | Migration test |

### Modified files (host-side)

| File | Change |
|------|--------|
| `src/db/migrations/index.ts` | Register migration016 |
| `src/types.ts` | Add `custom_entrypoint` to `ContainerConfigRow` |
| `src/container-runner.ts` | Use `custom_entrypoint` when set (1 line change) |
| `src/container-config.ts` | Pass `customEntrypoint` through to `ContainerConfig` |
| `src/db/container-configs.ts` | Add `custom_entrypoint` to `SCALAR_COLUMNS` |
| `.gitignore` | Add `**/service-account.json` pattern |

### New files (trip agent — Bun runtime)

| File | Responsibility |
|------|---------------|
| `groups/trip-agent/trip-src/index.ts` | Entry point: load config, run poll loop |
| `groups/trip-agent/trip-src/poll-loop.ts` | Custom poll loop: poll → parse → log → reply |
| `groups/trip-agent/trip-src/url-parser.ts` | URL extraction + domain parsing |
| `groups/trip-agent/trip-src/url-parser.test.ts` | URL parser unit tests |
| `groups/trip-agent/trip-src/sheets.ts` | Google Sheets API wrapper (append row) |
| `groups/trip-agent/trip-src/sheets.test.ts` | Sheets wrapper unit tests |
| `groups/trip-agent/trip-config.json` | Sheet ID + tab name config (placeholder) |
| `groups/trip-agent/CLAUDE.md` | Minimal stub (group scaffold requirement) |

---

## Task 1: URL Parser Module

**Files:**
- Create: `groups/trip-agent/trip-src/url-parser.ts`
- Create: `groups/trip-agent/trip-src/url-parser.test.ts`

- [x] **Step 1: Write the failing tests**

```typescript
// groups/trip-agent/trip-src/url-parser.test.ts
import { describe, test, expect } from 'bun:test';
import { extractUrls, extractDomains } from './url-parser.js';

describe('extractUrls', () => {
  test('extracts https URLs', () => {
    expect(extractUrls('Check out https://booking.com/hotel-123')).toEqual([
      'https://booking.com/hotel-123',
    ]);
  });

  test('extracts http URLs', () => {
    expect(extractUrls('Visit http://example.com/page')).toEqual([
      'http://example.com/page',
    ]);
  });

  test('extracts multiple URLs', () => {
    expect(
      extractUrls('Hotels: https://booking.com/h1 and flights: https://kayak.com/flights'),
    ).toEqual(['https://booking.com/h1', 'https://kayak.com/flights']);
  });

  test('extracts www. URLs without protocol', () => {
    expect(extractUrls('Check www.booking.com/hotel')).toEqual([
      'www.booking.com/hotel',
    ]);
  });

  test('returns empty array for no URLs', () => {
    expect(extractUrls('Just a regular message')).toEqual([]);
  });

  test('strips trailing punctuation', () => {
    expect(extractUrls('Visit https://example.com/page.')).toEqual([
      'https://example.com/page',
    ]);
    expect(extractUrls('See https://example.com/page, then go')).toEqual([
      'https://example.com/page',
    ]);
  });

  test('handles URLs in angle brackets', () => {
    expect(extractUrls('Link: <https://example.com/page>')).toEqual([
      'https://example.com/page',
    ]);
  });
});

describe('extractDomains', () => {
  test('extracts domain from https URL', () => {
    expect(extractDomains(['https://booking.com/hotel-123'])).toEqual([
      'booking.com',
    ]);
  });

  test('strips www. prefix', () => {
    expect(extractDomains(['https://www.booking.com/hotel'])).toEqual([
      'booking.com',
    ]);
  });

  test('handles www. URL without protocol', () => {
    expect(extractDomains(['www.booking.com/hotel'])).toEqual([
      'booking.com',
    ]);
  });

  test('deduplicates domains', () => {
    expect(
      extractDomains([
        'https://booking.com/h1',
        'https://booking.com/h2',
        'https://kayak.com/f1',
      ]),
    ).toEqual(['booking.com', 'kayak.com']);
  });

  test('returns empty array for no URLs', () => {
    expect(extractDomains([])).toEqual([]);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd groups/trip-agent/trip-src && bun test url-parser.test.ts`
Expected: FAIL — module `./url-parser.js` not found

- [x] **Step 3: Write the implementation**

```typescript
// groups/trip-agent/trip-src/url-parser.ts

const URL_PATTERN = /https?:\/\/[^\s<>"]+|(?:www\.)[^\s<>"]+/gi;
const TRAILING_PUNCT = /[.,;:!?)}\]]+$/;

/**
 * Extract URLs from a message string.
 * Matches http://, https://, and www. prefixed URLs.
 * Strips trailing punctuation that's likely not part of the URL.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  return matches.map((url) => url.replace(TRAILING_PUNCT, ''));
}

/**
 * Extract unique domains from a list of URLs.
 * Strips www. prefix for cleanliness.
 */
export function extractDomains(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of urls) {
    try {
      const normalized = raw.startsWith('http') ? raw : `https://${raw}`;
      let hostname = new URL(normalized).hostname;
      hostname = hostname.replace(/^www\./, '');
      if (!seen.has(hostname)) {
        seen.add(hostname);
        result.push(hostname);
      }
    } catch {
      // Skip malformed URLs
    }
  }

  return result;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd groups/trip-agent/trip-src && bun test url-parser.test.ts`
Expected: All tests PASS

- [x] **Step 5: Commit**

```bash
git add groups/trip-agent/trip-src/url-parser.ts groups/trip-agent/trip-src/url-parser.test.ts
git commit -m "feat(trip-agent): add URL parser module

Extracts URLs (http/https/www) from message text and parses
unique domains. Strips trailing punctuation and www. prefix.

Refs: #2"
```

---

## Task 2: Google Sheets API Wrapper

**Files:**
- Create: `groups/trip-agent/trip-src/sheets.ts`
- Create: `groups/trip-agent/trip-src/sheets.test.ts`

- [x] **Step 1: Write the failing tests**

```typescript
// groups/trip-agent/trip-src/sheets.test.ts
import { describe, test, expect } from 'bun:test';
import { formatRow } from './sheets.js';

describe('formatRow', () => {
  test('formats a message with URLs into a sheet row', () => {
    const row = formatRow(
      'Check out https://booking.com/hotel-123',
      ['https://booking.com/hotel-123'],
      ['booking.com'],
    );
    expect(row).toHaveLength(4);
    expect(row[0]).toBe('Check out https://booking.com/hotel-123');
    expect(row[1]).toBe('https://booking.com/hotel-123');
    expect(row[2]).toBe('booking.com');
    // row[3] is a timestamp — verify ISO format
    expect(row[3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('formats a message with no URLs', () => {
    const row = formatRow('Just chatting', [], []);
    expect(row[0]).toBe('Just chatting');
    expect(row[1]).toBe('');
    expect(row[2]).toBe('');
    expect(row[3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('comma-separates multiple URLs and domains', () => {
    const row = formatRow(
      'Two links',
      ['https://a.com/1', 'https://b.com/2'],
      ['a.com', 'b.com'],
    );
    expect(row[1]).toBe('https://a.com/1, https://b.com/2');
    expect(row[2]).toBe('a.com, b.com');
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd groups/trip-agent/trip-src && bun test sheets.test.ts`
Expected: FAIL — module `./sheets.js` not found

- [x] **Step 3: Write the implementation**

```typescript
// groups/trip-agent/trip-src/sheets.ts
import { google } from 'googleapis';
import fs from 'fs';

const SERVICE_ACCOUNT_PATH = '/workspace/agent/service-account.json';

/**
 * Format a row for the trip log sheet.
 * Columns: raw_content | url(s) | domain(s) | created_at
 */
export function formatRow(
  rawContent: string,
  urls: string[],
  domains: string[],
): string[] {
  return [
    rawContent,
    urls.join(', '),
    domains.join(', '),
    new Date().toISOString(),
  ];
}

/**
 * Append a row to a Google Sheet tab.
 * Uses a service account JSON key mounted into the container.
 */
export async function appendRow(
  sheetId: string,
  tabName: string,
  row: string[],
): Promise<void> {
  const keyFile = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!A:D`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row],
    },
  });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd groups/trip-agent/trip-src && bun test sheets.test.ts`
Expected: `formatRow` tests PASS (the `appendRow` function is integration-tested manually since it requires real credentials)

- [x] **Step 5: Commit**

```bash
git add groups/trip-agent/trip-src/sheets.ts groups/trip-agent/trip-src/sheets.test.ts
git commit -m "feat(trip-agent): add Google Sheets API wrapper

formatRow builds the 4-column row (raw_content, urls, domains,
created_at). appendRow calls the Sheets API with service account
auth to append a row to the configured tab.

Refs: #2"
```

---

## Task 3: Custom Entrypoint — DB Migration

**Files:**
- Create: `src/db/migrations/016-custom-entrypoint.ts`
- Modify: `src/db/migrations/index.ts`
- Modify: `src/types.ts`
- Modify: `src/db/container-configs.ts`

- [x] **Step 1: Write the migration**

```typescript
// src/db/migrations/016-custom-entrypoint.ts
import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration016: Migration = {
  version: 16,
  name: 'custom-entrypoint',
  up(db: Database.Database) {
    db.prepare('ALTER TABLE container_configs ADD COLUMN custom_entrypoint TEXT').run();
  },
};
```

- [x] **Step 2: Register the migration in the barrel**

Modify `src/db/migrations/index.ts` — add import and entry:

```typescript
// Add import after line 14:
import { migration016 } from './016-custom-entrypoint.js';

// Add to migrations array after migration015 (line 38):
  migration016,
```

- [x] **Step 3: Add to ContainerConfigRow type**

Modify `src/types.ts` — add field to `ContainerConfigRow` (after `cli_scope` on line 27):

```typescript
  custom_entrypoint: string | null;
```

- [x] **Step 4: Add to SCALAR_COLUMNS in container-configs.ts**

Modify `src/db/container-configs.ts` line 4-12 — add `'custom_entrypoint'` to the `SCALAR_COLUMNS` set:

```typescript
const SCALAR_COLUMNS = new Set([
  'provider',
  'model',
  'effort',
  'image_tag',
  'assistant_name',
  'max_messages_per_prompt',
  'cli_scope',
  'custom_entrypoint',
]);
```

- [x] **Step 5: Build to verify compilation**

Run: `pnpm run build`
Expected: Successful compilation with no type errors

- [x] **Step 6: Commit**

```bash
git add src/db/migrations/016-custom-entrypoint.ts src/db/migrations/index.ts src/types.ts src/db/container-configs.ts
git commit -m "feat: add custom_entrypoint to container_configs

DB migration 016 adds a nullable custom_entrypoint column to
container_configs. When set, the container runner uses this
command instead of the default agent-runner entry point.

Enables script-only agents that bypass the LLM entirely.

Refs: #2"
```

---

## Task 4: Custom Entrypoint — Container Runner + Config

**Files:**
- Modify: `src/container-runner.ts` (line 462)
- Modify: `src/container-config.ts`

- [x] **Step 1: Add customEntrypoint to ContainerConfig interface**

Modify `src/container-config.ts` — add field to the `ContainerConfig` interface (after `effort?` on line 46):

```typescript
  customEntrypoint?: string;
```

- [x] **Step 2: Pass customEntrypoint through configFromDb**

Modify `src/container-config.ts` `configFromDb` function — add after the `effort` line in the return object:

```typescript
    customEntrypoint: row.custom_entrypoint ?? undefined,
```

- [x] **Step 3: Use custom entrypoint in container-runner.ts**

Modify `src/container-runner.ts` line 462 — replace the hardcoded entrypoint:

```typescript
  // Replace:
  args.push('-c', 'exec bun run /app/src/index.ts');
  // With:
  const entrypoint = containerConfig.customEntrypoint || 'bun run /app/src/index.ts';
  args.push('-c', `exec ${entrypoint}`);
```

- [x] **Step 4: Build to verify compilation**

Run: `pnpm run build`
Expected: Successful compilation

- [x] **Step 5: Run existing tests**

Run: `pnpm test`
Expected: All existing tests pass (the change is backward-compatible — default behavior unchanged)

- [x] **Step 6: Commit**

```bash
git add src/container-runner.ts src/container-config.ts
git commit -m "feat: support custom_entrypoint in container runner

When container_configs.custom_entrypoint is set, the container
uses that command instead of the default bun run /app/src/index.ts.
Falls back to the default when unset — fully backward-compatible.

Refs: #2"
```

---

## Task 5: Trip Agent Poll Loop

**Files:**
- Create: `groups/trip-agent/trip-src/poll-loop.ts`

This is the core of the trip agent — a simplified version of the default poll loop that processes messages without calling an LLM.

- [x] **Step 1: Write the poll loop**

```typescript
// groups/trip-agent/trip-src/poll-loop.ts
/**
 * Trip agent poll loop — processes messages without an LLM.
 *
 * Polls inbound.db, extracts URLs from messages, appends rows to
 * a Google Sheet, and writes a "✅ Logged" confirmation to outbound.db.
 *
 * Imports DB utilities from the shared agent-runner at /app/src/.
 */
import {
  getPendingMessages,
  markProcessing,
  markCompleted,
} from '/app/src/db/messages-in.js';
import { writeMessageOut } from '/app/src/db/messages-out.js';
import {
  touchHeartbeat,
  clearStaleProcessingAcks,
} from '/app/src/db/connection.js';
import { extractRouting } from '/app/src/formatter.js';
import { extractUrls, extractDomains } from './url-parser.js';
import { formatRow, appendRow } from './sheets.js';

const POLL_INTERVAL_MS = 1000;

export interface TripConfig {
  sheetId: string;
  tabName: string;
}

function log(msg: string): void {
  console.error(`[trip-agent] ${msg}`);
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseContent(json: string): { text?: string; sender?: string } {
  try {
    const parsed = JSON.parse(json);
    return {
      text: parsed.text || '',
      sender: parsed.sender || parsed.author?.fullName || parsed.author?.userName || 'Unknown',
    };
  } catch {
    return { text: json };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTripPollLoop(config: TripConfig): Promise<void> {
  log(`Starting trip agent (sheet: ${config.sheetId}, tab: ${config.tabName})`);

  clearStaleProcessingAcks();

  let pollCount = 0;
  let isFirstPoll = true;

  while (true) {
    const messages = getPendingMessages(isFirstPoll).filter(
      (m) => m.kind !== 'system',
    );
    isFirstPoll = false;
    pollCount++;

    if (pollCount % 30 === 0) {
      touchHeartbeat();
      log(`Poll heartbeat (${pollCount} iterations)`);
    }

    if (messages.length === 0) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Only process if there's at least one trigger message
    if (!messages.some((m) => m.trigger === 1)) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const ids = messages.map((m) => m.id);
    markProcessing(ids);

    const routing = extractRouting(messages);

    for (const msg of messages) {
      const content = parseContent(msg.content);
      const text = content.text || '';

      // Skip empty messages
      if (!text.trim()) continue;

      const urls = extractUrls(text);
      const domains = extractDomains(urls);
      const row = formatRow(text, urls, domains);

      try {
        await appendRow(config.sheetId, config.tabName, row);
        log(`Logged message (${urls.length} URL(s)): ${text.slice(0, 80)}`);

        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({ text: '✅ Logged' }),
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log(`Error logging to sheet: ${errMsg}`);

        writeMessageOut({
          id: generateId(),
          kind: 'chat',
          platform_id: routing.platformId,
          channel_type: routing.channelType,
          thread_id: routing.threadId,
          content: JSON.stringify({
            text: `❌ Failed to log: ${errMsg}`,
          }),
        });
      }
    }

    markCompleted(ids);
    touchHeartbeat();
  }
}
```

- [x] **Step 2: Commit**

```bash
git add groups/trip-agent/trip-src/poll-loop.ts
git commit -m "feat(trip-agent): add custom poll loop

Simplified poll loop that processes messages without an LLM.
Polls inbound.db, extracts URLs, appends to Google Sheets,
writes confirmation reply to outbound.db.

Refs: #2"
```

---

## Task 6: Trip Agent Entry Point + Config Files

**Files:**
- Create: `groups/trip-agent/trip-src/index.ts`
- Create: `groups/trip-agent/trip-config.json`
- Create: `groups/trip-agent/CLAUDE.md`
- Modify: `.gitignore`

- [x] **Step 1: Write the entry point**

```typescript
// groups/trip-agent/trip-src/index.ts
/**
 * Trip Agent — entry point.
 *
 * Script-only NanoClaw agent that logs Discord messages to a Google Sheet.
 * No LLM — reads config, runs the poll loop.
 */
import fs from 'fs';
import type { TripConfig } from './poll-loop.js';
import { runTripPollLoop } from './poll-loop.js';

const CONFIG_PATH = '/workspace/agent/trip-config.json';

function log(msg: string): void {
  console.error(`[trip-agent] ${msg}`);
}

function loadTripConfig(): TripConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!raw.sheetId) throw new Error('sheetId is required in trip-config.json');
    return {
      sheetId: raw.sheetId,
      tabName: raw.tabName || 'Sheet1',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Failed to load trip config from ${CONFIG_PATH}: ${msg}`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  log('Starting trip agent');
  const config = loadTripConfig();
  log(`Config loaded: sheetId=${config.sheetId}, tabName=${config.tabName}`);
  await runTripPollLoop(config);
}

main().catch((err) => {
  log(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
```

- [x] **Step 2: Create trip-config.json placeholder**

```json
{
  "sheetId": "REPLACE_WITH_YOUR_GOOGLE_SHEET_ID",
  "tabName": "Sheet1"
}
```

- [x] **Step 3: Create minimal CLAUDE.md**

```markdown
# Trip Agent

Script-only agent — no LLM. Logs messages to Google Sheets.
```

- [x] **Step 4: Add service-account.json to .gitignore**

Add this line to `.gitignore`:

```
**/service-account.json
```

- [x] **Step 5: Commit**

```bash
git add groups/trip-agent/trip-src/index.ts groups/trip-agent/trip-config.json groups/trip-agent/CLAUDE.md .gitignore
git commit -m "feat(trip-agent): add entry point and config files

Entry point loads trip-config.json (sheetId + tabName) and
starts the poll loop. Placeholder config for the sheet ID.
Gitignore service-account.json files.

Refs: #2"
```

---

## Task 7: Agent Group Setup Script

This task creates the agent group in the central DB and configures it for the custom entrypoint. This is a runnable script, not committed code.

**Files:** None committed — interactive setup steps

- [ ] **Step 1: Create the agent group via ncl**

Run the following to create the trip-agent group and configure it:

```bash
# Create the agent group
pnpm exec tsx scripts/q.ts data/v2.db "INSERT INTO agent_groups (id, name, folder, created_at) VALUES ('trip-agent', 'Trip Agent', 'trip-agent', datetime('now'))"

# Ensure container config exists
pnpm exec tsx scripts/q.ts data/v2.db "INSERT OR IGNORE INTO container_configs (agent_group_id, updated_at) VALUES ('trip-agent', datetime('now'))"

# Set the custom entrypoint
pnpm exec tsx scripts/q.ts data/v2.db "UPDATE container_configs SET custom_entrypoint = 'bun run /workspace/agent/trip-src/index.ts', cli_scope = 'disabled' WHERE agent_group_id = 'trip-agent'"

# Add googleapis as an npm package (for per-group image build)
pnpm exec tsx scripts/q.ts data/v2.db "UPDATE container_configs SET packages_npm = '[\"googleapis\"]' WHERE agent_group_id = 'trip-agent'"
```

- [ ] **Step 2: Add yourself and Beth as members**

```bash
# Add Dhanu (replace discord handle with your actual Discord user ID)
pnpm exec tsx scripts/q.ts data/v2.db "INSERT OR IGNORE INTO agent_group_members (user_id, agent_group_id) VALUES ('discord:YOUR_DISCORD_ID', 'trip-agent')"

# Add Beth (replace with Beth's Discord user ID)
pnpm exec tsx scripts/q.ts data/v2.db "INSERT OR IGNORE INTO agent_group_members (user_id, agent_group_id) VALUES ('discord:BETH_DISCORD_ID', 'trip-agent')"
```

- [ ] **Step 3: Build the per-group container image**

This installs `googleapis` into a custom Docker image for this agent group:

```bash
# Restart the host to pick up the migration + new config
pnpm run build
# Then restart the service so it runs the migration
```

**Note:** The per-group image build (`buildAgentGroupImage`) is triggered by the self-mod `install_packages` flow. For initial setup, you can manually build:

```bash
# Verify the packages are set
pnpm exec tsx scripts/q.ts data/v2.db "SELECT packages_npm FROM container_configs WHERE agent_group_id = 'trip-agent'"
```

- [ ] **Step 4: Wire a messaging group to the agent**

Create or find the messaging group for the `#trip-channel` Discord channel and wire it:

```bash
# List existing messaging groups to find the trip channel (or create one)
pnpm exec tsx scripts/q.ts data/v2.db "SELECT id, name, platform_id FROM messaging_groups WHERE channel_type = 'discord'"

# Create wiring: messaging group → agent group
# Replace MG_ID with the actual messaging group ID
pnpm exec tsx scripts/q.ts data/v2.db "INSERT INTO messaging_group_agents (messaging_group_id, agent_group_id, session_mode, priority, created_at) VALUES ('MG_ID', 'trip-agent', 'shared', 0, datetime('now'))"
```

---

## Task 8: Integration Test

**Files:** None committed — manual verification

- [ ] **Step 1: Place the service account key**

Copy your Google service account JSON key to `groups/trip-agent/service-account.json`.

- [ ] **Step 2: Update trip-config.json with real sheet ID**

Edit `groups/trip-agent/trip-config.json`:

```json
{
  "sheetId": "YOUR_ACTUAL_SHEET_ID",
  "tabName": "Sheet1"
}
```

- [ ] **Step 3: Send a test message in the trip channel**

Send a message in the Discord `#trip-channel`:

```
Check out this hotel https://booking.com/hotel-example
```

- [ ] **Step 4: Verify the Google Sheet**

Open the Google Sheet and confirm a new row appeared:

| raw_content | url | domain | created_at |
|---|---|---|---|
| Check out this hotel https://booking.com/hotel-example | https://booking.com/hotel-example | booking.com | 2026-06-04T... |

- [ ] **Step 5: Verify the confirmation reply**

Check that "✅ Logged" appeared in the Discord channel as a reply.

- [ ] **Step 6: Test a message with no URLs**

Send: `Let's plan the itinerary tomorrow`

Verify it still gets logged (with empty url/domain columns) and "✅ Logged" reply appears.

- [ ] **Step 7: Test a message with multiple URLs**

Send: `Hotels: https://booking.com/h1 and flights https://kayak.com/flights`

Verify the row has comma-separated URLs and domains.
