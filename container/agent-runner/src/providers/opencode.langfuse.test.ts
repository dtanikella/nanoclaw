import { describe, it, expect } from 'bun:test';

import { langfuseConfigFragment, LANGFUSE_PLUGIN_SPEC } from './opencode.js';

describe('langfuseConfigFragment', () => {
  it('returns empty config when no Langfuse keys are set', () => {
    expect(langfuseConfigFragment({})).toEqual({});
  });

  it('returns empty config when only one key is set', () => {
    expect(langfuseConfigFragment({ LANGFUSE_PUBLIC_KEY: 'pk-lf-x' })).toEqual({});
    expect(langfuseConfigFragment({ LANGFUSE_SECRET_KEY: 'sk-lf-x' })).toEqual({});
  });

  it('enables OTEL and the pinned plugin when both keys are set', () => {
    const fragment = langfuseConfigFragment({
      LANGFUSE_PUBLIC_KEY: 'pk-lf-x',
      LANGFUSE_SECRET_KEY: 'sk-lf-x',
    });
    expect(fragment).toEqual({
      experimental: { openTelemetry: true },
      plugin: [LANGFUSE_PLUGIN_SPEC],
    });
  });

  it('pins the plugin to an exact version', () => {
    expect(LANGFUSE_PLUGIN_SPEC).toMatch(/@\d+\.\d+\.\d+$/);
  });
});
