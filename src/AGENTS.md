# Agent Groups — Source Notes

This directory implements the NanoClaw host side of agent groups: creation, filesystem initialization, routing, session management, container spawning, and CLI operations.

For the full developer reference, see [docs/agent-groups.md](../docs/agent-groups.md).

Key files in this tree:

- `src/db/agent-groups.ts` — CRUD for the `agent_groups` table.
- `src/db/container-configs.ts` — CRUD for `container_configs`, the runtime config source of truth.
- `src/db/messaging-groups.ts` — `messaging_group_agents` wiring and channel lookups.
- `src/group-init.ts` — idempotent on-disk initialization for a new group.
- `src/group-folder.ts` — folder name validation and path resolution.
- `src/group-persona.ts` — provider-neutral `instructions.prepend.md` staging.
- `src/group-skills.ts` — copying template skills into provider-specific directories.
- `src/router.ts` — inbound routing from channel event to agent group/session.
- `src/session-manager.ts` — session resolution, folder/DB creation, heartbeat path.
- `src/container-config.ts` — `container.json` materialization and secret resolution.
- `src/container-runner.ts` — container spawn, mounts, and wake logic.
- `src/container-restart.ts` — restarting a group's running containers.
- `src/cli/resources/groups.ts` — `ncl groups` CLI commands.
- `src/modules/permissions/access.ts` — user/group access decisions.

For how to extend agent groups with new providers, skills, MCP servers, channels, and runtime options, see [docs/agent-group-extensibility.md](../docs/agent-group-extensibility.md).
