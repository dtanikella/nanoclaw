-- NanoClaw config export
-- Generated: 2026-06-03T00:06:58.634Z
-- Restore with: pnpm exec tsx scripts/restore-config.ts

-- agent_groups
INSERT OR REPLACE INTO "agent_groups" ("id", "name", "folder", "agent_provider", "created_at") VALUES ('ag-1780415753395-1196k0', 'nano', 'dm-with-dhanu', NULL, '2026-06-02T15:55:53.394Z');
INSERT OR REPLACE INTO "agent_groups" ("id", "name", "folder", "agent_provider", "created_at") VALUES ('bfc8e020-717a-47e9-9701-0ce6be372009', 'Vault Agent', 'vault-agent', NULL, '2026-06-02T18:19:12.922Z');
INSERT OR REPLACE INTO "agent_groups" ("id", "name", "folder", "agent_provider", "created_at") VALUES ('ag-1780430990896-zt9jni', 'save', 'save-2', NULL, '2026-06-02T20:09:50.896Z');
INSERT OR REPLACE INTO "agent_groups" ("id", "name", "folder", "agent_provider", "created_at") VALUES ('ag-1780431075117-29ddkc', 'save', 'save', NULL, '2026-06-02T20:11:15.117Z');

-- container_configs
INSERT OR REPLACE INTO "container_configs" ("agent_group_id", "provider", "model", "effort", "image_tag", "assistant_name", "max_messages_per_prompt", "skills", "mcp_servers", "packages_apt", "packages_npm", "additional_mounts", "updated_at", "cli_scope") VALUES ('ag-1780415753395-1196k0', NULL, NULL, NULL, NULL, NULL, NULL, '"all"', '{}', '[]', '[]', '[]', '2026-06-02T15:55:53.396Z', 'global');
INSERT OR REPLACE INTO "container_configs" ("agent_group_id", "provider", "model", "effort", "image_tag", "assistant_name", "max_messages_per_prompt", "skills", "mcp_servers", "packages_apt", "packages_npm", "additional_mounts", "updated_at", "cli_scope") VALUES ('bfc8e020-717a-47e9-9701-0ce6be372009', NULL, NULL, NULL, NULL, NULL, NULL, '"all"', '{"obsidian":{"command":"bun","args":["/workspace/agent/obsidian-mcp.ts"],"env":{"OBSIDIAN_API_KEY":"$OBSIDIAN_API_KEY","OBSIDIAN_HOST":"https://host.docker.internal:27124","NO_PROXY":"host.docker.internal","no_proxy":"host.docker.internal"}}}', '[]', '[]', '[]', '2026-06-02 19:43:38', 'group');
INSERT OR REPLACE INTO "container_configs" ("agent_group_id", "provider", "model", "effort", "image_tag", "assistant_name", "max_messages_per_prompt", "skills", "mcp_servers", "packages_apt", "packages_npm", "additional_mounts", "updated_at", "cli_scope") VALUES ('ag-1780430990896-zt9jni', NULL, 'claude-haiku-4-5-20251001', NULL, NULL, NULL, NULL, '"all"', '{}', '[]', '[]', '[]', '2026-06-02T20:10:58.176Z', 'group');
INSERT OR REPLACE INTO "container_configs" ("agent_group_id", "provider", "model", "effort", "image_tag", "assistant_name", "max_messages_per_prompt", "skills", "mcp_servers", "packages_apt", "packages_npm", "additional_mounts", "updated_at", "cli_scope") VALUES ('ag-1780431075117-29ddkc', NULL, NULL, NULL, NULL, NULL, NULL, '"all"', '{}', '[]', '[]', '[]', '2026-06-02T20:11:15.117Z', 'group');

-- messaging_groups
INSERT OR REPLACE INTO "messaging_groups" ("id", "channel_type", "platform_id", "name", "is_group", "unknown_sender_policy", "created_at", "denied_at") VALUES ('mg-1780415262215-lj6s7d', 'cli', 'local', 'Local CLI', 0, 'public', '2026-06-02T15:47:42.214Z', NULL);
INSERT OR REPLACE INTO "messaging_groups" ("id", "channel_type", "platform_id", "name", "is_group", "unknown_sender_policy", "created_at", "denied_at") VALUES ('mg-1780415753396-00sv2z', 'discord', 'discord:@me:1511397326441283626', 'Dhanu', 0, 'strict', '2026-06-02T15:55:53.394Z', NULL);
INSERT OR REPLACE INTO "messaging_groups" ("id", "channel_type", "platform_id", "name", "is_group", "unknown_sender_policy", "created_at", "denied_at") VALUES ('mg-1780417427895-qnjjru', 'discord', 'discord:1511396913562390679:1511396914480939210', NULL, 1, 'request_approval', '2026-06-02T16:23:47.895Z', NULL);
INSERT OR REPLACE INTO "messaging_groups" ("id", "channel_type", "platform_id", "name", "is_group", "unknown_sender_policy", "created_at", "denied_at") VALUES ('mg-1780426909453-ylonzx', 'discord', 'discord:1511396913562390679:1511405892543709266', NULL, 1, 'request_approval', '2026-06-02T19:01:49.453Z', NULL);

-- messaging_group_agents
INSERT OR REPLACE INTO "messaging_group_agents" ("id", "messaging_group_id", "agent_group_id", "session_mode", "priority", "created_at", "engage_mode", "engage_pattern", "sender_scope", "ignored_message_policy") VALUES ('mga-1780415753396-sp9lba', 'mg-1780415753396-00sv2z', 'ag-1780415753395-1196k0', 'shared', 0, '2026-06-02T15:55:53.394Z', 'pattern', '.', 'all', 'drop');
INSERT OR REPLACE INTO "messaging_group_agents" ("id", "messaging_group_id", "agent_group_id", "session_mode", "priority", "created_at", "engage_mode", "engage_pattern", "sender_scope", "ignored_message_policy") VALUES ('mga-1780417506493-spth7y', 'mg-1780417427895-qnjjru', 'ag-1780415753395-1196k0', 'shared', 0, '2026-06-02T16:25:06.493Z', 'mention-sticky', NULL, 'known', 'accumulate');
INSERT OR REPLACE INTO "messaging_group_agents" ("id", "messaging_group_id", "agent_group_id", "session_mode", "priority", "created_at", "engage_mode", "engage_pattern", "sender_scope", "ignored_message_policy") VALUES ('mga-1780426932419-546wi2', 'mg-1780426909453-ylonzx', 'bfc8e020-717a-47e9-9701-0ce6be372009', 'shared', 0, '2026-06-02T19:02:12.419Z', 'mention-sticky', NULL, 'known', 'accumulate');
INSERT OR REPLACE INTO "messaging_group_agents" ("id", "messaging_group_id", "agent_group_id", "session_mode", "priority", "created_at", "engage_mode", "engage_pattern", "sender_scope", "ignored_message_policy") VALUES ('35465553-a1cb-49e2-a616-8adbac395c06', 'mg-1780426909453-ylonzx', 'ag-1780430990896-zt9jni', 'shared', 0, '2026-06-02T20:12:37.463Z', 'pattern', '.', 'known', 'drop');

-- agent_destinations
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('ag-1780415753395-1196k0', 'dhanu', 'channel', 'mg-1780415753396-00sv2z', '2026-06-02T15:55:53.394Z');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('ag-1780415753395-1196k0', 'discord-mg-17804', 'channel', 'mg-1780417427895-qnjjru', '2026-06-02T16:25:06.493Z');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('bfc8e020-717a-47e9-9701-0ce6be372009', 'discord-mg-17804', 'channel', 'mg-1780426909453-ylonzx', '2026-06-02T19:02:12.419Z');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('bfc8e020-717a-47e9-9701-0ce6be372009', 'discord-1511396123170963669', 'channel', '1511396123170963669', '2026-06-02 19:02:31');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('ag-1780415753395-1196k0', 'save', 'agent', 'ag-1780430990896-zt9jni', '2026-06-02T20:09:50.896Z');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('ag-1780430990896-zt9jni', 'parent', 'agent', 'ag-1780415753395-1196k0', '2026-06-02T20:09:50.896Z');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('bfc8e020-717a-47e9-9701-0ce6be372009', 'save', 'agent', 'ag-1780431075117-29ddkc', '2026-06-02T20:11:15.117Z');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('ag-1780431075117-29ddkc', 'parent', 'agent', 'bfc8e020-717a-47e9-9701-0ce6be372009', '2026-06-02T20:11:15.117Z');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('ag-1780430990896-zt9jni', 'vault-agent', 'agent', 'bfc8e020-717a-47e9-9701-0ce6be372009', '2026-06-02 20:11:26');
INSERT OR REPLACE INTO "agent_destinations" ("agent_group_id", "local_name", "target_type", "target_id", "created_at") VALUES ('ag-1780430990896-zt9jni', 'save', 'channel', 'mg-1780426909453-ylonzx', '2026-06-02 20:42:29');

-- user_roles
INSERT OR REPLACE INTO "user_roles" ("user_id", "role", "agent_group_id", "granted_by", "granted_at") VALUES ('discord:692022749954310194', 'owner', NULL, NULL, '2026-06-02T15:55:53.394Z');

