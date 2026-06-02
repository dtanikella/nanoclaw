# MCP Secret Resolution + Git-Committable Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move MCP server API keys out of the database into `.env` via `$VAR` references, and make group configuration safely committable to git.

**Architecture:** Add a `resolveSecretRefs()` pure function to `src/container-config.ts` that replaces `$VAR` env values with values read from `.env` at spawn time. Update `.gitignore` to track `CLAUDE.local.md`, custom scripts, and a committed `config/db-config.sql` seed. Add export and restore scripts.

**Tech Stack:** TypeScript, better-sqlite3, vitest, Node.js

**Spec:** `docs/superpowers/specs/2026-06-02-onecli-mcp-git-config-design.md`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/container-config.ts` | Modify | Add `resolveSecretRefs()` + call in `materializeContainerJson()` |
| `src/container-config.test.ts` | Create | Tests for `resolveSecretRefs()` and `materializeContainerJson()` |
| `.gitignore` | Modify | Replace blanket `groups/*` with surgical rules; remove `**/CLAUDE.local.md` |
| `.env` | Modify | Add `OBSIDIAN_API_KEY=<actual-value>` |
| `.env.example` | Modify | Add placeholder entries for all secrets |
| `scripts/export-config.ts` | Create | Dump safe DB tables to `config/db-config.sql` |
| `scripts/restore-config.ts` | Create | Restore DB from `config/db-config.sql` on fresh machine |
| `config/db-config.sql` | Create (generated) | Committed config baseline — produced by export script |
| `groups/save/CLAUDE.local.md` | Modify | Remove hardcoded Obsidian API key; delegate to vault-agent |

---

## Task 1: Extract and test `resolveSecretRefs`

**Files:**
- Create: `src/container-config.test.ts`
- Modify: `src/container-config.ts`

- [ ] **Step 1: Create the test file with failing tests**

```typescript
// src/container-config.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSecretRefs, materializeContainerJson } from './container-config.js';

describe('resolveSecretRefs', () => {
  it('passes through non-$ values unchanged', () => {
    const servers = {
      myserver: {
        command: 'bun',
        env: { HOST: 'https://example.com', NO_PROXY: 'localhost' },
      },
    };
    expect(resolveSecretRefs(servers, {})).toEqual(servers);
  });

  it('resolves $VAR references from envVars map', () => {
    const servers = {
      myserver: {
        command: 'bun',
        env: { API_KEY: '$MY_SECRET', HOST: 'https://example.com' },
      },
    };
    const result = resolveSecretRefs(servers, { MY_SECRET: 'abc123' });
    expect(result.myserver.env).toEqual({ API_KEY: 'abc123', HOST: 'https://example.com' });
  });

  it('throws when $VAR is missing from envVars', () => {
    const servers = {
      myserver: { command: 'bun', env: { API_KEY: '$MISSING_SECRET' } },
    };
    expect(() => resolveSecretRefs(servers, {})).toThrow(
      'MCP server "myserver" references $MISSING_SECRET but it is not set in .env',
    );
  });

  it('handles servers with no env block', () => {
    const servers = { myserver: { command: 'bun' } };
    expect(resolveSecretRefs(servers, {})).toEqual(servers);
  });

  it('resolves refs across multiple servers', () => {
    const servers = {
      server1: { command: 'bun', env: { KEY: '$SECRET_A' } },
      server2: { command: 'node', env: { TOKEN: '$SECRET_B' } },
    };
    const result = resolveSecretRefs(servers, { SECRET_A: 'val-a', SECRET_B: 'val-b' });
    expect(result.server1.env?.KEY).toBe('val-a');
    expect(result.server2.env?.TOKEN).toBe('val-b');
  });

  it('does not mutate the original servers object', () => {
    const original = { s: { command: 'bun', env: { K: '$V' } } };
    resolveSecretRefs(original, { V: 'resolved' });
    expect(original.s.env?.K).toBe('$V');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (resolveSecretRefs not exported yet)**

```bash
pnpm test -- container-config
```

Expected: `Error: resolveSecretRefs is not a function` or similar import error.

- [ ] **Step 3: Add `resolveSecretRefs` to `src/container-config.ts`**

Add this function before `materializeContainerJson`. Also add the `readEnvFile` import at the top:

```typescript
// Add to imports at top of src/container-config.ts:
import { readEnvFile } from './env.js';
```

```typescript
// Add before materializeContainerJson() in src/container-config.ts:

/**
 * Resolve `$VAR` references in MCP server env blocks using values from .env.
 * Non-`$` values pass through unchanged. Throws if any $VAR is missing.
 */
export function resolveSecretRefs(
  servers: Record<string, McpServerConfig>,
  envVars: Record<string, string>,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      if (!server.env) return [name, server];
      const resolvedEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.env)) {
        if (!value.startsWith('$')) {
          resolvedEnv[key] = value;
          continue;
        }
        const varName = value.slice(1);
        if (!(varName in envVars)) {
          throw new Error(`MCP server "${name}" references $${varName} but it is not set in .env`);
        }
        resolvedEnv[key] = envVars[varName];
      }
      return [name, { ...server, env: resolvedEnv }];
    }),
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm test -- container-config
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/container-config.ts src/container-config.test.ts
git commit -m "feat: add resolveSecretRefs for MCP server $VAR env substitution"
```

---

## Task 2: Wire resolution into `materializeContainerJson`

**Files:**
- Modify: `src/container-config.ts`
- Modify: `src/container-config.test.ts`

- [ ] **Step 1: Add failing test for `materializeContainerJson` with `$VAR` refs**

`src/container-config.test.ts` needs module-level mocks (must be at file scope, not inside describe). Make three edits to the file:

**Edit 1 — update the top import line** (add `vi` and `beforeEach`; `materializeContainerJson` was already added in Task 1 Step 1):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

**Edit 2 — add these module-level declarations after the existing imports** (before any `describe` blocks):
```typescript
import fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(() => true), mkdirSync: vi.fn(), writeFileSync: vi.fn() };
});
vi.mock('./config.js', () => ({ GROUPS_DIR: '/fake/groups' }));

const mockGetContainerConfig = vi.fn();
vi.mock('./db/container-configs.js', () => ({
  getContainerConfig: (...args: unknown[]) => mockGetContainerConfig(...args),
}));

const mockGetAgentGroup = vi.fn();
vi.mock('./db/agent-groups.js', () => ({
  getAgentGroup: (...args: unknown[]) => mockGetAgentGroup(...args),
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn((keys: string[]) => Object.fromEntries(keys.map((k) => [k, `resolved-${k}`]))),
}));
```

**Edit 3 — append this describe block at the end of the file**:
```typescript
describe('materializeContainerJson', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves $VAR refs in MCP server env before writing container.json', () => {
    mockGetAgentGroup.mockReturnValue({ id: 'ag-1', name: 'test', folder: 'test-group' });
    mockGetContainerConfig.mockReturnValue({
      mcp_servers: JSON.stringify({
        myserver: { command: 'bun', env: { API_KEY: '$MY_SECRET', HOST: 'https://example.com' } },
      }),
      packages_apt: '[]',
      packages_npm: '[]',
      additional_mounts: '[]',
      skills: '"all"',
      provider: null,
      assistant_name: null,
      max_messages_per_prompt: null,
      model: null,
      effort: null,
      image_tag: null,
      cli_scope: 'group',
    });

    materializeContainerJson('ag-1');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.myserver.env.API_KEY).toBe('resolved-MY_SECRET');
    expect(parsed.mcpServers.myserver.env.HOST).toBe('https://example.com');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (resolution not wired yet)**

```bash
pnpm test -- container-config
```

Expected: the `materializeContainerJson` test fails because `API_KEY` is still `'$MY_SECRET'` in the output.

- [ ] **Step 3: Wire resolution into `materializeContainerJson`**

Replace the body of `materializeContainerJson` in `src/container-config.ts`:

```typescript
export function materializeContainerJson(agentGroupId: string): ContainerConfig {
  const group = getAgentGroup(agentGroupId);
  if (!group) throw new Error(`Agent group not found: ${agentGroupId}`);

  const row = getContainerConfig(agentGroupId);
  if (!row) throw new Error(`Container config not found for agent group: ${agentGroupId}`);

  const config = configFromDb(row, group);

  const varNames = Object.values(config.mcpServers).flatMap((s) =>
    Object.values(s.env ?? {})
      .filter((v) => v.startsWith('$'))
      .map((v) => v.slice(1)),
  );
  if (varNames.length > 0) {
    const envVars = readEnvFile(varNames);
    config.mcpServers = resolveSecretRefs(config.mcpServers, envVars);
  }

  const p = path.join(GROUPS_DIR, group.folder, 'container.json');
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');

  return config;
}
```

- [ ] **Step 4: Run all tests — expect PASS**

```bash
pnpm test
```

Expected: all tests pass including the new `materializeContainerJson` test.

- [ ] **Step 5: Commit**

```bash
git add src/container-config.ts src/container-config.test.ts
git commit -m "feat: resolve \$VAR refs in MCP server env at container spawn time"
```

---

## Task 3: Migrate vault-agent MCP config to use `$OBSIDIAN_API_KEY`

**Files:**
- Modify: `.env` (not committed — local only)

- [ ] **Step 1: Add `OBSIDIAN_API_KEY` to `.env`**

Open `.env` and add this line (replace `<actual-key>` with the real value — currently the key is `5552284e2acc544a005bdea18df344730a96e9a05421193a8e84b24af4523ab4`):

```bash
OBSIDIAN_API_KEY=5552284e2acc544a005bdea18df344730a96e9a05421193a8e84b24af4523ab4
```

- [ ] **Step 2: Update vault-agent container config in DB to use `$OBSIDIAN_API_KEY`**

Run this script once to replace the hardcoded key with a `$VAR` reference:

```bash
pnpm exec tsx -e "
import Database from 'better-sqlite3';
import path from 'path';
const db = new Database(path.join(process.cwd(), 'data', 'v2.db'));
const newServers = JSON.stringify({
  obsidian: {
    command: 'bun',
    args: ['/workspace/agent/obsidian-mcp.ts'],
    env: {
      OBSIDIAN_API_KEY: '\$OBSIDIAN_API_KEY',
      OBSIDIAN_HOST: 'https://host.docker.internal:27124',
      NO_PROXY: 'host.docker.internal',
      no_proxy: 'host.docker.internal',
    },
  },
});
const r = db.prepare('UPDATE container_configs SET mcp_servers = ? WHERE agent_group_id = ?')
  .run(newServers, 'bfc8e020-717a-47e9-9701-0ce6be372009');
console.log(r.changes === 1 ? 'Updated vault-agent MCP config' : 'ERROR: no rows updated');
db.close();
"
```

Expected output: `Updated vault-agent MCP config`

- [ ] **Step 3: Verify the DB now has the `$VAR` reference (no real key)**

```bash
pnpm exec tsx scripts/q.ts data/v2.db "SELECT mcp_servers FROM container_configs WHERE agent_group_id='bfc8e020-717a-47e9-9701-0ce6be372009'"
```

Expected: output contains `$OBSIDIAN_API_KEY` and does NOT contain `5552284e2acc544a005bdea18df344730a96e9a05421193a8e84b24af4523ab4`.

- [ ] **Step 4: Verify `materializeContainerJson` resolves correctly**

Restart the service to trigger a fresh container spawn:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Then check the materialized `container.json` — it should have the real key, not the `$VAR` reference:

```bash
cat groups/vault-agent/container.json | grep OBSIDIAN_API_KEY
```

Expected: shows the real key value (not `$OBSIDIAN_API_KEY`).

---

## Task 4: Update `.gitignore` and `.env.example`

**Files:**
- Modify: `.gitignore`
- Modify: `.env.example`

- [ ] **Step 1: Update `.gitignore`**

Replace the groups and CLAUDE.local.md lines. Find and replace this block:

```
# Groups - per-installation state, not tracked
groups/*

# Composer-managed CLAUDE.md artifacts (regenerated every spawn) and
# per-group memory (CLAUDE.local.md) must never be committed.
**/CLAUDE.local.md
**/.claude-shared.md
**/.claude-fragments/
```

With:

```
# Groups — ignore derived/ephemeral/build artifacts; track everything else
groups/*/node_modules/
groups/*/container.json
groups/*/CLAUDE.md
groups/*/.claude-shared.md
groups/*/.claude-fragments/
groups/*/conversations/

# Composer-managed shared fragments (regenerated at spawn)
**/.claude-shared.md
**/.claude-fragments/
```

- [ ] **Step 2: Update `.env.example`**

The file is currently empty. Write the full template:

```bash
ONECLI_URL=http://127.0.0.1:10254
TZ=America/New_York
DISCORD_BOT_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
OBSIDIAN_API_KEY=
```

- [ ] **Step 3: Verify `git status` shows the right files now tracked**

```bash
git status
```

Expected: `groups/dm-with-dhanu/CLAUDE.local.md`, `groups/save/CLAUDE.local.md`, `groups/vault-agent/CLAUDE.local.md`, `groups/vault-agent/obsidian-mcp.ts`, `groups/vault-agent/obsidian-mcp.test.ts`, `groups/vault-agent/package.json`, `groups/vault-agent/bun.lock` appear as new untracked files.

Expected NOT to appear: `groups/*/container.json`, `groups/*/CLAUDE.md`, `groups/vault-agent/node_modules/`.

- [ ] **Step 4: Commit `.gitignore` and `.env.example`**

```bash
git add .gitignore .env.example
git commit -m "chore: track group files in git, remove blanket groups/* ignore"
```

---

## Task 5: Fix save agent's `CLAUDE.local.md`

**Files:**
- Modify: `groups/save/CLAUDE.local.md`

The current file has a hardcoded `OBSIDIAN_API_KEY` in a `curl` command at step 4. Replace the entire step 4 and the reply behavior section with vault-agent delegation.

- [ ] **Step 1: Replace steps 4 and 5 in `groups/save/CLAUDE.local.md`**

Find and replace this section:

```markdown
### 4. Write to Obsidian via bash

```bash
curl -sk --noproxy host.docker.internal \
  -X PUT \
  -H "Authorization: Bearer 5552284e2acc544a005bdea18df344730a96e9a05421193a8e84b24af4523ab4" \
  -H "Content-Type: text/markdown" \
  "https://host.docker.internal:27124/vault/notes/<filename>" \
  --data-binary @-
```

Host is always `https://host.docker.internal:27124`.

### 5. Reply behavior
- On **success** (HTTP 200/204): send `✓` to the source channel
- On **error**: send a one-line error message with the HTTP status
```

With:

```markdown
### 4. Delegate write to vault-agent

Send a message to the `vault-agent` destination with this exact format:

```
CLIPPING_SAVE
title: <filename without path or extension>
url: <URL or empty if none>
content: <full original message text, unmodified>
```

Wait for vault-agent's reply before responding to the source.

### 5. Reply behavior
- On **success** (vault-agent replies "Saved: ..."): send `✓` to the source channel
- On **error** (vault-agent replies with an error): forward the error as a one-line message
```

- [ ] **Step 2: Confirm the file contains no API key**

```bash
grep -i "bearer\|api.key\|5552284e" groups/save/CLAUDE.local.md
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add groups/save/CLAUDE.local.md
git commit -m "fix: save agent delegates to vault-agent, removes hardcoded Obsidian API key"
```

---

## Task 6: Write `scripts/export-config.ts`

**Files:**
- Create: `scripts/export-config.ts`
- Create: `config/db-config.sql` (generated)

- [ ] **Step 1: Create `scripts/export-config.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * Export safe DB config tables to config/db-config.sql.
 * Run this after any ncl change to keep the committed baseline current.
 * Re-run: pnpm exec tsx scripts/export-config.ts
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'v2.db');
const OUTPUT_PATH = path.join(process.cwd(), 'config', 'db-config.sql');

const EXPORT_TABLES = [
  'agent_groups',
  'container_configs',
  'messaging_groups',
  'messaging_group_agents',
  'agent_destinations',
  'user_roles',
] as const;

function sqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function exportTable(db: Database.Database, table: string): string {
  const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
  if (rows.length === 0) return `-- ${table}: (empty)\n`;
  const lines = [`-- ${table}`];
  for (const row of rows) {
    const cols = Object.keys(row)
      .map((c) => `"${c}"`)
      .join(', ');
    const vals = Object.values(row).map(sqlLiteral).join(', ');
    lines.push(`INSERT OR REPLACE INTO "${table}" (${cols}) VALUES (${vals});`);
  }
  return lines.join('\n') + '\n';
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(DB_PATH, { readonly: true });

  const chunks: string[] = [
    '-- NanoClaw config export\n',
    `-- Generated: ${new Date().toISOString()}\n`,
    '-- Restore with: pnpm exec tsx scripts/restore-config.ts\n\n',
  ];

  for (const table of EXPORT_TABLES) {
    chunks.push(exportTable(db, table) + '\n');
  }

  db.close();

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, chunks.join(''));

  console.log(`Exported to ${OUTPUT_PATH}`);
  console.log('Verify: grep the output for real secret values — none should appear.');
}

main();
```

- [ ] **Step 2: Run the export script**

```bash
pnpm exec tsx scripts/export-config.ts
```

Expected: `Exported to <path>/config/db-config.sql`

- [ ] **Step 3: Verify no secrets appear in the output**

```bash
grep -i "5552284e\|bearer\|bot.token\|DISCORD_BOT" config/db-config.sql
```

Expected: no output. If any secret appears, stop — the Task 3 migration did not complete correctly.

- [ ] **Step 4: Verify `$VAR` references appear correctly**

```bash
grep "OBSIDIAN_API_KEY" config/db-config.sql
```

Expected: shows `$OBSIDIAN_API_KEY` (the reference, not the real key).

- [ ] **Step 5: Commit**

```bash
git add scripts/export-config.ts config/db-config.sql
git commit -m "feat: add export-config script and initial db-config.sql seed"
```

---

## Task 7: Write `scripts/restore-config.ts`

**Files:**
- Create: `scripts/restore-config.ts`

- [ ] **Step 1: Create `scripts/restore-config.ts`**

```typescript
#!/usr/bin/env tsx
/**
 * Restore DB config from config/db-config.sql on a fresh machine.
 * Run after: git clone, pnpm install, pnpm build
 * Usage: pnpm exec tsx scripts/restore-config.ts
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { runMigrations } from '../src/db/migrations/index.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'v2.db');
const SEED_PATH = path.join(process.cwd(), 'config', 'db-config.sql');

function main() {
  if (!fs.existsSync(SEED_PATH)) {
    console.error(`Seed not found: ${SEED_PATH}`);
    console.error('Run scripts/export-config.ts on your source machine first.');
    process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  const sql = fs.readFileSync(SEED_PATH, 'utf-8');
  db.exec(sql);
  db.close();

  console.log('Config restored from config/db-config.sql\n');
  console.log('--- Remaining manual steps ---');
  console.log('1. Install and start OneCLI daemon; add Anthropic API key to vault');
  console.log('   onecli --help');
  console.log('2. Copy .env to this machine — needs: DISCORD_BOT_TOKEN, OBSIDIAN_API_KEY, ONECLI_URL, TZ');
  console.log('   (See .env.example for the full list of required variables)');
  console.log('3. Confirm Discord bot is invited to your server');
  console.log('4. Install group dependencies:');
  console.log('   cd groups/vault-agent && bun install && cd ../..');
  console.log('5. Build the host:');
  console.log('   pnpm run build');
  console.log('6. Build the agent container:');
  console.log('   ./container/build.sh');
  console.log('7. Start the service:');
  console.log('   launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist   # macOS');
  console.log('   systemctl --user start nanoclaw                            # Linux');
}

main();
```

- [ ] **Step 2: Test restore on a temp DB**

```bash
cp data/v2.db data/v2.db.bak && rm data/v2.db && pnpm exec tsx scripts/restore-config.ts
```

Expected: prints "Config restored" and the manual steps checklist. No errors.

- [ ] **Step 3: Verify DB was restored**

```bash
pnpm exec tsx scripts/q.ts data/v2.db "SELECT name FROM agent_groups"
```

Expected: shows `nano`, `Vault Agent`, `save` (same as before).

- [ ] **Step 4: Restore the original DB**

```bash
mv data/v2.db.bak data/v2.db
```

- [ ] **Step 5: Commit**

```bash
git add scripts/restore-config.ts
git commit -m "feat: add restore-config script for fresh machine setup"
```

---

## Task 8: Commit remaining tracked files and verify end-to-end

**Files:**
- Add to git: `groups/*/CLAUDE.local.md`, `groups/vault-agent/obsidian-mcp.ts`, `groups/vault-agent/obsidian-mcp.test.ts`, `groups/vault-agent/package.json`, `groups/vault-agent/bun.lock`

- [ ] **Step 1: Check what's now tracked but uncommitted**

```bash
git status
```

Expected untracked files (at minimum):
- `groups/dm-with-dhanu/CLAUDE.local.md`
- `groups/vault-agent/CLAUDE.local.md`
- `groups/vault-agent/obsidian-mcp.ts`
- `groups/vault-agent/obsidian-mcp.test.ts`
- `groups/vault-agent/package.json`
- `groups/vault-agent/bun.lock`

- [ ] **Step 2: Stage and commit group files**

```bash
git add groups/dm-with-dhanu/CLAUDE.local.md \
        groups/vault-agent/CLAUDE.local.md \
        groups/vault-agent/obsidian-mcp.ts \
        groups/vault-agent/obsidian-mcp.test.ts \
        groups/vault-agent/package.json \
        groups/vault-agent/bun.lock
git commit -m "chore: commit group CLAUDE.local.md and vault-agent MCP server files"
```

- [ ] **Step 3: Verify no secrets are in any committed file**

```bash
git grep -i "5552284e\|bot.token\|bearer" -- "*.md" "*.ts" "*.sql" "*.json"
```

Expected: no output.

- [ ] **Step 4: Push to fork**

```bash
git push origin main
```

- [ ] **Step 5: End-to-end verify — spawn vault-agent container**

Restart vault-agent to trigger `materializeContainerJson`:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Then check the materialized `container.json`:

```bash
cat groups/vault-agent/container.json | python3 -m json.tool | grep -A2 OBSIDIAN
```

Expected: `"OBSIDIAN_API_KEY": "5552284e2acc544a005bdea18df344730a96e9a05421193a8e84b24af4523ab4"` — the real value (resolved from `.env`), confirming resolution works.

- [ ] **Step 6: Verify container.json is not staged by git**

```bash
git status groups/vault-agent/
```

Expected: `container.json` does NOT appear (it is gitignored). Only `CLAUDE.local.md`, `obsidian-mcp.ts`, `obsidian-mcp.test.ts`, `package.json`, `bun.lock` are tracked.
