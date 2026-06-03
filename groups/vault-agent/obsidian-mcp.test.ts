import { describe, it, expect, afterEach } from "bun:test";

process.env.OBSIDIAN_API_KEY = "test-key";
process.env.OBSIDIAN_HOST = "https://localhost:27124";

const { call, encodePath } = await import("./obsidian-mcp.ts");

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockResponse(status: number, body: unknown, contentType = "text/plain") {
  global.fetch = async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => name === "content-type" ? contentType : null },
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

  it("returns ok=true and empty string data on 204 no content", async () => {
    global.fetch = async () =>
      ({
        ok: true,
        status: 204,
        headers: { get: (name: string) => name === "content-type" ? "text/plain" : null },
        text: async () => "",
      }) as unknown as Response;
    const r = await call("/vault/test.md", { method: "DELETE" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(204);
    expect(r.data).toBe("");
    expect(r.retryable).toBe(false);
  });
});

describe("encodePath()", () => {
  it("encodes special characters per segment, preserving slashes", () => {
    expect(encodePath("folder/My Note (draft).md")).toBe("folder/My%20Note%20(draft).md");
    expect(encodePath("a/b/c")).toBe("a/b/c");
    expect(encodePath("Projects/Q1 Review.md")).toBe("Projects/Q1%20Review.md");
  });
});

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
