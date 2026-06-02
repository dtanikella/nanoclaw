# Obsidian Vault Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated NanoClaw agent group with a custom MCP server that reads, writes, searches, and queries an Obsidian vault via the Local REST API plugin.

**Architecture:** A Bun script (`obsidian-mcp.ts`) lives in `groups/vault-agent/` and is spawned as a stdio MCP subprocess by the container. It makes HTTP calls to `https://host.docker.internal:27124` (Obsidian's REST API). Since `groups/*` is gitignored, all files in this plan are local-only and created directly on disk — no git tracking.

**Tech Stack:** Bun, `@modelcontextprotocol/sdk@1.29.0`, Obsidian Local REST API plugin, Dataview plugin, bun:test

---

## File Map

| File | Status | Purpose |
|---|---|---|
| `groups/vault-agent/package.json` | Create | Declares `@modelcontextprotocol/sdk` dep for the MCP script |
| `groups/vault-agent/obsidian-mcp.ts` | Create | MCP server — HTTP client + 8 tool handlers + server bootstrap |
| `groups/vault-agent/obsidian-mcp.test.ts` | Create | Tests for `call()` and `handleTool()` |
| `groups/vault-agent/CLAUDE.md` | Create | Agent personality stub (user fills in vault details) |

`groups/vault-agent/node_modules/` is created by `bun install` and stays local.

---

## Task 1: Create the agent group and package.json

**Files:**
- Create: `groups/vault-agent/package.json`

- [ ] **Step 1: Create the agent group via ncl**

```bash
ncl groups create --name "Vault Agent" --folder vault-agent
```

Expected output: a JSON object with `id`, `name`, `folder`. Save the `id` — you'll need it in Task 4.

- [ ] **Step 2: Create `groups/vault-agent/package.json`**

```json
{
  "name": "obsidian-mcp",
  "private": true,
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0"
  }
}
```

- [ ] **Step 3: Install deps**

```bash
cd groups/vault-agent && bun install
```

Expected: `bun install` completes, `node_modules/@modelcontextprotocol/sdk/` exists.

- [ ] **Step 4: Verify bun can resolve the SDK**

```bash
cd groups/vault-agent && bun -e "import { Server } from '@modelcontextprotocol/sdk/server/index.js'; console.log('ok')"
```

Expected output: `ok`

---

## Task 2: Write the HTTP client with tests

**Files:**
- Create: `groups/vault-agent/obsidian-mcp.ts` (partial — only `call()` and helpers)
- Create: `groups/vault-agent/obsidian-mcp.test.ts` (partial — only `call()` tests)

- [ ] **Step 1: Write the failing tests for `call()`**

Create `groups/vault-agent/obsidian-mcp.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";

process.env.OBSIDIAN_API_KEY = "test-key";
process.env.OBSIDIAN_HOST = "https://localhost:27124";

const { call } = await import("./obsidian-mcp.ts");

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockResponse(status: number, body: unknown, contentType = "text/plain") {
  global.fetch = async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => contentType },
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    }) as unknown as Response;
}

function mockNetworkError() {
  global.fetch = async () => { throw new Error("ECONNREFUSED"); };
}

describe("call()", () => {
  it("returns ok=true and text data on 200 text response", async () => {
    mockResponse(200, "# My Note", "text/markdown");
    const r = await call("/vault/test.md");
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.data).toBe("# My Note");
    expect(r.retryable).toBe(false);
  });

  it("returns ok=true and parsed JSON on application/json response", async () => {
    mockResponse(200, { files: ["a.md", "b.md"] }, "application/json");
    const r = await call("/vault/");
    expect(r.ok).toBe(true);
    expect((r.data as { files: string[] }).files).toEqual(["a.md", "b.md"]);
  });

  it("returns retryable=true on network error", async () => {
    mockNetworkError();
    const r = await call("/vault/test.md");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.retryable).toBe(true);
  });

  it("returns retryable=false on HTTP 404", async () => {
    mockResponse(404, "Not Found");
    const r = await call("/vault/missing.md");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.retryable).toBe(false);
  });

  it("sets Authorization header", async () => {
    let capturedHeaders: Record<string, string> = {};
    global.fetch = async (_url, init) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>)
      );
      return { ok: true, status: 200, headers: { get: () => "text/plain" }, text: async () => "" } as unknown as Response;
    };
    await call("/vault/test.md");
    expect(capturedHeaders["Authorization"]).toBe("Bearer test-key");
  });

  it("sends body and Content-Type when provided", async () => {
    let capturedInit: RequestInit = {};
    global.fetch = async (_url, init) => {
      capturedInit = init ?? {};
      return { ok: true, status: 204, headers: { get: () => "text/plain" }, text: async () => "" } as unknown as Response;
    };
    await call("/vault/test.md", { method: "PUT", body: "# Note", contentType: "text/markdown" });
    expect(capturedInit.method).toBe("PUT");
    expect(capturedInit.body).toBe("# Note");
    expect((capturedInit.headers as Record<string, string>)["Content-Type"]).toBe("text/markdown");
  });
});
```

- [ ] **Step 2: Run tests — expect import error (file doesn't exist yet)**

```bash
cd groups/vault-agent && bun test obsidian-mcp.test.ts
```

Expected: error like `Cannot find module './obsidian-mcp.ts'`

- [ ] **Step 3: Write `call()` and helpers in `obsidian-mcp.ts`**

Create `groups/vault-agent/obsidian-mcp.ts` with just the HTTP client (no tools or server yet):

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_KEY = process.env.OBSIDIAN_API_KEY;
const HOST = process.env.OBSIDIAN_HOST ?? "https://host.docker.internal:27124";

if (import.meta.main && !API_KEY) {
  process.stderr.write("OBSIDIAN_API_KEY environment variable is required\n");
  process.exit(1);
}

export interface CallResult {
  ok: boolean;
  status: number;
  data: unknown;
  retryable: boolean;
}

function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export async function call(
  path: string,
  init: { method?: string; body?: string; contentType?: string } = {}
): Promise<CallResult> {
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${API_KEY ?? ""}` };
    if (init.contentType) headers["Content-Type"] = init.contentType;
    const res = await fetch(`${HOST}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      // @ts-ignore Bun-specific TLS option
      tls: { rejectUnauthorized: false },
    });
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, data, retryable: false };
  } catch {
    return { ok: false, status: 0, data: null, retryable: true };
  }
}

export { encodePath };
```

- [ ] **Step 4: Run `call()` tests — expect pass**

```bash
cd groups/vault-agent && bun test obsidian-mcp.test.ts --test-name-pattern "call()"
```

Expected: all 5 `call()` tests pass.

- [ ] **Step 5: Commit checkpoint note** *(no git — just verify locally)*

```bash
cd groups/vault-agent && bun test obsidian-mcp.test.ts
```

Expected: 5 tests pass, 0 fail.

---

## Task 3: Write tool handlers with tests

**Files:**
- Modify: `groups/vault-agent/obsidian-mcp.ts` (add `handleTool()`)
- Modify: `groups/vault-agent/obsidian-mcp.test.ts` (add `handleTool()` tests)

- [ ] **Step 1: Append `handleTool()` tests to the test file**

Open `groups/vault-agent/obsidian-mcp.test.ts` and append:

```typescript
const { handleTool } = await import("./obsidian-mcp.ts");

describe("handleTool()", () => {
  it("vault_read: returns note content on success", async () => {
    mockResponse(200, "# My Note\nContent here", "text/markdown");
    const r = await handleTool("vault_read", { path: "Notes/my-note.md" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("# My Note");
  });

  it("vault_read: returns retryable message on connection failure", async () => {
    mockNetworkError();
    const r = await handleTool("vault_read", { path: "Notes/my-note.md" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Obsidian is not running");
  });

  it("vault_read: returns not-found message on 404", async () => {
    mockResponse(404, "Not Found");
    const r = await handleTool("vault_read", { path: "missing.md" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Note not found: missing.md");
  });

  it("vault_read: returns auth error on 401", async () => {
    mockResponse(401, "Unauthorized");
    const r = await handleTool("vault_read", { path: "test.md" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Invalid API key");
  });

  it("vault_write: confirms write on success", async () => {
    mockResponse(204, "");
    const r = await handleTool("vault_write", { path: "New/note.md", content: "# New Note" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("Written: New/note.md");
  });

  it("vault_write: retryable on connection error", async () => {
    mockNetworkError();
    const r = await handleTool("vault_write", { path: "test.md", content: "hi" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Obsidian is not running");
  });

  it("vault_append: confirms append on success", async () => {
    mockResponse(204, "");
    const r = await handleTool("vault_append", { path: "journal.md", content: "\n- new item" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("Appended to: journal.md");
  });

  it("vault_delete: confirms deletion on success", async () => {
    mockResponse(204, "");
    const r = await handleTool("vault_delete", { path: "old.md" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("Deleted: old.md");
  });

  it("vault_delete: returns not-found on 404", async () => {
    mockResponse(404, "Not Found");
    const r = await handleTool("vault_delete", { path: "ghost.md" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Note not found: ghost.md");
  });

  it("vault_list: returns file list on success", async () => {
    mockResponse(200, { files: ["Projects/a.md", "Projects/b.md"] }, "application/json");
    const r = await handleTool("vault_list", { folder: "Projects" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("Projects/a.md");
    expect(r.content[0].text).toContain("Projects/b.md");
  });

  it("vault_list: returns (empty) when no files", async () => {
    mockResponse(200, { files: [] }, "application/json");
    const r = await handleTool("vault_list", {});
    expect(r.content[0].text).toBe("(empty)");
  });

  it("vault_search: formats results", async () => {
    mockResponse(
      200,
      [{ filename: "Notes/a.md", matches: [{ context: "found here" }] }],
      "application/json"
    );
    const r = await handleTool("vault_search", { query: "something" });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("Notes/a.md");
    expect(r.content[0].text).toContain("found here");
  });

  it("vault_search: returns no-results message when empty", async () => {
    mockResponse(200, [], "application/json");
    const r = await handleTool("vault_search", { query: "nothing" });
    expect(r.content[0].text).toBe("No results found.");
  });

  it("vault_query: returns JSON on success", async () => {
    mockResponse(200, [{ file: { name: "note" }, status: "active" }], "application/json");
    const r = await handleTool("vault_query", { dql: 'TABLE status FROM "Projects"' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('"status"');
  });

  it("vault_query: returns DQL error on 400", async () => {
    mockResponse(400, { error: "syntax error near TOKEN" }, "application/json");
    const r = await handleTool("vault_query", { dql: "INVALID" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Invalid DQL");
  });

  it("vault_get_active: returns active file content", async () => {
    mockResponse(200, "# Active Note\nopen right now", "text/markdown");
    const r = await handleTool("vault_get_active", {});
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("# Active Note");
  });

  it("vault_get_active: returns message when no file open", async () => {
    mockResponse(404, "");
    const r = await handleTool("vault_get_active", {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("No file is currently open");
  });

  it("returns error for unknown tool", async () => {
    const r = await handleTool("vault_unknown", {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Unknown tool");
  });
});
```

- [ ] **Step 2: Run tests — expect `handleTool` is undefined**

```bash
cd groups/vault-agent && bun test obsidian-mcp.test.ts --test-name-pattern "handleTool"
```

Expected: error — `handleTool` not exported yet.

- [ ] **Step 3: Implement `handleTool()` in `obsidian-mcp.ts`**

Add after the `export { encodePath }` line:

```typescript
const RETRYABLE_MSG =
  "Obsidian is not running or the Local REST API plugin is not active.";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const };
}

export async function handleTool(
  name: string,
  args: Record<string, string>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: true }> {
  switch (name) {
    case "vault_read": {
      const r = await call(`/vault/${encodePath(args.path)}`);
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 404) return err(`Note not found: ${args.path}`);
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(r.data as string);
    }
    case "vault_write": {
      const r = await call(`/vault/${encodePath(args.path)}`, {
        method: "PUT",
        body: args.content,
        contentType: "text/markdown",
      });
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(`Written: ${args.path}`);
    }
    case "vault_append": {
      const r = await call(`/vault/${encodePath(args.path)}`, {
        method: "POST",
        body: args.content,
        contentType: "text/markdown",
      });
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(`Appended to: ${args.path}`);
    }
    case "vault_delete": {
      const r = await call(`/vault/${encodePath(args.path)}`, { method: "DELETE" });
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 404) return err(`Note not found: ${args.path}`);
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(`Deleted: ${args.path}`);
    }
    case "vault_list": {
      const folder = args.folder ?? "";
      const path = folder ? `/vault/${encodePath(folder)}/` : "/vault/";
      const r = await call(path);
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 404) return err(`Folder not found: ${folder || "/"}`);
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      const files = (r.data as { files: string[] }).files ?? [];
      return ok(files.length ? files.join("\n") : "(empty)");
    }
    case "vault_search": {
      const r = await call("/search/simple/", {
        method: "POST",
        body: JSON.stringify({ query: args.query, contextLength: 100 }),
        contentType: "application/json",
      });
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Search error ${r.status}: ${r.data}`);
      const results = r.data as Array<{ filename: string; matches: Array<{ context: string }> }>;
      if (!results.length) return ok("No results found.");
      return ok(
        results
          .map((res) => `${res.filename}\n  ${res.matches.map((m) => m.context).join("\n  ")}`)
          .join("\n\n")
      );
    }
    case "vault_query": {
      const r = await call("/search/", {
        method: "POST",
        body: args.dql,
        contentType: "application/vnd.olrapi.dataview.dql+txt",
      });
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 400) return err(`Invalid DQL: ${JSON.stringify(r.data)}`);
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Query error ${r.status}: ${r.data}`);
      return ok(JSON.stringify(r.data, null, 2));
    }
    case "vault_get_active": {
      const r = await call("/active/");
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 404) return err("No file is currently open in Obsidian.");
      if (r.status === 401) return err("Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.");
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(r.data as string);
    }
    default:
      return err(`Unknown tool: ${name}`);
  }
}
```

- [ ] **Step 4: Run all tests — expect pass**

```bash
cd groups/vault-agent && bun test obsidian-mcp.test.ts
```

Expected: all tests pass (5 `call()` + 17 `handleTool()`).

---

## Task 4: Add MCP server bootstrap to `obsidian-mcp.ts`

**Files:**
- Modify: `groups/vault-agent/obsidian-mcp.ts` (add tool definitions and server bootstrap)

- [ ] **Step 1: Append tool definitions and server bootstrap**

Add at the bottom of `groups/vault-agent/obsidian-mcp.ts`:

```typescript
const TOOLS = [
  {
    name: "vault_read",
    description: "Read the content of a note from the Obsidian vault.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note (e.g. 'Projects/meeting.md')" },
      },
      required: ["path"],
    },
  },
  {
    name: "vault_write",
    description: "Create or overwrite a note. Creates the file if it does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note" },
        content: { type: "string", description: "Full markdown content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "vault_append",
    description: "Append content to the end of an existing note.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note" },
        content: { type: "string", description: "Content to append" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "vault_delete",
    description: "Delete a note from the vault.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the note to delete" },
      },
      required: ["path"],
    },
  },
  {
    name: "vault_list",
    description: "List files in a vault folder. Omit folder for vault root.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder path (optional, e.g. 'Projects')" },
      },
    },
  },
  {
    name: "vault_search",
    description: "Full-text search across the vault.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string" },
      },
      required: ["query"],
    },
  },
  {
    name: "vault_query",
    description:
      "Dataview DQL query — filter notes by frontmatter properties, tags, dates, etc. Requires the Dataview plugin. Example: 'TABLE status FROM \"Projects\" WHERE status = \"active\"'",
    inputSchema: {
      type: "object",
      properties: {
        dql: { type: "string", description: "Dataview DQL query string" },
      },
      required: ["dql"],
    },
  },
  {
    name: "vault_get_active",
    description: "Get the content of the file currently open in Obsidian.",
    inputSchema: { type: "object", properties: {} },
  },
];

if (import.meta.main) {
  const server = new Server(
    { name: "obsidian-vault", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    handleTool(req.params.name, (req.params.arguments ?? {}) as Record<string, string>)
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 2: Run all tests to confirm bootstrap addition didn't break anything**

```bash
cd groups/vault-agent && bun test obsidian-mcp.test.ts
```

Expected: all tests still pass.

- [ ] **Step 3: Smoke-test the server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}' \
  | OBSIDIAN_API_KEY=test OBSIDIAN_HOST=https://localhost:27124 bun groups/vault-agent/obsidian-mcp.ts
```

Expected: a JSON response containing `"result"` and `"serverInfo"`. Ctrl-C to exit.

---

## Task 5: Write CLAUDE.md

**Files:**
- Create: `groups/vault-agent/CLAUDE.md`

- [ ] **Step 1: Create `groups/vault-agent/CLAUDE.md`**

```markdown
# Vault Agent

You are a personal knowledge assistant with direct access to my Obsidian vault via MCP tools.

## Vault

[TODO: describe your vault — folder structure, main sections, what kinds of notes you keep]

Example:
- `Projects/` — active project notes, one file per project
- `Journal/` — daily notes named YYYY-MM-DD.md
- `Resources/` — reference material

## Frontmatter schema

[TODO: list the frontmatter properties you use, e.g.:
- `status`: "active" | "done" | "someday"
- `created`: ISO date (YYYY-MM-DD)
- `tags`: list of strings
- `project`: project name (for tasks)
]

## Conventions

- New notes: always include `created` frontmatter set to today's date.
- Use `vault_query` with DQL for structured queries (frontmatter, tags, dates).
- Use `vault_search` for full-text searches when DQL isn't needed.
- Prefer `vault_append` over `vault_write` when adding to an existing note.

## Handling Obsidian unavailability

When any vault tool returns the message "Obsidian is not running or the Local REST API plugin is not active.":

1. Tell the user what happened in plain language (e.g. "I can't reach Obsidian right now — it may not be open.").
2. Tell the user you will retry their request in 1 hour.
3. Call `schedule_task` with:
   - `prompt`: the user's original request verbatim
   - `processAfter`: exactly 1 hour from now (ISO 8601)
```

---

## Task 6: Wire the MCP server and verify

- [ ] **Step 1: Get the group ID**

```bash
ncl groups list
```

Find the `vault-agent` row and note its `id` (a UUID).

- [ ] **Step 2: Wire the MCP server**

Replace `<group-id>` and `<your-api-key>` with real values:

```bash
ncl groups config add-mcp-server \
  --id <group-id> \
  --name obsidian \
  --command bun \
  --args '["/workspace/agent/obsidian-mcp.ts"]' \
  --env '{"OBSIDIAN_API_KEY":"<your-api-key>","OBSIDIAN_HOST":"https://host.docker.internal:27124"}'
```

To find your API key: Obsidian → Settings → Local REST API → API Key.

- [ ] **Step 3: Verify the config was saved**

```bash
ncl groups config get --id <group-id>
```

Expected: output shows `mcpServers.obsidian` with `command: bun` and the correct args.

- [ ] **Step 4: Wire a messaging group to the vault agent**

```bash
ncl wirings create --messaging-group-id <your-mg-id> --agent-group-id <group-id>
```

If you don't have a messaging group for DMs yet, use `ncl messaging-groups list` to find one, or create one and wire a channel via the appropriate `/add-<channel>` skill.

- [ ] **Step 5: Send a test message and confirm vault access**

Send the vault agent a message through the wired channel:

```
list my vault files
```

Expected: the agent responds with a list of files from your vault root, or a retryable error if Obsidian is not running. Check `logs/nanoclaw.log` if nothing comes back.

- [ ] **Step 6: Test a DQL query**

```
show me all notes with status active
```

Expected: the agent calls `vault_query` with a DQL like `TABLE file.name, status FROM "/" WHERE status = "active"` and returns results (or tells you the Dataview plugin isn't installed/enabled if that's the case).

---

## Spec Coverage Checklist

- [x] MCP server bootstrapped with 8 tools
- [x] `call()` handles text and JSON responses
- [x] `call()` returns `retryable: true` on network failure
- [x] All tools handle retryable, 401, 404, 400 error cases
- [x] `vault_query` uses Dataview DQL content type
- [x] `import.meta.main` guard prevents server startup during tests
- [x] TLS verification disabled for self-signed cert
- [x] CLAUDE.md stub with retry scheduling instructions
- [x] Agent group created and MCP server wired via ncl
