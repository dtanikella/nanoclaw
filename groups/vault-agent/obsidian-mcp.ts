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

export function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

const RETRYABLE_MSG =
  "Obsidian is not running or the Local REST API plugin is not active.";
const AUTH_ERR_MSG = "Invalid API key. Check OBSIDIAN_API_KEY in the MCP server config.";

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
      if (r.status === 401) return err(AUTH_ERR_MSG);
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
      if (r.status === 401) return err(AUTH_ERR_MSG);
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
      if (r.status === 404) return err(`Note not found: ${args.path}`);
      if (r.status === 401) return err(AUTH_ERR_MSG);
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(`Appended to: ${args.path}`);
    }
    case "vault_delete": {
      const r = await call(`/vault/${encodePath(args.path)}`, { method: "DELETE" });
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 404) return err(`Note not found: ${args.path}`);
      if (r.status === 401) return err(AUTH_ERR_MSG);
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(`Deleted: ${args.path}`);
    }
    case "vault_list": {
      const folder = args.folder ?? "";
      const path = folder ? `/vault/${encodePath(folder)}/` : "/vault/";
      const r = await call(path);
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 404) return err(`Folder not found: ${folder || "/"}`);
      if (r.status === 401) return err(AUTH_ERR_MSG);
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      const files = (r.data as { files: string[] }).files ?? [];
      return ok(files.length ? files.join("\n") : "(empty)");
    }
    case "vault_search": {
      const qs = `?query=${encodeURIComponent(args.query)}&contextLength=100`;
      const r = await call(`/search/simple/${qs}`, { method: "POST" });
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 401) return err(AUTH_ERR_MSG);
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
      if (r.status === 401) return err(AUTH_ERR_MSG);
      if (r.status === 400) {
        const d = r.data as { errorCode?: number; message?: string } | null;
        if (d && d.errorCode === 40012)
          return err("Dataview plugin is not installed or enabled in Obsidian. Install it via Settings → Community Plugins → search 'Dataview'.");
        return err(`Invalid DQL: ${JSON.stringify(r.data)}`);
      }
      if (!r.ok) return err(`Query error ${r.status}: ${r.data}`);
      return ok(JSON.stringify(r.data, null, 2));
    }
    case "vault_recent": {
      const folder = args.folder ?? "notes";
      const limit = Math.min(parseInt(args.limit ?? "10", 10) || 10, 50);

      // Get file list
      const listPath = `/vault/${encodePath(folder)}/`;
      const listR = await call(listPath);
      if (listR.retryable) return err(RETRYABLE_MSG);
      if (listR.status === 404) return err(`Folder not found: ${folder}`);
      if (listR.status === 401) return err(AUTH_ERR_MSG);
      if (!listR.ok) return err(`Error ${listR.status}: ${listR.data}`);

      const allFiles = ((listR.data as { files: string[] }).files ?? []).filter((f) =>
        f.endsWith(".md")
      );
      if (!allFiles.length) return ok(`No markdown files found in ${folder}.`);

      // Fetch mtime for each file in parallel via NoteJson
      const stats = await Promise.all(
        allFiles.map(async (name) => {
          const r = await call(`/vault/${encodePath(folder)}/${encodePath(name)}`, {
            accept: "application/vnd.olrapi.note+json",
          });
          const mtime =
            r.ok && r.data && typeof r.data === "object"
              ? ((r.data as { stat?: { mtime?: number } }).stat?.mtime ?? 0)
              : 0;
          return { name, mtime };
        })
      );

      const top = stats.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
      const lines = top.map((f) => {
        const d = new Date(f.mtime).toISOString().slice(0, 16).replace("T", " ");
        return `${d}  ${folder}/${f.name}`;
      });
      return ok(lines.join("\n"));
    }
    case "vault_get_active": {
      const r = await call("/active/");
      if (r.retryable) return err(RETRYABLE_MSG);
      if (r.status === 404) return err("No file is currently open in Obsidian.");
      if (r.status === 401) return err(AUTH_ERR_MSG);
      if (!r.ok) return err(`Error ${r.status}: ${r.data}`);
      return ok(r.data as string);
    }
    default:
      return err(`Unknown tool: ${name}`);
  }
}

export async function call(
  path: string,
  init: { method?: string; body?: string; contentType?: string; accept?: string } = {}
): Promise<CallResult> {
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${API_KEY ?? ""}` };
    if (init.contentType) headers["Content-Type"] = init.contentType;
    if (init.accept) headers["Accept"] = init.accept;
    const res = await fetch(`${HOST}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      // @ts-ignore Bun-specific TLS option
      tls: { rejectUnauthorized: false },
    });
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    return { ok: res.ok, status: res.status, data, retryable: false };
  } catch {
    return { ok: false, status: 0, data: null, retryable: true };
  }
}

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
      "Dataview DQL query — filter notes by frontmatter properties, tags, dates, etc. Requires both the Dataview plugin AND a version of the Local REST API plugin that supports it (not 'Local REST API with MCP' v4.x — use the standard 'Local REST API' plugin instead). Example: 'TABLE status FROM \"Projects\" WHERE status = \"active\"'",
    inputSchema: {
      type: "object",
      properties: {
        dql: { type: "string", description: "Dataview DQL query string" },
      },
      required: ["dql"],
    },
  },
  {
    name: "vault_recent",
    description:
      "List recently modified notes sorted by filesystem modification time. Use this to find the latest updated notes when Dataview is unavailable.",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Vault subfolder to search (default: 'notes')" },
        limit: { type: "string", description: "Max results to return (default: 10, max: 50)" },
      },
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

