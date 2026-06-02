// src/container-config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveSecretRefs, materializeContainerJson } from './container-config.js';

import fs from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const mocked = { ...actual, existsSync: vi.fn(() => true), mkdirSync: vi.fn(), writeFileSync: vi.fn() };
  return { ...mocked, default: mocked };
});
vi.mock('./config.js', () => ({ GROUPS_DIR: '/fake/groups' }));

const mockGetContainerConfig = vi.fn();
vi.mock('./db/container-configs.js', () => ({
  getContainerConfig: (...args: unknown[]) => mockGetContainerConfig(...args),
}));

const mockGetAgentGroup = vi.fn();
vi.mock('./db/agent-groups.js', () => ({
  getAgentGroup: (...args: unknown[]) => mockGetAgentGroup(...args),
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn((keys: string[]) => Object.fromEntries(keys.map((k) => [k, `resolved-${k}`]))),
}));

describe('resolveSecretRefs', () => {
  it('passes through non-$ values unchanged', () => {
    const servers = {
      myserver: {
        command: 'bun',
        env: { HOST: 'https://example.com', NO_PROXY: 'localhost' },
      },
    };
    expect(resolveSecretRefs(servers, {})).toEqual(servers);
  });

  it('resolves $VAR references from envVars map', () => {
    const servers = {
      myserver: {
        command: 'bun',
        env: { API_KEY: '$MY_SECRET', HOST: 'https://example.com' },
      },
    };
    const result = resolveSecretRefs(servers, { MY_SECRET: 'abc123' });
    expect(result.myserver.env).toEqual({ API_KEY: 'abc123', HOST: 'https://example.com' });
  });

  it('throws when $VAR is missing from envVars', () => {
    const servers = {
      myserver: { command: 'bun', env: { API_KEY: '$MISSING_SECRET' } },
    };
    expect(() => resolveSecretRefs(servers, {})).toThrow(
      'MCP server "myserver" references $MISSING_SECRET but it is not set in .env',
    );
  });

  it('handles servers with no env block', () => {
    const servers = { myserver: { command: 'bun' } };
    expect(resolveSecretRefs(servers, {})).toEqual(servers);
  });

  it('resolves refs across multiple servers', () => {
    const servers = {
      server1: { command: 'bun', env: { KEY: '$SECRET_A' } },
      server2: { command: 'node', env: { TOKEN: '$SECRET_B' } },
    };
    const result = resolveSecretRefs(servers, { SECRET_A: 'val-a', SECRET_B: 'val-b' });
    expect(result.server1.env?.KEY).toBe('val-a');
    expect(result.server2.env?.TOKEN).toBe('val-b');
  });

  it('does not mutate the original servers object', () => {
    const original = { s: { command: 'bun', env: { K: '$V' } } };
    resolveSecretRefs(original, { V: 'resolved' });
    expect(original.s.env?.K).toBe('$V');
  });
});

describe('materializeContainerJson', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves $VAR refs in MCP server env before writing container.json', () => {
    mockGetAgentGroup.mockReturnValue({ id: 'ag-1', name: 'test', folder: 'test-group' });
    mockGetContainerConfig.mockReturnValue({
      mcp_servers: JSON.stringify({
        myserver: { command: 'bun', env: { API_KEY: '$MY_SECRET', HOST: 'https://example.com' } },
      }),
      packages_apt: '[]',
      packages_npm: '[]',
      additional_mounts: '[]',
      skills: '"all"',
      provider: null,
      assistant_name: null,
      max_messages_per_prompt: null,
      model: null,
      effort: null,
      image_tag: null,
      cli_scope: 'group',
    });

    materializeContainerJson('ag-1');

    const written = (fs.writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.mcpServers.myserver.env.API_KEY).toBe('resolved-MY_SECRET');
    expect(parsed.mcpServers.myserver.env.HOST).toBe('https://example.com');
  });
});
