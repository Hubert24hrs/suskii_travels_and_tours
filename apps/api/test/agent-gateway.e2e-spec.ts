import { z } from 'zod';

import { isForbiddenAgentTool, type AgentScope } from '@suskii/shared';

import { AgentBudget } from '../src/agent/agent-budget';
import { AgentGrants, type AgentGrant } from '../src/agent/agent-grants';
import { AGENT_PAUSE_KEY } from '../src/agent/agent-pause';
import { AgentToolError, AgentToolRegistry, agentTool } from '../src/agent/agent-tool';
import { uuidv7 } from '../src/common/uuid';
import { agentMessageContext } from '../src/crypto/encryption-contexts';
import { FieldEncryption } from '../src/crypto/field-encryption';

import { staffSession } from './helpers/admin';
import { bearer, PASSWORD, signUp, type TokenSession } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * The agent's tool gateway (ADR-101, ADR-107): only the agent service's own token opens it; a
 * call runs only for a sealed, unexpired grant of a running run, for a tool that is the calling
 * agent's, inside the grant's scopes, at an autonomy that lets its tier run and within the run's
 * call limit; commits never run; only what a tool's output schema names goes back; and each call
 * is recorded without argument values. Staff can pause everything at once.
 */

const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghij';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijkl';
const MAX_CALLS = 6;

interface Answer {
  status: 'ok' | 'denied' | 'error' | 'timeout';
  reason: string | null;
  result: unknown;
  issues?: { path: string; code: string }[];
}

describe('agent tool gateway (e2e)', () => {
  let ctx: TestContext;
  let grants: AgentGrants;
  let traveller: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_URL: 'http://localhost:4200',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      AGENT_RUN_MAX_TOOL_CALLS: MAX_CALLS,
    });
    grants = ctx.app.get(AgentGrants);
    // Tools of every kind the gateway must handle, registered for this suite only.
    const registry = ctx.app.get(AgentToolRegistry);
    registry.register(
      agentTool({
        name: 'testing.draft_note',
        description: 'Prepares a note for a person to approve; commits nothing (test only).',
        tier: 'propose',
        scope: 'quotes',
        agents: ['concierge'],
        input: z.object({ topic: z.string().min(1).max(40) }),
        output: z.object({ drafted: z.boolean() }),
        run: () => Promise.resolve({ drafted: true }),
      }),
    );
    registry.register(
      agentTool({
        name: 'testing.cancel_trip',
        description: 'Changes state, so it only ever becomes a confirmation card (test only).',
        tier: 'commit',
        scope: 'account',
        agents: ['bookings'],
        input: z.object({}),
        output: z.object({}),
        run: () => Promise.reject(new Error('a commit must never run from the gateway')),
      }),
    );
    registry.register(
      agentTool({
        name: 'testing.read_record',
        description: 'Reads a record whose service returns more than a model may see (test only).',
        tier: 'read',
        scope: 'account',
        agents: ['bookings'],
        input: z.object({ which: z.enum(['mine', 'missing', 'broken']) }),
        output: z.object({ status: z.string(), owner: z.string() }),
        run: (input, context) => {
          if (input.which === 'missing') throw new AgentToolError('not_found');
          if (input.which === 'broken') throw new Error('passport A1234567 leaked into an error');
          return Promise.resolve({
            status: 'CONFIRMED',
            owner: context.grant.userId ?? 'guest',
            // Not in the output schema: must never reach the model.
            passportNumber: 'A1234567',
            email: 'someone@example.com',
          } as { status: string; owner: string });
        },
      }),
    );
    registry.register(
      agentTool({
        name: 'testing.staff_report',
        description: 'A report for staff in the console, never for a traveller (test only).',
        tier: 'read',
        scope: 'reports',
        agents: ['business_intelligence'],
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        run: () => Promise.resolve({ ok: true }),
      }),
    );
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    traveller = await signUp(ctx, 'agent-traveller@example.com');
  });
  afterAll(async () => {
    await ctx.close();
  });

  const run = async (status: 'running' | 'succeeded' = 'running'): Promise<string> =>
    (
      await ctx.prisma.agentRun.create({
        data: {
          audience: 'customer',
          channel: 'web',
          agent: 'concierge',
          trigger: 'message',
          status,
        },
      })
    ).id;

  const grantFor = (runId: string, over: Partial<AgentGrant> = {}): string =>
    grants.issue({
      runId,
      conversationId: null,
      userId: traveller.userId,
      roles: ['customer'],
      audience: 'customer',
      channel: 'web',
      scopes: ['catalog', 'search', 'quotes', 'support', 'account'],
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
      ...over,
    });

  const call = async (
    tool: string,
    body: { grant: string; agent?: string; arguments?: Record<string, unknown> },
    token = TOOLS_TOKEN,
  ): Promise<Answer> => {
    const response = await ctx
      .http()
      .post(`/v1/internal/agent-tools/${tool}`)
      .set('authorization', `Bearer ${token}`)
      .send({ agent: 'concierge', arguments: {}, ...body });
    expect(response.status).toBe(200);
    return response.body as Answer;
  };

  const calls = (runId: string) =>
    ctx.prisma.agentToolCall.findMany({ where: { runId }, orderBy: { id: 'asc' } });

  it('opens only to the agent service token', async () => {
    const grant = grantFor(await run());
    const body = { grant, agent: 'concierge', arguments: { query: 'Lagos' } };
    const post = (authorization?: string) => {
      const request = ctx.http().post('/v1/internal/agent-tools/catalog.places');
      return (authorization ? request.set('authorization', authorization) : request).send(body);
    };
    expect((await post()).status).toBe(401);
    expect((await post('Bearer wrong-token-0123456789abcdefghijklmnopqrstu')).status).toBe(401);
    // The worker's token and the API's own token to the agent service open nothing here.
    expect((await post(`Bearer ${E2E_INTERNAL_TOKEN}`)).status).toBe(401);
    expect((await post(`Bearer ${RUN_TOKEN}`)).status).toBe(401);
    // A traveller's session is not a service token either.
    expect((await post(`Bearer ${traveller.accessToken}`)).status).toBe(401);
    expect((await ctx.http().get('/v1/internal/agent-tools')).status).toBe(401);
    // And the agent's token opens none of the worker's routes.
    const worker = await ctx
      .http()
      .post('/v1/internal/retention/run')
      .set('authorization', `Bearer ${TOOLS_TOKEN}`);
    expect(worker.status).toBe(401);
  });

  it('lists its tools with tiers, scopes and argument schemas, none of them forbidden', async () => {
    const response = await ctx
      .http()
      .get('/v1/internal/agent-tools')
      .set('authorization', `Bearer ${TOOLS_TOKEN}`);
    expect(response.status).toBe(200);
    const tools = (
      response.body as {
        tools: {
          name: string;
          tier: string;
          scope: string;
          agents: string[];
          description: string;
          parameters: { type?: string };
        }[];
      }
    ).tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['catalog.places', 'platform.status']));
    for (const tool of tools) {
      expect([tool.name, isForbiddenAgentTool(tool.name)]).toEqual([tool.name, false]);
      expect(['read', 'propose', 'commit']).toContain(tool.tier);
      expect(tool.agents.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters.type).toBe('object');
    }
    // Everything shipped today only reads (the test tools aside).
    for (const tool of tools.filter((entry) => !entry.name.startsWith('testing.'))) {
      expect([tool.name, tool.tier]).toEqual([tool.name, 'read']);
    }
  });

  it('runs a read tool for the grant and records the call without its values', async () => {
    const runId = await run();
    const answer = await call('catalog.places', {
      grant: grantFor(runId),
      arguments: { query: 'Lagos', limit: 3 },
    });
    expect(answer).toMatchObject({ status: 'ok', reason: null });
    const places = (answer.result as { places: { type: string; code?: string }[] }).places;
    expect(places.some((place) => place.type === 'airport' && place.code === 'LOS')).toBe(true);

    const status = await call('platform.status', { grant: grantFor(runId) });
    expect(status.status).toBe('ok');
    expect(status.result).toMatchObject({ state: expect.any(String) as unknown });

    const recorded = await calls(runId);
    expect(recorded.map((row) => [row.tool, row.tier, row.status, row.reason])).toEqual([
      ['catalog.places', 'read', 'ok', null],
      ['platform.status', 'read', 'ok', null],
    ]);
    expect(recorded[0]?.argumentKeys).toEqual(['query', 'limit']);
    expect(JSON.stringify(recorded)).not.toContain('Lagos');
    const after = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(after.toolCallCount).toBe(2);
  });

  it('refuses a grant that is missing, altered, expired or for a run that has ended', async () => {
    const runId = await run();
    const good = grantFor(runId);
    const args = { arguments: { query: 'Lagos' } };
    expect(await call('catalog.places', { grant: 'not-a-grant', ...args })).toMatchObject({
      status: 'denied',
      reason: 'grant',
      result: null,
    });
    const parts = good.split('.');
    parts[3] = `${parts[3]?.startsWith('A') ? 'B' : 'A'}${parts[3]?.slice(1) ?? ''}`;
    expect((await call('catalog.places', { grant: parts.join('.'), ...args })).reason).toBe(
      'grant',
    );
    const expired = grants.seal({
      runId,
      conversationId: null,
      userId: traveller.userId,
      roles: ['customer'],
      audience: 'customer',
      channel: 'web',
      scopes: ['catalog'],
      locale: 'en-NG',
      currency: 'NGN',
      country: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await call('catalog.places', { grant: expired, ...args })).reason).toBe('grant');
    // Nothing above reached a run, so nothing was recorded or counted.
    expect(await calls(runId)).toEqual([]);

    const ended = await run('succeeded');
    expect((await call('catalog.places', { grant: grantFor(ended), ...args })).reason).toBe(
      'grant',
    );
    const unknownRun = grantFor('0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
    expect((await call('catalog.places', { grant: unknownRun, ...args })).reason).toBe('grant');
  });

  it('keeps an agent to its own tools, audience, channel and scopes', async () => {
    const runId = await run();
    const grant = grantFor(runId);
    // Not this agent's tool.
    expect(
      (
        await call('testing.read_record', {
          grant,
          agent: 'concierge',
          arguments: { which: 'mine' },
        })
      ).reason,
    ).toBe('agent');
    // A staff agent never answers on a traveller's grant, even for a tool it owns.
    expect(
      (await call('testing.staff_report', { grant, agent: 'business_intelligence' })).reason,
    ).toBe('agent');
    // A name that is no agent at all.
    expect(
      (await call('catalog.places', { grant, agent: 'root', arguments: { query: 'Lagos' } }))
        .reason,
    ).toBe('agent');
    // No such tool; the model's text is not kept as a tool name.
    expect((await call('bookings.delete_everything', { grant })).reason).toBe('unknown_tool');
    // A guest's grant opens no account tool.
    const guest = grantFor(runId, {
      userId: null,
      scopes: ['catalog', 'search', 'quotes', 'support'] satisfies AgentScope[],
    });
    expect(
      (
        await call('testing.read_record', {
          grant: guest,
          agent: 'bookings',
          arguments: { which: 'mine' },
        })
      ).reason,
    ).toBe('scope');
    // A console grant with the scope reaches the staff tool.
    const staffRun = (
      await ctx.prisma.agentRun.create({
        data: {
          audience: 'staff',
          channel: 'console',
          agent: 'business_intelligence',
          trigger: 'message',
        },
      })
    ).id;
    const console = grantFor(staffRun, {
      audience: 'staff',
      channel: 'console',
      roles: ['finance'],
      scopes: ['catalog', 'search', 'reports'],
    });
    expect(
      (await call('testing.staff_report', { grant: console, agent: 'business_intelligence' }))
        .status,
    ).toBe('ok');
    // ...and a traveller agent cannot be named on a console grant.
    expect(
      (
        await call('catalog.places', {
          grant: console,
          agent: 'concierge',
          arguments: { query: 'Lagos' },
        })
      ).reason,
    ).toBe('agent');

    const recorded = await calls(runId);
    expect(recorded.map((row) => [row.tool, row.status, row.reason])).toEqual([
      ['testing.read_record', 'denied', 'agent'],
      ['testing.staff_report', 'denied', 'agent'],
      ['catalog.places', 'denied', 'agent'],
      ['unknown', 'denied', 'unknown_tool'],
      ['testing.read_record', 'denied', 'scope'],
    ]);
    expect(recorded[2]?.agent).toBe('unknown');
    expect(JSON.stringify(recorded)).not.toContain('delete_everything');
  });

  it('never runs a commit, and runs a proposal only above manual', async () => {
    const admin = await staffSession(ctx, 'agent-admin@suskii.test', ['super_admin']);
    const runId = await run();
    const grant = grantFor(runId);
    expect(await call('testing.cancel_trip', { grant, agent: 'bookings' })).toMatchObject({
      status: 'denied',
      reason: 'confirmation_required',
    });
    const draft = () =>
      call('testing.draft_note', { grant, agent: 'concierge', arguments: { topic: 'visa' } });
    expect((await draft()).status).toBe('ok');

    const setLevel = (subject: string, name: string, level: string) =>
      ctx
        .http()
        .put('/v1/admin/ai/autonomy')
        .set(bearer(admin.accessToken))
        .send({ subject, name, level });
    // The tool set to advice only: it prepares nothing, whatever its agent may do.
    expect((await setLevel('tool', 'testing.draft_note', 'manual')).status).toBe(200);
    expect(await draft()).toMatchObject({ status: 'denied', reason: 'autonomy' });
    expect((await setLevel('tool', 'testing.draft_note', 'autonomous')).status).toBe(200);
    expect((await draft()).status).toBe('ok');
    // The agent set to advice only: its proposals stop, its reads go on.
    expect((await setLevel('agent', 'concierge', 'manual')).status).toBe(200);
    expect((await draft()).reason).toBe('autonomy');
    expect((await call('catalog.places', { grant, arguments: { query: 'Lagos' } })).status).toBe(
      'ok',
    );
    // Even at the highest level a commit does not run.
    expect((await setLevel('agent', 'bookings', 'autonomous')).status).toBe(200);
    expect((await setLevel('tool', 'testing.cancel_trip', 'autonomous')).status).toBe(200);
    expect(
      (await call('testing.cancel_trip', { grant: grantFor(await run()), agent: 'bookings' }))
        .reason,
    ).toBe('confirmation_required');

    expect((await setLevel('agent', 'concierge', 'manual')).status).toBe(409);
    expect((await setLevel('agent', 'nobody', 'manual')).status).toBe(404);
    expect((await setLevel('tool', 'bookings.nothing', 'manual')).status).toBe(404);
    expect((await setLevel('agent', 'concierge', 'unlimited')).status).toBe(400);
    const changes = await ctx.prisma.auditLog.findMany({
      where: { action: 'agent.autonomy_changed', actorUserId: admin.userId },
      orderBy: { id: 'asc' },
    });
    expect(changes.map((entry) => entry.metadata)).toEqual([
      {
        subject: 'tool',
        name: 'testing.draft_note',
        from: 'supervised',
        to: 'manual',
        raised: false,
      },
      {
        subject: 'tool',
        name: 'testing.draft_note',
        from: 'manual',
        to: 'autonomous',
        raised: true,
      },
      { subject: 'agent', name: 'concierge', from: 'supervised', to: 'manual', raised: false },
      { subject: 'agent', name: 'bookings', from: 'supervised', to: 'autonomous', raised: true },
      {
        subject: 'tool',
        name: 'testing.cancel_trip',
        from: 'supervised',
        to: 'autonomous',
        raised: true,
      },
    ]);
  });

  it('checks arguments, strips what a tool may not return and hides why a tool failed', async () => {
    const runId = await run();
    const grant = grantFor(runId);
    const invalid = await call('catalog.places', { grant, arguments: { query: 'L', limit: 99 } });
    expect(invalid).toMatchObject({ status: 'denied', reason: 'invalid', result: null });
    expect(invalid.issues?.map((issue) => issue.path).sort()).toEqual(['limit', 'query']);

    const read = (which: string) =>
      call('testing.read_record', { grant, agent: 'bookings', arguments: { which } });
    const mine = await read('mine');
    expect(mine).toEqual({
      status: 'ok',
      reason: null,
      // The caller is the grant's, and the fields outside the schema are gone.
      result: { status: 'CONFIRMED', owner: traveller.userId },
    });
    expect(await read('missing')).toMatchObject({ status: 'error', reason: 'not_found' });
    const broken = await read('broken');
    expect(broken).toEqual({ status: 'error', reason: 'failed', result: null });
    expect(JSON.stringify(broken)).not.toContain('A1234567');
    expect(JSON.stringify(await calls(runId))).not.toContain('A1234567');
  });

  it('stops a run at its tool call limit, refused calls included', async () => {
    const runId = await run();
    const grant = grantFor(runId);
    const outcomes: (string | null)[] = [];
    for (let attempt = 0; attempt < MAX_CALLS + 2; attempt += 1) {
      // Every other call is refused; both kinds use up the run's calls.
      const answer =
        attempt % 2 === 0
          ? await call('catalog.places', { grant, arguments: { query: 'Abuja' } })
          : await call('bookings.nothing_here', { grant });
      outcomes.push(answer.reason);
    }
    expect(outcomes).toEqual([
      null,
      'unknown_tool',
      null,
      'unknown_tool',
      null,
      'unknown_tool',
      'limit',
      'limit',
    ]);
    const after = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(after.toolCallCount).toBe(MAX_CALLS);
    // Another run of the same person is not affected.
    expect(
      (
        await call('catalog.places', {
          grant: grantFor(await run()),
          arguments: { query: 'Abuja' },
        })
      ).status,
    ).toBe('ok');
  });

  it('lets staff pause everything at once, and release it only with ai:manage', async () => {
    const admin = await staffSession(ctx, 'agent-admin@suskii.test', ['super_admin']);
    const support = await staffSession(ctx, 'agent-support@suskii.test', ['support']);
    const runId = await run();
    const grant = grantFor(runId);
    const places = () => call('catalog.places', { grant, arguments: { query: 'Lagos' } });
    const status = async () =>
      (await ctx.http().get('/v1/agent/status')).body as Record<string, boolean>;

    expect(await status()).toEqual({ enabled: true, paused: false, available: true });
    expect((await places()).status).toBe('ok');

    // Support reads the overview but cannot switch anything; a traveller sees none of it.
    const overview = (session: TokenSession) =>
      ctx.http().get('/v1/admin/ai/overview').set(bearer(session.accessToken));
    expect((await overview(support)).status).toBe(200);
    expect((await overview(traveller)).status).toBe(403);
    const pause = (session: TokenSession, reason = 'incident') =>
      ctx.http().post('/v1/admin/ai/pause').set(bearer(session.accessToken)).send({ reason });
    expect((await pause(support)).status).toBe(403);
    expect((await pause(admin, 'because I said so')).status).toBe(400);

    const paused = await pause(admin);
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ paused: true, reason: 'incident', known: true });
    expect((await pause(admin, 'cost')).status).toBe(409);
    expect(await status()).toEqual({ enabled: true, paused: true, available: false });
    expect(await places()).toMatchObject({ status: 'denied', reason: 'paused' });
    const seen = (await overview(admin)).body as {
      pause: { paused: boolean; reason: string };
      tools: { name: string }[];
      autonomy: { subject: string; name: string; level: string; set: boolean }[];
      spend: { todayMicroUsd: number; dailyCapMicroUsd: number };
      runs: { today: number };
    };
    expect(seen.pause).toMatchObject({ paused: true, reason: 'incident' });
    expect(seen.tools.map((tool) => tool.name)).toContain('catalog.places');
    expect(seen.autonomy).toContainEqual({
      subject: 'agent',
      name: 'concierge',
      level: 'supervised',
      set: false,
    });
    expect(seen.runs.today).toBe(1);
    expect(seen.spend).toEqual({
      todayMicroUsd: 0,
      dailyCapMicroUsd: ctx.config.AGENT_GLOBAL_DAILY_MICROUSD,
    });

    const resume = (session: TokenSession) =>
      ctx.http().post('/v1/admin/ai/resume').set(bearer(session.accessToken));
    expect((await resume(support)).status).toBe(403);
    expect((await resume(admin)).status).toBe(200);
    expect((await resume(admin)).status).toBe(409);
    expect((await places()).status).toBe('ok');
    const audit = await ctx.prisma.auditLog.findMany({
      // The audit log is append-only and outlives a reset: this run's admin only.
      where: { action: { in: ['agent.paused', 'agent.resumed'] }, actorUserId: admin.userId },
      orderBy: { id: 'asc' },
    });
    expect(audit.map((entry) => [entry.action, entry.actorUserId])).toEqual([
      ['agent.paused', admin.userId],
      ['agent.resumed', admin.userId],
    ]);
    expect(audit[0]?.metadata).toEqual({ reason: 'incident' });

    // A switch nobody can read counts as paused.
    await ctx.redis.set(AGENT_PAUSE_KEY, 'corrupted');
    expect((await places()).reason).toBe('paused');
  });

  it('caps what a person, a guest and everyone together may spend in a day', async () => {
    const capped = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_RUN_RESERVE_MICROUSD: 40_000,
      AGENT_USER_DAILY_MICROUSD: 100_000,
      AGENT_GUEST_DAILY_MICROUSD: 50_000,
      AGENT_GLOBAL_DAILY_MICROUSD: 150_000,
    });
    try {
      await capped.redis.flushdb();
      const budget = capped.app.get(AgentBudget);
      const user = { userId: traveller.userId };
      const first = await budget.reserve(user);
      const second = await budget.reserve(user);
      expect(typeof first).toBe('object');
      expect(typeof second).toBe('object');
      // A third run would pass the person's cap.
      expect(await budget.reserve(user)).toBe('caller');
      // A guest has a smaller cap of their own.
      expect(typeof (await budget.reserve({ guestKey: 'hmac-of-an-address' }))).toBe('object');
      expect(await budget.reserve({ guestKey: 'hmac-of-an-address' })).toBe('caller');
      expect(await budget.spentToday()).toBe(120_000);
      // Someone else is stopped by the total.
      expect(await budget.reserve({ userId: 'another-user' })).toBe('global');
      // Settling to what was billed frees the difference.
      if (typeof first === 'object') await budget.settle(first, 5_000);
      expect(await budget.spentToday()).toBe(85_000);
      expect(typeof (await budget.reserve({ userId: 'another-user' }))).toBe('object');
    } finally {
      await capped.redis.flushdb();
      await capped.close();
    }
  });
});

describe("the assistant's records and a person's rights (e2e)", () => {
  let ctx: TestContext;
  let traveller: TokenSession;
  const DAY_MS = 86_400_000;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    traveller = await signUp(ctx, 'agent-rights@example.com');
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** A conversation with one message each way and the run that answered, as the chat stores it. */
  async function conversation(
    userId: string | null,
    lastMessageAt = new Date(),
  ): Promise<{ id: string; runId: string }> {
    const encryption = ctx.app.get(FieldEncryption);
    const created = await ctx.prisma.agentConversation.create({
      data: {
        reference: `A-${Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, 'X')}`,
        userId,
        audience: 'customer',
        channel: 'web',
        locale: 'en-NG',
        currency: 'NGN',
        country: 'NG',
        lastMessageAt,
        messageCount: 2,
      },
    });
    const run = await ctx.prisma.agentRun.create({
      data: {
        conversationId: created.id,
        audience: 'customer',
        channel: 'web',
        agent: 'concierge',
        trigger: 'message',
        status: 'succeeded',
        startedAt: lastMessageAt,
        toolCalls: {
          create: { agent: 'concierge', tool: 'catalog.places', tier: 'read', status: 'ok' },
        },
      },
    });
    for (const [role, text] of [
      ['user', 'Is Lagos to London cheaper on Tuesday?'],
      ['assistant', 'Here are the Tuesday fares I found.'],
    ] as const) {
      const id = uuidv7();
      await ctx.prisma.agentMessage.create({
        data: {
          id,
          conversationId: created.id,
          role,
          agent: role === 'assistant' ? 'flights' : null,
          bodyEncrypted: encryption.encrypt(text, agentMessageContext(id)),
          runId: role === 'assistant' ? run.id : null,
        },
      });
    }
    return { id: created.id, runId: run.id };
  }

  it('stores messages sealed, exports them to their owner and to nobody else', async () => {
    const mine = await conversation(traveller.userId);
    const other = await signUp(ctx, 'agent-other@example.com');
    await conversation(other.userId);

    const stored = await ctx.prisma.agentMessage.findMany({ where: { conversationId: mine.id } });
    expect(stored).toHaveLength(2);
    for (const message of stored) {
      expect(message.bodyEncrypted).toMatch(/^v2\./);
      expect(message.bodyEncrypted).not.toContain('Lagos');
    }
    // A body moved to another message does not open: the context binds it to its row.
    const [first, second] = stored;
    expect(() =>
      ctx.app
        .get(FieldEncryption)
        .decrypt(first?.bodyEncrypted ?? '', agentMessageContext(second?.id ?? '')),
    ).toThrow();

    const response = await ctx
      .http()
      .post('/v1/me/data-export')
      .set(bearer(traveller.accessToken))
      .send({ password: PASSWORD })
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks).toString('utf8')));
      })
      .expect(200);
    const document = JSON.parse(response.body as string) as {
      data: { assistant: { reference: string; messages: { from: string; text: string }[] }[] };
    };
    expect(document.data.assistant).toHaveLength(1);
    expect(document.data.assistant[0]?.messages).toEqual([
      expect.objectContaining({ from: 'you', text: 'Is Lagos to London cheaper on Tuesday?' }),
      expect.objectContaining({ from: 'assistant', text: 'Here are the Tuesday fares I found.' }),
    ]);
  });

  it('deletes conversations with the account and keeps the runs without a link to anyone', async () => {
    const mine = await conversation(traveller.userId);
    const other = await signUp(ctx, 'agent-stays@example.com');
    const theirs = await conversation(other.userId);

    await ctx
      .http()
      .post('/v1/me/deletion')
      .set(bearer(traveller.accessToken))
      .send({ password: PASSWORD, confirm: 'DELETE' })
      .expect(200);

    expect(await ctx.prisma.agentConversation.count({ where: { userId: traveller.userId } })).toBe(
      0,
    );
    expect(await ctx.prisma.agentMessage.count({ where: { conversationId: mine.id } })).toBe(0);
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({
      where: { id: mine.runId },
      include: { toolCalls: true },
    });
    expect(run.conversationId).toBeNull();
    expect(run.toolCalls).toHaveLength(1);
    // Someone else's conversation is untouched.
    expect(await ctx.prisma.agentMessage.count({ where: { conversationId: theirs.id } })).toBe(2);
    expect(
      (await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: theirs.runId } })).conversationId,
    ).toBe(theirs.id);
  });

  it('purges conversations a year after their last message and runs after 400 days', async () => {
    const now = Date.now();
    const recent = await conversation(traveller.userId, new Date(now - 364 * DAY_MS));
    const old = await conversation(traveller.userId, new Date(now - 366 * DAY_MS));
    const ancient = await conversation(traveller.userId, new Date(now - 401 * DAY_MS));

    const sweep = await ctx
      .http()
      .post('/v1/internal/retention/run')
      .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
      .expect(200);
    expect(sweep.body).toMatchObject({ 'agent-conversations': 2, 'agent-runs': 1 });

    expect(
      await ctx.prisma.agentConversation.findUnique({ where: { id: recent.id } }),
    ).not.toBeNull();
    expect(await ctx.prisma.agentConversation.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await ctx.prisma.agentMessage.count({ where: { conversationId: old.id } })).toBe(0);
    // The run of the year-old conversation stays, unlinked, until its own 400 days are up.
    expect(
      (await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: old.runId } })).conversationId,
    ).toBeNull();
    expect(await ctx.prisma.agentRun.findUnique({ where: { id: ancient.runId } })).toBeNull();
    expect(await ctx.prisma.agentToolCall.count({ where: { runId: ancient.runId } })).toBe(0);
  });
});

describe('agent switched off (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: false,
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
    });
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('says so to clients and has no gateway', async () => {
    expect((await ctx.http().get('/v1/agent/status')).body).toEqual({
      enabled: false,
      paused: false,
      available: false,
    });
    const list = await ctx
      .http()
      .get('/v1/internal/agent-tools')
      .set('authorization', `Bearer ${TOOLS_TOKEN}`);
    expect(list.status).toBe(404);
    const call = await ctx
      .http()
      .post('/v1/internal/agent-tools/catalog.places')
      .set('authorization', `Bearer ${TOOLS_TOKEN}`)
      .send({ grant: 'x', agent: 'concierge', arguments: {} });
    expect(call.status).toBe(404);
    // The rest of the platform does not notice.
    expect((await ctx.http().get('/v1/catalog/places?q=Lagos')).status).toBe(200);
    expect((await ctx.http().get('/v1/status')).status).toBe(200);
  });
});
