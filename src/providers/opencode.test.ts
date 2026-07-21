import { describe, it, expect } from 'vitest';

import { resolveLangfuseEnv } from './opencode.js';

describe('resolveLangfuseEnv', () => {
  const keys = {
    LANGFUSE_PUBLIC_KEY: 'pk-lf-x',
    LANGFUSE_SECRET_KEY: 'sk-lf-x',
  };

  it('returns nothing when keys are absent', () => {
    expect(resolveLangfuseEnv({}, 'main')).toEqual({});
  });

  it('returns nothing when only one key is present', () => {
    expect(resolveLangfuseEnv({ LANGFUSE_PUBLIC_KEY: 'pk-lf-x' }, 'main')).toEqual({});
    expect(resolveLangfuseEnv({ LANGFUSE_SECRET_KEY: 'sk-lf-x' }, 'main')).toEqual({});
  });

  it('injects keys and defaults user id to the agent group name', () => {
    expect(resolveLangfuseEnv(keys, 'finance-dd')).toEqual({
      LANGFUSE_PUBLIC_KEY: 'pk-lf-x',
      LANGFUSE_SECRET_KEY: 'sk-lf-x',
      LANGFUSE_USER_ID: 'finance-dd',
    });
  });

  it('prefers an explicit LANGFUSE_USER_ID over the group name', () => {
    expect(resolveLangfuseEnv({ ...keys, LANGFUSE_USER_ID: 'me' }, 'main').LANGFUSE_USER_ID).toBe('me');
  });

  it('normalizes LANGFUSE_BASE_URL to LANGFUSE_BASEURL', () => {
    expect(
      resolveLangfuseEnv({ ...keys, LANGFUSE_BASE_URL: 'https://us.cloud.langfuse.com' }, 'main').LANGFUSE_BASEURL,
    ).toBe('https://us.cloud.langfuse.com');
  });

  it('passes LANGFUSE_BASEURL and LANGFUSE_ENVIRONMENT through', () => {
    const env = resolveLangfuseEnv(
      { ...keys, LANGFUSE_BASEURL: 'https://cloud.langfuse.com', LANGFUSE_ENVIRONMENT: 'production' },
      'main',
    );
    expect(env.LANGFUSE_BASEURL).toBe('https://cloud.langfuse.com');
    expect(env.LANGFUSE_ENVIRONMENT).toBe('production');
  });
});
