# Channels — Source Notes

This directory implements the NanoClaw channel adapter layer: the bridge between messaging platforms and the host router.

For the full developer reference on platform chat entities, see [docs/messaging-groups.md](../../docs/messaging-groups.md). For the wiring layer that connects chats to agent groups, see [docs/messaging-group-agents.md](../../docs/messaging-group-agents.md).

Key files in this tree:

- `src/channels/adapter.ts` — `ChannelAdapter` contract, `InboundEvent` / `InboundMessage` shapes, and `ChannelDefaults` declaration.
- `src/channels/channel-registry.ts` — adapter registration, lifecycle (`initChannelAdapters`, `teardownChannelAdapters`), and default declaration resolution.
- `src/channels/channel-defaults.ts` — wiring default resolution, unknown-sender policy resolution, and runtime thread-policy logic.
- `src/channels/chat-sdk-bridge.ts` — bridge for Chat SDK-based adapters.
- `src/platform-id.ts` — platform ID normalization so stored `messaging_groups.platform_id` matches inbound events.
- `src/router.ts` — inbound routing from adapter events to messaging groups, wirings, sessions, and containers.

Channel-specific adapters are installed as skills (e.g. `/add-telegram`, `/add-slack`) and self-register via `registerChannelAdapter()`. Each adapter declares `ChannelDefaults` that snapshot into `messaging_groups` and `messaging_group_agents` rows at creation time, except for `threads`, which is resolved live at router fanout.

For how to add or extend channel adapters, see [docs/agent-group-extensibility.md](../../docs/agent-group-extensibility.md).
