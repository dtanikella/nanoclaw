/**
 * Host-side container config for the `opencode` provider.
 *
 * OpenCode's `opencode serve` process stores state under XDG_DATA_HOME, which
 * we pin to a per-session host directory mounted at /opencode-xdg. The
 * OPENCODE_* env vars tell the CLI which provider/model to use at runtime
 * (read on the host, injected into the container). NO_PROXY / no_proxy are
 * merged with host values so the in-container OpenCode client can talk to
 * 127.0.0.1 even when HTTPS_PROXY is set by OneCLI.
 */
import fs from 'fs';
import path from 'path';

import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

function mergeNoProxy(current: string | undefined, additions: string): string {
  if (!current?.trim()) return additions;
  const parts = new Set(
    current
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const addition of additions.split(',')) {
    const trimmed = addition.trim();
    if (trimmed) parts.add(trimmed);
  }
  return [...parts].join(',');
}

const OPENCODE_ENV_KEYS = [
  'OPENCODE_PROVIDER',
  'OPENCODE_MODEL',
  'OPENCODE_SMALL_MODEL',
  'ANTHROPIC_BASE_URL',
] as const;

// Langfuse tracing (opt-in): when the public+secret key pair is present in the
// host .env, the container enables OpenCode's OTEL support and the Langfuse
// observability plugin (see container/agent-runner/src/providers/opencode.ts).
// The plugin reads LANGFUSE_BASEURL (no underscore); LANGFUSE_BASE_URL is
// accepted here as an alias since the rest of the ecosystem spells it that way.
const LANGFUSE_ENV_KEYS = [
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASEURL',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_ENVIRONMENT',
  'LANGFUSE_USER_ID',
] as const;

/**
 * Resolve the LANGFUSE_* env vars to inject into an opencode container.
 * Exported for tests. Returns {} unless both keys are configured, so a
 * half-configured .env can never ship a lone secret into containers.
 * LANGFUSE_USER_ID defaults to the agent group name — traces in Langfuse are
 * then filterable by group without exposing internal ids.
 */
export function resolveLangfuseEnv(
  values: Record<string, string | undefined>,
  agentGroupName: string,
): Record<string, string> {
  if (!values.LANGFUSE_PUBLIC_KEY || !values.LANGFUSE_SECRET_KEY) return {};
  const env: Record<string, string> = {
    LANGFUSE_PUBLIC_KEY: values.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: values.LANGFUSE_SECRET_KEY,
    LANGFUSE_USER_ID: values.LANGFUSE_USER_ID || agentGroupName,
  };
  const baseUrl = values.LANGFUSE_BASEURL || values.LANGFUSE_BASE_URL;
  if (baseUrl) env.LANGFUSE_BASEURL = baseUrl;
  if (values.LANGFUSE_ENVIRONMENT) env.LANGFUSE_ENVIRONMENT = values.LANGFUSE_ENVIRONMENT;
  return env;
}

registerProviderContainerConfig('opencode', (ctx) => {
  const opencodeDir = path.join(ctx.sessionDir, 'opencode-xdg');
  fs.mkdirSync(opencodeDir, { recursive: true });

  // process.env won't have these (plist doesn't load .env), so read directly.
  const fromFile = readEnvFile([...OPENCODE_ENV_KEYS, ...LANGFUSE_ENV_KEYS]);

  const env: Record<string, string> = {
    XDG_DATA_HOME: '/opencode-xdg',
    NO_PROXY: mergeNoProxy(ctx.hostEnv.NO_PROXY, '127.0.0.1,localhost'),
    no_proxy: mergeNoProxy(ctx.hostEnv.no_proxy, '127.0.0.1,localhost'),
  };
  for (const key of OPENCODE_ENV_KEYS) {
    const value = ctx.hostEnv[key] ?? fromFile[key];
    if (value) env[key] = value;
  }

  const langfuseValues: Record<string, string | undefined> = {};
  for (const key of LANGFUSE_ENV_KEYS) {
    langfuseValues[key] = ctx.hostEnv[key] ?? fromFile[key];
  }
  Object.assign(env, resolveLangfuseEnv(langfuseValues, ctx.agentGroupName));

  return {
    mounts: [{ hostPath: opencodeDir, containerPath: '/opencode-xdg', readonly: false }],
    env,
  };
});
