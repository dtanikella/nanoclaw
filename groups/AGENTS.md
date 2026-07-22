# Agent Groups — On-Disk Workspace

This directory contains the per-agent-group workspace folders. Each folder is a persistent working directory that is bind-mounted into the agent container.

For the full developer reference, see [docs/agent-groups.md](../docs/agent-groups.md#4-on-disk-layout).

Typical contents of a group folder:

- `CLAUDE.md` — composed per spawn from `CLAUDE.local.md` + `instructions.prepend.md`.
- `CLAUDE.local.md` — operator-edited project instructions for Claude-backed groups.
- `instructions.prepend.md` — provider-neutral standing instructions, stamped once at creation.
- `container.json` — materialized at spawn from `container_configs`; do not edit by hand.
- context extras, notes, and files the agent creates at runtime.

Per-group shared state also lives under `data/v2-sessions/<agent_group_id>/`:

- `.claude-shared/settings.json` — Claude-specific settings.
- `.claude-shared/skills/` — per-group skills as real directories.
- `<session_id>/` — per-session `inbound.db`, `outbound.db`, `.heartbeat`, `inbox/`, `outbox/`.

Folder names are validated by `src/group-folder.ts`: `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`, no path separators, cannot be `global`, and must be unique. The folder is immutable after creation.
