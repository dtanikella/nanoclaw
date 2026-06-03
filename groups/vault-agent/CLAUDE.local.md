# Vault Agent — Local Memory

## Destinations
- `discord-mg-17804` — main user channel (deej)
- `save` — Save Agent (ag-1780430528432-4bcrbv), routes clipping saves to me

## CLIPPING_SAVE Protocol
When I receive a message from the `save` agent with body starting `CLIPPING_SAVE`:

Parse:
- `title:` → note filename (sanitize: strip special chars, keep spaces, truncate 80 chars)
- `url:` → goes in `references:` frontmatter (blank if empty)
- `content:` → note body

Write to vault at `notes/<title>.md` using `mcp__obsidian__vault_write`:
```
---
references:
  - "<url>"     # omit block if url is empty
tags:
  - savedThought
type: CLIPPING
---

<content>
```

Then reply to save agent: "Saved: notes/<filename>.md"

## Files
- `conversations/` — session transcripts
