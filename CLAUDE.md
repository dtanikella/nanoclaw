# NanoClaw Fork — Agent Notes

This repository is a **personal fork of [NanoClaw](https://docs.nanoclaw.dev/introduction)**, a personal AI assistant that runs agents in isolated containers. Upstream lives at `nanocoai/nanoclaw`; this repo is the customized install. All commits, branches, and PRs should be made to this fork — never push to the upstream repo.

## ⚠️ Merging into an existing v1 install

This fork is based on the NanoClaw v2 rewrite. It **cannot** be merged into a v1 install.

If you just ran `git pull`/`merge` and see conflicts, stop:

1. `git merge --abort` (or `git reset --hard ORIG_HEAD`).
2. Tell the user: *"This is the v2 rewrite — it can't be merged into your existing install. Exit OpenCode and run `bash migrate-v2.sh` from the shell."*
3. Wait for confirmation before doing anything else.

Fresh v2 clones with no conflicts can ignore this.

## Dev environment

- **Host**: Node 20+, pnpm 10+. Run `corepack enable` if pnpm isn't available.
- **Agent container**: Bun runtime, isolated from the host package tree.
- **Adapters/providers**: Trunk ships only registry/infra. Real channel adapters live on the `channels` branch; alternative providers on `providers`. They are installed per-fork via skills (`/add-telegram`, `/add-opencode`, etc.).
- Most local config lives in `.env`. Production secrets/credentials are handled by OneCLI, not `.env`.

Common commands:

```bash
pnpm install --frozen-lockfile   # host deps; use --frozen-lockfile in CI/builds
pnpm run dev                     # host via tsx (no watch)
pnpm run build                   # compile src/ → dist/
pnpm run start                   # node dist/index.js
./container/build.sh             # rebuild nanoclaw-agent:latest

# agent-runner (separate Bun package)
cd container/agent-runner && bun install
cd container/agent-runner && bun run typecheck
cd container/agent-runner && bun test
```

## Loose architecture

A single Node **host** orchestrates per-session agent containers.

```
channel event
  → host router (src/router.ts)
  → mapped to session → written to session inbound.db
  → Docker container wakes / agent-runner polls
  → agent calls provider, writes response to outbound.db
  → host delivery (src/delivery.ts) polls outbound.db
  → response sent back through channel adapter
```

**Everything is a message.** Host and container communicate only through the two session SQLite files — no IPC, no file watchers, no stdin piping.

Key source boundaries:

- `src/index.ts` — host entry: DB init, migrations, adapters, delivery/sweep loops.
- `src/router.ts` — inbound routing: messaging group → agent group → session → inbound.db.
- `src/delivery.ts` — outbound polling + system actions (schedule, approvals, etc.).
- `src/host-sweep.ts` — 60s sweep: stale detection, due-message wake, recurrence.
- `src/session-manager.ts` — session resolution, DB pair mounting, heartbeat path.
- `src/container-runner.ts` — container spawn, restart, OneCLI agent ensure.
- `container/agent-runner/src/` — Bun agent runner: poll loop, provider abstraction, MCP tools.
- `groups/<folder>/` — per-agent-group files (`CLAUDE.md`, skills, materialized `container.json`).

## Main entities

| Entity | What it is | Where it lives |
|--------|-----------|----------------|
| `users` | Platform identity (`<channel>:<handle>`) | `data/v2.db` |
| `messaging_groups` | One chat/channel on one platform | `data/v2.db` |
| `agent_groups` | Agent workspace: memory, `CLAUDE.md`, personality, container config | `data/v2.db` + `groups/<folder>/` |
| `messaging_group_agents` | Wiring between a messaging group and an agent group (session mode, engage rules, priority) | `data/v2.db` |
| `sessions` | Runtime instance = `agent_group_id + messaging_group_id + thread_id` | spawned containers + `data/v2-sessions/<id>/` |
| `container_configs` | Per-group runtime config (provider, model, packages, MCP servers, mounts) | `data/v2.db`, materialized to `container.json` |

Privilege is user-level via `user_roles` (owner / global admin / scoped admin). `agent_group_members` is the unprivileged access gate.

## Session DB split

Each session has two SQLite files under `data/v2-sessions/<session_id>/`:

- `inbound.db` — **host writes**, container reads. Holds `messages_in`, `destinations`, `session_routing`, `delivered`.
- `outbound.db` — **container writes**, host reads. Holds `messages_out`, `processing_ack`, `session_state`, `container_state`.

Rules:

- Exactly one writer per file.
- Host writes use even `seq` numbers; container uses odd.
- Heartbeat is a file touch at `/workspace/.heartbeat`, not a DB update.
- Both use `journal_mode=DELETE` (WAL does not cohere across VirtioFS mounts).

For ad-hoc SQL, use the in-tree wrapper instead of the `sqlite3` CLI:

```bash
pnpm exec tsx scripts/q.ts v2 "select * from agent_groups"
pnpm exec tsx scripts/q.ts sessions/<id>/inbound "select * from messages_in"
```

## Testing

```bash
pnpm run typecheck                  # host TypeScript
pnpm run lint                       # eslint src/
pnpm run format:check               # prettier src/**/*.ts
pnpm test                           # host tests (vitest)
pnpm test -- src/router.test.ts     # single host test file
pnpm exec vitest --run src/router   # focused run

# agent-runner tests (Bun only; vitest cannot load bun:sqlite)
cd container/agent-runner && bun test
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
```

There is no required order beyond common sense, but CI-style verification is:

```bash
pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm test
```

Some tests exercise Docker/container logic and may be slow or flaky if Docker is unavailable.

## Deploy to the home server

Use `deploy.sh` for one-command redeploy. It is manual — there is no CI polling.

Requirements on the remote:

- Same repo cloned at the target path.
- Node/pnpm available in non-interactive SSH sessions.
- The `com.nanoclaw` launchd service (macOS) or `nanoclaw` systemd user service (Linux) is loaded.

Set the target once in `.env`:

```bash
DEPLOY_HOST=user@203.0.113.1
DEPLOY_PATH=~/nanoclaw   # optional, defaults to ~/nanoclaw
```

Then deploy:

```bash
bash deploy.sh              # uses DEPLOY_HOST from .env
bash deploy.sh user@host    # or pass it directly
```

What it does on the server:

1. `git pull --ff-only` (fails if the branch has diverged).
2. `corepack pnpm install --frozen-lockfile`.
3. `corepack pnpm build`.
4. Restarts the service:
   - macOS: `launchctl kickstart -k gui/<uid>/com.nanoclaw`
   - Linux: `systemctl --user restart nanoclaw`

If the service restart fails, load it first:

```bash
# macOS
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# Linux
systemctl --user start nanoclaw
```

## Toolchain conventions

- **pnpm supply chain**: `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` (3 days). Do not add `minimumReleaseAgeExclude` or `onlyBuiltDependencies` entries without human approval. Use `--frozen-lockfile` in CI/automation/container builds.
- **Host vs container runtimes**: Host is Node/pnpm; agent-runner is Bun. Do not run `pnpm install` inside `container/agent-runner/`. Edit its `package.json`, then `bun install` and commit `bun.lock`.
- **Container rebuild gotcha**: BuildKit caches COPY steps aggressively. `--no-cache` alone does not always invalidate them. For a truly clean rebuild, prune the builder before `./container/build.sh`.
- **Timestamps**: store ISO-8601 UTC (`new Date().toISOString()`). Display in the install timezone via `formatLocalTime`/`formatLocalStamp`. SQL snippets use `strftime('%Y-%m-%dT%H:%M:%fZ','now')`; SQL comparisons wrap both sides in `datetime()`.
- **SQL params**: host uses `better-sqlite3` (named params without `$` prefix). Container uses `bun:sqlite` (keep the `$` prefix: `.run({ $id })`).
- **Prettier**: single quotes, print width 120.

## Skills

Customizations are added as skills, not trunk features. Types:

- **Channel/provider install**: `/add-slack`, `/add-opencode`, etc. Code comes from registry branches.
- **Utility**: code files shipped alongside `SKILL.md`.
- **Operational**: instruction-only workflows (`/setup`, `/debug`, `/customize`, `/update-nanoclaw`).
- **Container**: loaded inside the agent container (`container/skills/<name>/`).

Before writing or modifying skills, read [docs/skill-guidelines.md](docs/skill-guidelines.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting

| What | Where |
|------|-------|
| Host errors / delivery failures | `logs/nanoclaw.error.log`, then `logs/nanoclaw.log` |
| Setup step failures | `logs/setup.log`, `logs/setup-steps/*.log` |
| Did a message reach the container? | `data/v2-sessions/<id>/inbound.db` → `messages_in` |
| Did the agent respond? | `data/v2-sessions/<id>/outbound.db` → `messages_out` |

Container logs are lost after exit (`--rm`). For silent container failures, inspect the session DBs first.

## Useful docs

- `docs/architecture.md` — full architecture.
- `docs/db-central.md` / `docs/db-session.md` — DB schemas.
- `docs/build-and-runtime.md` — Node/Bun split, lockfiles, build invariants.
- `docs/skill-directives.md` — `nc:` directive reference.
- `CONTRIBUTING.md` — what belongs in trunk vs skills.
