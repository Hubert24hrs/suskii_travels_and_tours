import { z } from 'zod';

import { AGENT_NAMES, type AgentPauseReason } from '@suskii/shared';

import { parseEnv } from '../config/env.schema';
import { LocalKeyFieldEncryption } from '../crypto/field-encryption';

import { agentEnabled, priceIntelEnabled } from './agent-flags';
import { AgentGrants, type AgentGrant } from './agent-grants';
import { AGENT_PAUSE_KEY, AgentPause } from './agent-pause';
import { AgentToolRegistry, agentTool, type AgentTool } from './agent-tool';

const config = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  HMAC_SECRET: 'unit-hmac-secret-that-is-at-least-32-chars',
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});

const RUN = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const USER = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

const grant = (over: Partial<AgentGrant> = {}): Omit<AgentGrant, 'expiresAt'> => ({
  runId: RUN,
  conversationId: null,
  userId: USER,
  roles: ['customer'],
  audience: 'customer',
  channel: 'web',
  scopes: ['catalog', 'search', 'quotes', 'support', 'account'],
  locale: 'en-NG',
  currency: 'NGN',
  country: 'NG',
  ...over,
});

describe('agent grants (ADR-101)', () => {
  const encryption = new LocalKeyFieldEncryption(config);
  const grants = new AgentGrants(encryption, config);

  it('opens what it sealed, with the caller and scopes unchanged', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const opened = grants.open(grants.issue(grant(), now), now + 1000);
    expect(opened).toEqual({
      ...grant(),
      expiresAt: new Date(now + config.AGENT_GRANT_TTL_SECONDS * 1000),
    });
  });

  it('carries a guest as no user at all', () => {
    const token = grants.issue(grant({ userId: null, scopes: ['catalog', 'search'] }));
    expect(grants.open(token)).toMatchObject({ userId: null, scopes: ['catalog', 'search'] });
  });

  it('refuses a grant once it has expired', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    const token = grants.issue(grant(), now);
    const ttl = config.AGENT_GRANT_TTL_SECONDS * 1000;
    expect(grants.open(token, now + ttl - 1)).not.toBeNull();
    expect(grants.open(token, now + ttl)).toBeNull();
  });

  it('refuses a token that was altered, is not ours or is not a grant', () => {
    const token = grants.issue(grant());
    const parts = token.split('.');
    const body = parts[3] ?? '';
    const flipped = [...parts];
    flipped[3] = (body.startsWith('A') ? 'B' : 'A') + body.slice(1);
    expect(grants.open(flipped.join('.'))).toBeNull();
    expect(grants.open('')).toBeNull();
    expect(grants.open('not-a-grant')).toBeNull();
    expect(grants.open('x'.repeat(5000))).toBeNull();
    // A ciphertext sealed for another purpose never opens as a grant, whatever it says.
    const other = encryption.encrypt(
      JSON.stringify({ v: 1, r: RUN, u: USER, s: ['finance'] }),
      'support-message:1:body',
    );
    expect(grants.open(other)).toBeNull();
    // Sealed under the right context but not a grant's shape.
    expect(grants.open(encryption.encrypt('{"v":1,"u":"admin"}', 'agent-grant'))).toBeNull();
  });

  it('cannot be read by whoever carries it', () => {
    const token = grants.issue(grant());
    expect(token).not.toContain(USER);
    expect(token).not.toContain('account');
    expect(Buffer.from(token.split('.')[3] ?? '', 'base64url').toString('utf8')).not.toContain(
      USER,
    );
  });
});

describe('agent switches (ADR-101, ADR-107)', () => {
  it('is on outside production and off in production unless set', () => {
    const production = { ...config, NODE_ENV: 'production' as const };
    expect(agentEnabled(config)).toBe(true);
    expect(priceIntelEnabled(config)).toBe(true);
    expect(agentEnabled(production)).toBe(false);
    expect(priceIntelEnabled(production)).toBe(false);
    expect(agentEnabled({ ...production, AGENT_ENABLED: true })).toBe(true);
    expect(agentEnabled({ ...config, AGENT_ENABLED: false })).toBe(false);
    expect(priceIntelEnabled({ ...production, PRICE_INTEL_ENABLED: true })).toBe(true);
  });

  const fakeRedis = (store = new Map<string, string>(), broken = false) => ({
    store,
    get: (key: string) =>
      broken ? Promise.reject(new Error('down')) : Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string, mode: string) => {
      if (mode === 'NX' && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: (key: string) => Promise.resolve(store.delete(key) ? 1 : 0),
  });
  const pauseWith = (redis: ReturnType<typeof fakeRedis>): AgentPause =>
    new AgentPause(redis as never);

  it('pauses once, keeps the first reason and releases', async () => {
    const pause = pauseWith(fakeRedis());
    expect(await pause.state()).toEqual({ paused: false, reason: null, since: null, known: true });
    const at = new Date('2026-11-10T12:00:00.000Z');
    expect(await pause.pause('cost', at)).toBe(true);
    expect(await pause.pause('incident')).toBe(false);
    expect(await pause.state()).toEqual({
      paused: true,
      reason: 'cost' satisfies AgentPauseReason,
      since: at.toISOString(),
      known: true,
    });
    expect(await pause.resume()).toBe(true);
    expect(await pause.resume()).toBe(false);
    expect(await pause.paused()).toBe(false);
  });

  it('counts as paused when the switch cannot be read or holds something unreadable', async () => {
    expect(await pauseWith(fakeRedis(new Map(), true)).state()).toEqual({
      paused: true,
      reason: null,
      since: null,
      known: false,
    });
    const odd = pauseWith(fakeRedis(new Map([[AGENT_PAUSE_KEY, 'yes']])));
    expect(await odd.state()).toMatchObject({ paused: true, known: true });
  });
});

describe('agent tool registry (ADR-107)', () => {
  const tool = (over: Partial<AgentTool> = {}): AgentTool =>
    agentTool({
      name: 'catalog.sample',
      description: 'A sample tool that answers with nothing, for the registry tests.',
      tier: 'read',
      scope: 'catalog',
      agents: ['concierge'],
      input: z.object({ query: z.string().min(2) }),
      output: z.object({}),
      run: () => Promise.resolve({}),
      ...(over as object),
    });

  it('describes a tool with the schema of its arguments', () => {
    const registry = new AgentToolRegistry();
    registry.register(tool());
    expect(registry.describe()).toEqual([
      {
        name: 'catalog.sample',
        description: 'A sample tool that answers with nothing, for the registry tests.',
        tier: 'read',
        scope: 'catalog',
        agents: ['concierge'],
        parameters: expect.objectContaining({
          type: 'object',
          required: ['query'],
          properties: { query: { type: 'string', minLength: 2 } },
        }) as unknown,
      },
    ]);
  });

  it('refuses a name that is malformed, taken or says what an agent never does', () => {
    const registry = new AgentToolRegistry();
    registry.register(tool());
    expect(() => registry.register(tool())).toThrow(/twice/);
    for (const name of ['Sample', 'catalog', 'catalog.Sample', 'a.b.c', 'catalog sample']) {
      expect(() => registry.register(tool({ name }))).toThrow(/area\.action/);
    }
    for (const name of [
      'refunds.approve',
      'payments.capture',
      'payouts.send',
      'ledger.post',
      'pricing.update',
      'bookings.confirm',
      'contracts.sign',
      'approvals.approve',
    ]) {
      expect(() => registry.register(tool({ name }))).toThrow(/never does/);
    }
    expect(registry.list().map((entry) => entry.name)).toEqual(['catalog.sample']);
  });

  it('refuses a tool without agents, a tier, a scope or a usable description', () => {
    const registry = new AgentToolRegistry();
    expect(() => registry.register(tool({ agents: [] }))).toThrow(/agents/);
    expect(() => registry.register(tool({ agents: ['nobody' as never] }))).toThrow(/agents/);
    expect(() => registry.register(tool({ tier: 'admin' as never }))).toThrow(/tier/);
    expect(() => registry.register(tool({ scope: 'everything' as never }))).toThrow(/scope/);
    expect(() => registry.register(tool({ description: 'Short.' }))).toThrow(/description/);
    expect(AGENT_NAMES).toContain('concierge');
  });
});
