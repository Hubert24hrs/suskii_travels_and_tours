import { describe, expect, it } from 'vitest';

import { loadConfig } from './config.js';

const TOKEN_A = 'a'.repeat(40);
const TOKEN_B = 'b'.repeat(40);
const production = {
  NODE_ENV: 'production',
  API_INTERNAL_URL: 'https://api.internal.example',
  AGENT_TOOLS_TOKEN: TOKEN_A,
  AGENT_RUN_TOKEN: TOKEN_B,
  AGENT_DATABASE_URL: 'postgresql://suskii_agent:secret@db.internal:5432/suskii?sslmode=require',
  AGENT_MODEL_PROVIDER: 'anthropic',
  LLM_API_KEY: 'key',
};

describe('agent service configuration', () => {
  it('runs locally with the mock model, memory checkpoints and nothing set', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      AGENT_PORT: 4200,
      AGENT_MODEL_PROVIDER: 'mock',
      AGENT_MODEL_ROUTER: 'claude-haiku-5-5',
      AGENT_MODEL_SPECIALIST: 'claude-sonnet-5-5',
      AGENT_DATABASE_POOL_MAX: 5,
      AGENT_MAX_CONCURRENT_RUNS: 20,
    });
    expect(config.AGENT_DATABASE_URL).toBeUndefined();
    expect(loadConfig({ AGENT_RUN_TOKEN: '' }).AGENT_RUN_TOKEN).toBeUndefined();
  });

  it('accepts a complete production environment', () => {
    expect(loadConfig(production).AGENT_MODEL_PROVIDER).toBe('anthropic');
  });

  it('refuses production without its tokens, its database, TLS or a real model', () => {
    const refused = (env: Record<string, string | undefined>): string => {
      try {
        loadConfig({ ...production, ...env });
      } catch (error) {
        return (error as Error).message;
      }
      return 'accepted';
    };
    expect(refused({ AGENT_RUN_TOKEN: undefined })).toContain('AGENT_RUN_TOKEN: is required');
    expect(refused({ AGENT_TOOLS_TOKEN: `local-dev-only-${'x'.repeat(30)}` })).toContain(
      'the local development token is not allowed',
    );
    expect(refused({ AGENT_RUN_TOKEN: TOKEN_A })).toContain('must differ from AGENT_TOOLS_TOKEN');
    expect(refused({ API_INTERNAL_URL: 'http://api.internal.example' })).toContain(
      'API_INTERNAL_URL: must be https',
    );
    expect(refused({ AGENT_DATABASE_URL: undefined })).toContain('AGENT_DATABASE_URL: is required');
    expect(
      refused({ AGENT_DATABASE_URL: 'postgresql://suskii_agent:secret@db.internal:5432/suskii' }),
    ).toContain('sslmode=require');
    expect(refused({ AGENT_MODEL_PROVIDER: 'mock' })).toContain('the mock model is not allowed');
    expect(refused({ AGENT_MODEL_PROVIDER: 'mock', ALLOW_MOCK_PROVIDERS: 'true' })).toBe(
      'accepted',
    );
    expect(refused({ LLM_API_KEY: undefined })).toContain('LLM_API_KEY: is required');
    // A private, otherwise encrypted path may be declared.
    expect(
      refused({
        API_INTERNAL_URL: 'http://api.internal.example',
        API_INTERNAL_ALLOW_PLAINTEXT: 'true',
      }),
    ).toBe('accepted');
  });

  it('never echoes a value in an error', () => {
    expect(() => loadConfig({ ...production, AGENT_RUN_TOKEN: 'short-secret' })).toThrow(
      /^Invalid agent environment: AGENT_RUN_TOKEN: [^s]/,
    );
    try {
      loadConfig({ ...production, AGENT_RUN_TOKEN: 'short-secret' });
    } catch (error) {
      expect((error as Error).message).not.toContain('short-secret');
    }
  });

  it('refuses to start with hosted tracing on, in any environment', () => {
    for (const key of ['LANGCHAIN_TRACING_V2', 'LANGSMITH_TRACING', 'LANGCHAIN_TRACING']) {
      expect(() => loadConfig({ [key]: 'true' })).toThrow(/hosted tracing/);
    }
    expect(loadConfig({ LANGSMITH_TRACING: 'false' }).NODE_ENV).toBe('development');
  });
});
