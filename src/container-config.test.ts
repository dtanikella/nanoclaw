// src/container-config.test.ts
import { describe, it, expect } from 'vitest';
import { resolveSecretRefs, materializeContainerJson } from './container-config.js';

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
