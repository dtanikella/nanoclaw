# Agent Groups — Database Notes

This directory holds the central DB access layer for agent groups and everything wired to them.

For the full developer reference, see [docs/agent-groups.md](../../docs/agent-groups.md#5-database-representation).

Tables directly owned or referenced here:

- `agent_groups` — identity and folder mapping. CRUD in `src/db/agent-groups.ts`.
- `container_configs` — per-group runtime config. CRUD in `src/db/container-configs.ts`.
- `messaging_group_agents` — channel-to-agent wiring + engage rules. CRUD in `src/db/messaging-groups.ts`.
- `sessions` — runtime instances of an agent group. CRUD in `src/db/sessions.ts`.
- `agent_destinations` — named delivery targets inside an agent group. CRUD in `src/db/agent-destinations.ts`.
- `agent_group_members` — unprivileged membership gate. CRUD in `src/db/agent-group-members.ts`.
- `user_roles` — owner/admin grants, scoped to a group or global. CRUD in `src/db/user-roles.ts`.

Migration files live in `src/db/migrations/`. Skills and extensions that add DB state should add new numbered migrations there; see [docs/agent-group-extensibility.md](../../docs/agent-group-extensibility.md#7-migration-conventions-for-extensions).

For the full central schema reference, see [docs/db-central.md](../../docs/db-central.md).
