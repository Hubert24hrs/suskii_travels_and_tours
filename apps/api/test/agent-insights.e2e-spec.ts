import type { AgentRunEvent } from '@suskii/shared';

import { MockAgentClient } from '../src/agent/chat/agent-client';

import { staffSession } from './helpers/cars';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * What staff see of the assistant's work (ADR-105, ADR-107): runs with the tools they called,
 * travellers' conversations with contact details removed, cost, quality, the limits in force
 * and the switch of one agent. The agent service is played by a script.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghijkl';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijklmn';

interface Run {
  id: string;
  conversationId: string | null;
  audience: string;
  channel: string;
  agent: string;
  status: string;
  outcome: string | null;
  model: string | null;
  promptVersion: string | null;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  toolCallCount: number;
  durationMs: number | null;
}
interface Trace extends Run {
  toolCalls: {
    tool: string;
    tier: string;
    status: string;
    reason: string | null;
    argumentKeys: string[];
  }[];
}

const USAGE = {
  role: 'specialist' as const,
  provider: 'mock',
  model: 'mock-specialist',
  calls: 1,
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
// At the prices below a scripted run costs 1000 * 2 + 200 * 10 = 4000 micro-dollars, and one
// of the mock's own answers (200 tokens in, 30 out) 200 * 2 + 30 * 10 = 700.
const RUN_COST = 4000;
const MOCK_RUN_COST = 700;
const TOTAL_COST = 2 * RUN_COST + 2 * MOCK_RUN_COST;

const ended = (over: Partial<Extract<AgentRunEvent, { type: 'end' }>>): AgentRunEvent =>
  ({
    type: 'end',
    outcome: 'answered',
    agent: 'bookings',
    agents: ['bookings'],
    answer: { kind: 'text', text: 'Here is what I found.', cards: [], sources: [] },
    notice: null,
    confirmationId: null,
    prompts: ['router@1', 'bookings@2'],
    steps: 2,
    usage: [USAGE],
    ...over,
  }) satisfies AgentRunEvent;

describe('assistant insights for staff (e2e)', () => {
  let ctx: TestContext;
  let mock: MockAgentClient;
  let ada: TokenSession;
  let bola: TokenSession;
  let root: { userId: string; headers: Record<string, string> };
  let ops: { userId: string; headers: Record<string, string> };
  let content: { userId: string; headers: Record<string, string> };
  let adaConversation: string;
  let bolaConversation: string;
  let staffConversation: string;
  let tracedRun: string;

  const as = (session: TokenSession) => bearer(session.accessToken);
  const get = (path: string, headers: Record<string, string> = root.headers) =>
    ctx.http().get(`/v1/admin/ai/${path}`).set(headers);

  const start = async (session: TokenSession): Promise<string> =>
    (
      (await ctx.http().post('/v1/agent/conversations').set(as(session)).send({}).expect(201))
        .body as { conversation: { id: string } }
    ).conversation.id;
  const say = async (conversationId: string, text: string, session: TokenSession) => {
    const sent = await ctx
      .http()
      .post('/v1/agent/chat')
      .set(as(session))
      .send({ conversationId, text })
      .expect(202);
    await ctx.background.drain();
    return (sent.body as { runId: string }).runId;
  };

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      AGENT_MODEL_PRICES: {
        'mock-specialist': { input: 2_000_000, output: 10_000_000, cacheRead: 0, cacheWrite: 0 },
      },
      // Half a cent: the runs below cost more, so the month is past the figure to tell at.
      AGENT_MONTHLY_ALERT_MICROUSD: 5000,
      OPS_ALERT_EMAIL: 'ops-insights@suskii.test',
    });
    mock = ctx.app.get(MockAgentClient);
    await ctx.background.drain();
    await resetState(ctx);
    root = await staffSession(ctx, 'insights-root@suskii.test', ['super_admin']);
    ops = await staffSession(ctx, 'insights-ops@suskii.test', ['operations']);
    content = await staffSession(ctx, 'insights-content@suskii.test', ['content_manager']);
    ada = await signUp(ctx, 'insights-ada@example.com');
    bola = await signUp(ctx, 'insights-bola@example.com');

    // Ada's first turn: the agent calls one tool that runs and one that is not its own.
    adaConversation = await start(ada);
    mock.use(async (request, emit) => {
      for (const [tool, agent] of [
        ['platform.status', 'bookings'],
        ['finance.overview', 'bookings'],
      ] as const) {
        await ctx
          .http()
          .post(`/v1/internal/agent-tools/${tool}`)
          .set('authorization', `Bearer ${TOOLS_TOKEN}`)
          .send({ grant: request.grant, agent, arguments: { secretLooking: 'A1234567' } });
      }
      await emit(ended({}));
    });
    tracedRun = await say(
      adaConversation,
      'Reach me on ada.private@example.com or +234 801 234 5678 about passport A1234567, travelling 2027-01-10.',
      ada,
    );
    const answer = await ctx.prisma.agentMessage.findFirstOrThrow({
      where: { conversationId: adaConversation, role: 'assistant' },
    });
    await ctx
      .http()
      .put(`/v1/agent/messages/${answer.id}/feedback`)
      .set(as(ada))
      .send({ feedback: 'up' })
      .expect(200);
    // And she says how the conversation went, out of five.
    await ctx
      .http()
      .put(`/v1/agent/conversations/${adaConversation}/rating`)
      .set(as(ada))
      .send({ score: 4 })
      .expect(200);

    // Her second turn: the guard refused the answer twice, so a notice went out.
    mock.use(async (_request, emit) => {
      await emit(
        ended({ outcome: 'guard_blocked', answer: null, notice: 'cannot_answer', usage: [USAGE] }),
      );
    });
    await say(adaConversation, 'How much is the refund?', ada);

    // Bola's conversation and a staff member's, both with the mock's own answer.
    mock.use(null);
    bolaConversation = await start(bola);
    await say(bolaConversation, 'Hello there, what can you do?', bola);
    staffConversation = (
      (
        await ctx
          .http()
          .post('/v1/admin/ai/conversations')
          .set(ops.headers)
          .send({ locale: 'en-NG' })
          .expect(201)
      ).body as { id: string }
    ).id;
    await ctx
      .http()
      .post('/v1/admin/ai/chat')
      .set(ops.headers)
      .send({ conversationId: staffConversation, text: 'What is waiting today?' })
      .expect(202);
    await ctx.background.drain();
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  it('is for staff who may read the assistant', async () => {
    for (const path of [
      'monitor/runs',
      `monitor/runs/${tracedRun}`,
      'monitor/conversations',
      `monitor/conversations/${adaConversation}`,
      'cost',
      'quality',
      'limits',
      'evals',
    ]) {
      await get(path, content.headers).expect(403);
      await get(path, as(ada)).expect(403);
      await ctx.http().get(`/v1/admin/ai/${path}`).expect(401);
      await get(path, ops.headers).expect(200);
    }
  });

  it('lists runs newest first, by status, agent and audience, a page at a time', async () => {
    const all = (await get('monitor/runs').expect(200)).body as {
      items: Run[];
      nextCursor: string | null;
    };
    expect(all.items).toHaveLength(4);
    expect(all.nextCursor).toBeNull();
    expect(all.items.map((run) => [run.audience, run.channel, run.outcome])).toEqual([
      ['staff', 'console', 'answered'],
      ['customer', 'web', 'answered'],
      ['customer', 'web', 'guard_blocked'],
      ['customer', 'web', 'answered'],
    ]);
    const traced = all.items.find((run) => run.id === tracedRun);
    expect(traced).toMatchObject({
      conversationId: adaConversation,
      agent: 'bookings',
      status: 'succeeded',
      model: 'mock-specialist',
      promptVersion: 'bookings@2',
      inputTokens: 1000,
      outputTokens: 200,
      costMicroUsd: RUN_COST,
      toolCallCount: 2,
    });
    expect(traced?.durationMs).toBeGreaterThanOrEqual(0);

    const staff = (await get('monitor/runs?audience=staff').expect(200)).body as { items: Run[] };
    expect(staff.items.map((run) => run.conversationId)).toEqual([staffConversation]);
    const byAgent = (await get('monitor/runs?agent=bookings').expect(200)).body as { items: Run[] };
    expect(byAgent.items).toHaveLength(2);
    await get('monitor/runs?agent=nobody').expect(400);

    // Two pages of two, linked by the cursor.
    const first = (await get('monitor/runs?limit=2').expect(200)).body as {
      items: Run[];
      nextCursor: string;
    };
    expect(first.items.map((run) => run.id)).toEqual(all.items.slice(0, 2).map((run) => run.id));
    const second = (await get(`monitor/runs?limit=2&cursor=${first.nextCursor}`).expect(200))
      .body as { items: Run[]; nextCursor: string | null };
    expect(second.items.map((run) => run.id)).toEqual(all.items.slice(2).map((run) => run.id));
    expect(second.nextCursor).toBeNull();
  });

  it('shows the tools a run called, by name and outcome, never with what was passed', async () => {
    const response = await get(`monitor/runs/${tracedRun}`).expect(200);
    const trace = response.body as Trace;
    expect(trace.toolCalls.map((call) => [call.tool, call.tier, call.status, call.reason])).toEqual(
      [
        ['platform.status', 'read', 'ok', null],
        // Not the bookings agent's tool: refused, and still on the record.
        ['finance.overview', 'read', 'denied', 'agent'],
      ],
    );
    expect(trace.toolCalls[0]?.argumentKeys).toEqual(['secretLooking']);
    expect(JSON.stringify(response.body)).not.toContain('A1234567');
    await get('monitor/runs/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b').expect(404);
  });

  it("lists travellers' conversations only, and opens one with contact details removed and the read audited", async () => {
    const list = (await get('monitor/conversations').expect(200)).body as {
      items: { id: string; userId: string | null; messageCount: number; channel: string }[];
    };
    expect(list.items.map((item) => item.id)).toEqual([bolaConversation, adaConversation]);
    expect(list.items[1]).toMatchObject({ userId: ada.userId, messageCount: 4, channel: 'web' });

    const before = await ctx.prisma.auditLog.count({
      where: { action: 'agent.conversation_viewed', targetId: adaConversation },
    });
    const opened = await get(`monitor/conversations/${adaConversation}`, ops.headers).expect(200);
    const body = opened.body as {
      messages: {
        role: string;
        kind: string;
        text: string;
        notice: string | null;
        feedback: string | null;
      }[];
    };
    expect(body.messages.map((message) => [message.role, message.kind])).toEqual([
      ['user', 'text'],
      ['assistant', 'text'],
      ['user', 'text'],
      ['assistant', 'notice'],
    ]);
    // What she wrote is shown as the model saw it: the date stays, the rest is removed.
    const first = body.messages[0]?.text ?? '';
    expect(first).toContain('[removed]');
    expect(first).toContain('2027-01-10');
    for (const secret of ['ada.private@example.com', '801 234 5678', 'A1234567']) {
      expect(JSON.stringify(opened.body)).not.toContain(secret);
    }
    expect(body.messages[1]).toMatchObject({ text: 'Here is what I found.', feedback: 'up' });
    expect(body.messages[3]).toMatchObject({ notice: 'cannot_answer', text: '' });

    // The read is on the audit log, under the staff member, with the id and nothing said.
    const logged = await ctx.prisma.auditLog.findMany({
      where: { action: 'agent.conversation_viewed', targetId: adaConversation },
    });
    expect(logged).toHaveLength(before + 1);
    expect(logged.at(-1)).toMatchObject({ actorUserId: ops.userId });
    expect(JSON.stringify(logged)).not.toContain('Reach me');

    // A staff member's own conversation with the staff agents is nobody else's to open.
    await get(`monitor/conversations/${staffConversation}`).expect(404);
    await get('monitor/conversations/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b').expect(404);
  });

  it('adds up what the assistant cost, as an estimate, and carries the month forward', async () => {
    const cost = (await get('cost?days=7').expect(200)).body as {
      basis: string;
      total: { runs: number; inputTokens: number; outputTokens: number; costMicroUsd: number };
      byDay: { day: string; runs: number; costMicroUsd: number }[];
      byAgent: { agent: string; runs: number; costMicroUsd: number }[];
      byModel: { model: string; runs: number; costMicroUsd: number }[];
      byChannel: { channel: string; audience: string; runs: number }[];
      topAccounts: { userId: string; runs: number; costMicroUsd: number }[];
      month: { toDateMicroUsd: number; forecastMicroUsd: number; daysInMonth: number };
      caps: { globalDailyMicroUsd: number };
    };
    expect(cost.basis).toBe('usage_at_configured_prices');
    // Two scripted runs and two of the mock's own answers, at the configured prices.
    expect(cost.total).toMatchObject({ runs: 4, costMicroUsd: TOTAL_COST });
    expect(cost.byDay).toEqual([
      { day: new Date().toISOString().slice(0, 10), runs: 4, costMicroUsd: TOTAL_COST },
    ]);
    expect(cost.byAgent[0]).toMatchObject({
      agent: 'bookings',
      runs: 2,
      costMicroUsd: 2 * RUN_COST,
    });
    expect(cost.byModel.map((row) => row.model)).toContain('mock-specialist');
    expect(cost.byChannel.map((row) => [row.channel, row.audience, row.runs]).sort()).toEqual([
      ['console', 'staff', 1],
      ['web', 'customer', 3],
    ]);
    // Accounts, not staff: Ada's two runs cost most.
    expect(cost.topAccounts[0]).toEqual({
      userId: ada.userId,
      runs: 2,
      costMicroUsd: 2 * RUN_COST,
    });
    expect(cost.topAccounts.map((row) => row.userId)).not.toContain(ops.userId);
    expect(cost.month.toDateMicroUsd).toBe(TOTAL_COST);
    expect(cost.month.forecastMicroUsd).toBeGreaterThanOrEqual(cost.month.toDateMicroUsd);
    expect(cost.caps.globalDailyMicroUsd).toBe(50_000_000);
    await get('cost?days=0').expect(400);
    await get('cost?days=400').expect(400);
  });

  it('says how answers fared: outcomes, refused answers, thumbs, per prompt version', async () => {
    const quality = (await get('quality').expect(200)).body as {
      runs: number;
      answered: number;
      handovers: number;
      guardBlocked: number;
      failed: number;
      outcomes: { outcome: string; runs: number }[];
      feedback: { up: number; down: number };
      ratings: { rated: number; averageTenths: number | null; scores: unknown[] };
      funnel: Record<string, number>;
      prompts: {
        promptVersion: string;
        runs: number;
        answered: number;
        guardBlocked: number;
        up: number;
      }[];
    };
    expect(quality).toMatchObject({
      runs: 4,
      answered: 3,
      handovers: 0,
      guardBlocked: 1,
      failed: 0,
      feedback: { up: 1, down: 0 },
    });
    expect(quality.outcomes).toEqual([
      { outcome: 'answered', runs: 3 },
      { outcome: 'guard_blocked', runs: 1 },
    ]);
    // One traveller rated a conversation four out of five; the mean is kept as tenths.
    expect(quality.ratings).toEqual({
      rated: 1,
      averageTenths: 40,
      scores: [1, 2, 3, 4, 5].map((score) => ({ score, conversations: score === 4 ? 1 : 0 })),
    });
    // Travellers' conversations only (the staff one is not a sale), each once per step.
    expect(quality.funnel).toEqual({
      conversations: 2,
      answered: 2,
      searched: 0,
      askedForAPrice: 0,
      askedToConfirm: 0,
      confirmed: 0,
      handedOver: 0,
    });
    expect(quality.prompts.find((row) => row.promptVersion === 'bookings@2')).toEqual({
      promptVersion: 'bookings@2',
      runs: 2,
      answered: 1,
      guardBlocked: 1,
      up: 1,
      down: 0,
    });
  });

  it('states the limits and the model prices the assistant runs under', async () => {
    const limits = (await get('limits').expect(200)).body as Record<string, unknown>;
    expect(limits).toMatchObject({
      runMaxSteps: 10,
      runMaxToolCalls: 24,
      runTimeoutMs: 120_000,
      globalDailyMicroUsd: 50_000_000,
      monthlyAlertMicroUsd: 5000,
      confirmationMinutes: 15,
      approvalDays: 7,
      models: [
        {
          model: 'mock-specialist',
          inputPerMillion: 2_000_000,
          outputPerMillion: 10_000_000,
        },
      ],
    });
  });

  it("tells operations once when the month's cost is past the figure set, and pauses nothing", async () => {
    const check = () =>
      ctx
        .http()
        .post('/v1/internal/agent/cost-check')
        .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`);
    // The worker's route: not for staff, a traveller or anyone without the worker's token.
    await ctx.http().post('/v1/internal/agent/cost-check').expect(401);
    await ctx.http().post('/v1/internal/agent/cost-check').set(root.headers).expect(401);

    ctx.emails.outbox.length = 0;
    // The audit log is append-only and outlives a run of this suite: count from here.
    const alerts = () => ctx.prisma.auditLog.count({ where: { action: 'agent.cost_alert' } });
    const before = await alerts();
    const spent = (await ctx.prisma.agentRun.aggregate({ _sum: { costMicroUsd: true } }))._sum
      .costMicroUsd;
    const first = (await check().expect(200)).body as {
      toDateMicroUsd: number;
      forecastMicroUsd: number;
      alertAtMicroUsd: number;
      level: string | null;
      told: boolean;
    };
    expect(first).toMatchObject({
      toDateMicroUsd: Number(spent),
      alertAtMicroUsd: 5000,
      level: 'spent',
      told: true,
    });
    expect(first.toDateMicroUsd).toBeGreaterThanOrEqual(TOTAL_COST);
    expect(first.forecastMicroUsd).toBeGreaterThanOrEqual(first.toDateMicroUsd);

    // Told once: an audit entry by the system and one message to the operations mailbox, in
    // amounts, with what the figures are.
    expect(await alerts()).toBe(before + 1);
    const logged = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'agent.cost_alert' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(logged).toMatchObject({ actorType: 'system', actorUserId: null });
    expect(logged.metadata).toMatchObject({
      level: 'spent',
      alertAtUsd: '0.01',
      basis: expect.stringContaining('not an invoice') as string,
    });
    const mails = ctx.emails.outbox.filter((mail) => mail.to === 'ops-insights@suskii.test');
    expect(mails).toHaveLength(1);
    expect(mails[0]?.subject).toBe('[ops] assistant cost');
    expect(mails[0]?.text).toContain('level: spent');

    // The next sweep sees the same month and says nothing more.
    expect((await check().expect(200)).body).toMatchObject({ level: 'spent', told: false });
    expect(await alerts()).toBe(before + 1);
    expect(ctx.emails.outbox.filter((mail) => mail.to === 'ops-insights@suskii.test')).toHaveLength(
      1,
    );
    // It only tells: the assistant still answers.
    await say(bolaConversation, 'Are you still there?', bola);
    const last = await ctx.prisma.agentRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } });
    expect(last.status).toBe('succeeded');
  });

  it('switches one agent off: it is offered to no run and its tools are refused', async () => {
    const flip = (agent: string, enabled: boolean, headers = root.headers) =>
      ctx.http().put(`/v1/admin/ai/agents/${agent}`).set(headers).send({ enabled });
    // Needs the right to manage the assistant.
    await flip('flights', false, ops.headers).expect(403);
    // The two a run falls back to stay on: the pause is what stops everything.
    for (const agent of ['concierge', 'executive']) {
      const refused = await flip(agent, false);
      expect([refused.status, (refused.body as { type: string }).type]).toEqual([
        409,
        expect.stringContaining('agent-always-on'),
      ]);
    }
    await flip('nobody', false).expect(400);

    expect((await flip('flights', false).expect(200)).body).toEqual({
      agent: 'flights',
      enabled: false,
    });
    expect((await flip('flights', false)).status).toBe(409);
    const overview = (await get('overview').expect(200)).body as { disabledAgents: string[] };
    expect(overview.disabledAgents).toEqual(['flights']);

    // The next run is told of every customer agent but that one...
    let offered: string[] = [];
    let refusedCall: { status: string; reason: string | null } | null = null;
    mock.use(async (request, emit) => {
      offered = request.context.agents;
      // ...and a tool called in its name is refused, whatever the agent service says.
      const response = await ctx
        .http()
        .post('/v1/internal/agent-tools/catalog.places')
        .set('authorization', `Bearer ${TOOLS_TOKEN}`)
        .send({ grant: request.grant, agent: 'flights', arguments: { query: 'Lagos' } });
      refusedCall = response.body as { status: string; reason: string | null };
      await emit(ended({ agent: 'concierge', agents: ['concierge'], prompts: ['concierge@2'] }));
    });
    await say(bolaConversation, 'Find me a flight to Abuja', bola);
    expect(offered).not.toContain('flights');
    expect(offered).toContain('concierge');
    expect(offered).toContain('hotels');
    expect(refusedCall).toMatchObject({ status: 'denied', reason: 'agent' });

    // Back on, it is offered again; the change is on the audit log with who made it.
    expect((await flip('flights', true).expect(200)).body).toEqual({
      agent: 'flights',
      enabled: true,
    });
    mock.use(async (request, emit) => {
      offered = request.context.agents;
      await emit(ended({}));
    });
    await say(bolaConversation, 'And now?', bola);
    expect(offered).toContain('flights');
    const logged = await ctx.prisma.auditLog.findMany({
      where: { action: 'agent.agent_switched', actorUserId: root.userId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(logged.map((row) => row.metadata)).toEqual([
      { agent: 'flights', enabled: false },
      { agent: 'flights', enabled: true },
    ]);
  });

  it('keeps the eval runs staff record: the latest of each suite, the history and who recorded one', async () => {
    const record = (body: object, headers: Record<string, string> = root.headers) =>
      ctx.http().post('/v1/admin/ai/evals').set(headers).send(body);
    const routing = {
      suite: 'routing',
      mode: 'recorded',
      passed: true,
      cases: 97,
      held: 93,
      figures: { routed: 93, byRule: 41, passMarkPercent: 90 },
      failed: ['r59', 'r67', 'r80', 'r97'],
      models: [],
      commit: '41cc5bc',
      ranAt: '2026-11-10T09:00:00.000Z',
    };
    const live = {
      suite: 'safety',
      mode: 'live',
      passed: false,
      cases: 38,
      held: 37,
      figures: { violations: 1 },
      failed: ['s12'],
      models: ['claude-opus-5-5'],
      commit: null,
      ranAt: '2026-11-10T10:00:00.000Z',
    };

    expect((await get('evals').expect(200)).body).toEqual({ latest: [], recent: [] });

    // Reading is for every reader of the assistant; recording is for those who manage it.
    await record(routing, ops.headers).expect(403);
    await record(routing, as(ada)).expect(403);
    await ctx.http().post('/v1/admin/ai/evals').send(routing).expect(401);

    const first = (await record(routing).expect(201)).body as { id: string; recordedAt: string };
    expect(first).toMatchObject({ ...routing, id: expect.any(String) as string });
    // The same run a second time is refused, and so are a figure the suite does not report,
    // a live run that names no model, text where a case id belongs and a run still to come.
    expect((await record(routing).expect(409)).body).toMatchObject({
      type: expect.stringContaining('eval-already-recorded') as string,
    });
    await record({
      ...routing,
      ranAt: '2026-11-10T09:30:00.000Z',
      figures: { violations: 0 },
    }).expect(400);
    await record({ ...live, models: [] }).expect(400);
    await record({ ...live, failed: ['ada.private@example.com'] }).expect(400);
    await record({ ...live, ranAt: new Date(Date.now() + 3_600_000).toISOString() }).expect(422);

    // A later run of the same suite replaces it as the latest and both stay in the history.
    const later = {
      ...routing,
      held: 95,
      failed: ['r59', 'r97'],
      ranAt: '2026-11-11T09:00:00.000Z',
    };
    await record(later).expect(201);
    await record(live).expect(201);
    const listed = (await get('evals', ops.headers).expect(200)).body as {
      latest: { suite: string; mode: string; held: number; passed: boolean; models: string[] }[];
      recent: { suite: string; ranAt: string }[];
    };
    expect(listed.latest.map((row) => [row.suite, row.mode, row.held, row.passed])).toEqual([
      ['routing', 'recorded', 95, true],
      ['safety', 'live', 37, false],
    ]);
    expect(listed.latest[1]?.models).toEqual(['claude-opus-5-5']);
    expect(listed.recent.map((row) => [row.suite, row.ranAt])).toEqual([
      ['routing', '2026-11-11T09:00:00.000Z'],
      ['safety', '2026-11-10T10:00:00.000Z'],
      ['routing', '2026-11-10T09:00:00.000Z'],
    ]);

    // The audit log says who recorded which run, with counts only.
    const logged = await ctx.prisma.auditLog.findMany({
      where: { action: 'agent.eval_recorded', actorUserId: root.userId },
      orderBy: { occurredAt: 'asc' },
    });
    expect(logged).toHaveLength(3);
    expect(logged[0]).toMatchObject({
      targetType: 'agent_eval_result',
      targetId: first.id,
      metadata: { suite: 'routing', mode: 'recorded', passed: true, cases: 97, held: 93 },
    });
  });
});
