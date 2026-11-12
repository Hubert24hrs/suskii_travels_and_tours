import type { AgentRunEvent, AgentRunRequest } from '@suskii/shared';

import { MockAgentClient } from '../src/agent/chat/agent-client';

import { staffSession } from './helpers/admin';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Shadow turns (ADR-106) end to end, with the agent service played by a mock the tests script:
 * which runs are asked to try a candidate prompt, that the traveller has their answer before
 * anything about the candidate arrives, what is kept of it (codes and counts), how its spend is
 * held apart from the assistant's, and what staff are shown.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefgh';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghij';
const CANDIDATE = 'flights@9';

type End = Extract<AgentRunEvent, { type: 'end' }>;
type Shadow = Extract<AgentRunEvent, { type: 'shadow' }>;

/** One model call: 1000 * 2 + 200 * 10 = 4000 micro-dollars at the prices below. */
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
const answered = (text: string, over: Partial<End> = {}): End => ({
  type: 'end',
  outcome: 'answered',
  agent: 'flights',
  agents: ['flights'],
  answer: { kind: 'text', text, cards: [], sources: ['flights.search#1'] },
  notice: null,
  confirmationId: null,
  prompts: ['router@1', 'flights@2'],
  steps: 2,
  usage: [USAGE],
  ...over,
});
const compared = (over: Partial<Shadow> = {}): Shadow => ({
  type: 'shadow',
  status: 'compared',
  prompts: [CANDIDATE],
  outcome: 'answered',
  agent: 'flights',
  steps: 3,
  replayed: 1,
  missed: 1,
  usage: [USAGE],
  ...over,
});

const SETTINGS = {
  RATE_LIMIT_ENABLED: false,
  AGENT_ENABLED: true,
  AGENT_SERVICE: 'mock' as const,
  AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
  AGENT_RUN_TOKEN: RUN_TOKEN,
  AGENT_MODEL_PRICES: {
    'mock-specialist': { input: 2_000_000, output: 10_000_000, cacheRead: 0, cacheWrite: 0 },
  },
  AGENT_RUN_RESERVE_MICROUSD: 5000,
  AGENT_USER_DAILY_MICROUSD: 1_000_000,
  AGENT_SHADOW_PROMPTS: [CANDIDATE],
  // Two shadow turns (8000) fit under the cap; the third's reservation does not.
  AGENT_SHADOW_DAILY_MICROUSD: 12_000,
};

interface Conversation {
  id: string;
  activeRunId: string | null;
  messages: { role: string; kind: string; text: string }[];
}

function harness(getContext: () => TestContext, getSession: () => TokenSession) {
  const as = () => bearer(getSession().accessToken);
  const open = async (): Promise<string> => {
    const response = await getContext().http().post('/v1/agent/conversations').set(as()).send({});
    expect(response.status).toBe(201);
    return (response.body as { conversation: Conversation }).conversation.id;
  };
  const say = async (conversationId: string, text: string): Promise<string> => {
    const response = await getContext()
      .http()
      .post('/v1/agent/chat')
      .set(as())
      .send({ conversationId, text });
    expect(response.status).toBe(202);
    return (response.body as { runId: string }).runId;
  };
  const read = async (id: string): Promise<Conversation> =>
    (await getContext().http().get(`/v1/agent/conversations/${id}`).set(as()).expect(200))
      .body as Conversation;
  const done = async (runId: string): Promise<void> => {
    for (let tries = 0; tries < 200; tries += 1) {
      const response = await getContext().http().get(`/v1/agent/runs/${runId}`).set(as());
      if ((response.body as { done?: boolean }).done) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('the run did not end');
  };
  const spent = async (scope: 'agent' | 'agent-shadow'): Promise<number> =>
    Number(
      (await getContext().redis.get(
        `${scope}:spend:${new Date().toISOString().slice(0, 10)}:all`,
      )) ?? 0,
    );
  return { open, say, read, done, spent };
}

describe('shadow turns (e2e)', () => {
  let ctx: TestContext;
  let mock: MockAgentClient;
  let ada: TokenSession;
  const { open, say, read, done, spent } = harness(
    () => ctx,
    () => ada,
  );

  beforeAll(async () => {
    ctx = await createTestApp({ ...SETTINGS, AGENT_SHADOW_SAMPLE_PERCENT: 100 });
    mock = ctx.app.get(MockAgentClient);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    mock.use(null);
    ada = await signUp(ctx, 'shadow-ada@example.com');
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  it('answers the traveller first, then keeps how the candidate did, as codes and counts', async () => {
    let sent: AgentRunRequest | null = null;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.use(async (request, emit) => {
      sent = request;
      await emit(answered('The first flight leaves at 06:45.'));
      // The candidate is still thinking when the traveller already has their answer.
      await gate;
      await emit(compared());
    });

    const conversationId = await open();
    const runId = await say(conversationId, 'Flights from Lagos to Abuja tomorrow');
    await done(runId);

    // The run is over for the traveller: the answer is there and the conversation is free.
    const during = await read(conversationId);
    expect(during.activeRunId).toBeNull();
    expect(during.messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'Flights from Lagos to Abuja tomorrow'],
      ['assistant', 'The first flight leaves at 06:45.'],
    ]);
    expect(await ctx.prisma.agentShadowRun.count()).toBe(0);
    // The agent service was asked for the candidate named in the settings, and nothing else new.
    expect((sent as AgentRunRequest | null)?.shadow).toEqual({ prompts: [CANDIDATE] });

    release();
    await ctx.background.drain();

    const row = await ctx.prisma.agentShadowRun.findUnique({ where: { runId } });
    expect(row).toMatchObject({
      status: 'compared',
      prompts: [CANDIDATE],
      liveAgent: 'flights',
      agent: 'flights',
      outcome: 'answered',
      steps: 3,
      replayed: 1,
      missed: 1,
      inputTokens: 1000,
      outputTokens: 200,
      costMicroUsd: 4000n,
    });
    // Nothing a candidate wrote exists anywhere: the conversation is as it was.
    expect((await read(conversationId)).messages).toHaveLength(2);
    expect(await ctx.prisma.agentMessage.count()).toBe(2);
    // Its spend is counted apart from the assistant's own.
    expect(await spent('agent')).toBe(4000);
    expect(await spent('agent-shadow')).toBe(4000);

    // Staff see how the candidate did where the live prompt answered.
    const staff = await staffSession(ctx, 'shadow-staff@suskii.test', ['operations']);
    const quality = (
      await ctx.http().get('/v1/admin/ai/quality').set(bearer(staff.accessToken)).expect(200)
    ).body as { shadow: Record<string, unknown> };
    expect(quality.shadow).toEqual({
      candidates: [CANDIDATE],
      samplePercent: 100,
      dailyCapMicroUsd: 12_000,
      spentTodayMicroUsd: 4000,
      prompts: [
        {
          prompt: CANDIDATE,
          turns: 1,
          compared: 1,
          answered: 1,
          guardBlocked: 0,
          sameAgent: 1,
          replayedCalls: 1,
          missedCalls: 1,
          costMicroUsd: 4000,
        },
      ],
    });
    const limits = (
      await ctx.http().get('/v1/admin/ai/limits').set(bearer(staff.accessToken)).expect(200)
    ).body as Record<string, unknown>;
    expect(limits).toMatchObject({ shadowSamplePercent: 100, shadowDailyMicroUsd: 12_000 });
  });

  it('counts a candidate the guard refused, or that chose another agent, against it', async () => {
    const lines = [
      compared({ outcome: 'guard_blocked', replayed: 1, missed: 0 }),
      compared({ agent: 'hotels', replayed: 0, missed: 2 }),
    ];
    mock.use(async (_request, emit) => {
      await emit(answered('Here are the flights.'));
      const line = lines.shift();
      if (line) await emit(line);
    });
    const conversationId = await open();
    await say(conversationId, 'Flights to Abuja');
    await ctx.background.drain();
    await say(conversationId, 'And to Kano?');
    await ctx.background.drain();

    const staff = await staffSession(ctx, 'shadow-staff2@suskii.test', ['operations']);
    const quality = (
      await ctx.http().get('/v1/admin/ai/quality').set(bearer(staff.accessToken)).expect(200)
    ).body as { shadow: { prompts: unknown[] } };
    expect(quality.shadow.prompts).toEqual([
      {
        prompt: CANDIDATE,
        turns: 2,
        compared: 2,
        answered: 1,
        guardBlocked: 1,
        sameAgent: 1,
        replayedCalls: 1,
        missedCalls: 2,
        costMicroUsd: 8000,
      },
    ]);
  });

  it('stops asking when the day’s shadow spend is used up, and the traveller is still answered', async () => {
    const asked: boolean[] = [];
    mock.use(async (request, emit) => {
      asked.push(request.shadow !== undefined);
      await emit(answered('An answer.'));
      if (request.shadow) await emit(compared());
    });
    const conversationId = await open();
    for (const text of ['One', 'Two', 'Three']) {
      await say(conversationId, text);
      await ctx.background.drain();
    }
    // 5000 held and 4000 kept, twice; the third reservation would pass 12000.
    expect(asked).toEqual([true, true, false]);
    expect(await ctx.prisma.agentShadowRun.count()).toBe(2);
    expect(await spent('agent-shadow')).toBe(8000);
    expect(
      (await read(conversationId)).messages.filter((m) => m.role === 'assistant'),
    ).toHaveLength(3);
  });

  it('keeps why nothing was compared, at no cost', async () => {
    // The sample assistant ships no candidate: it says so, as the agent service would.
    const conversationId = await open();
    const runId = await say(conversationId, 'Hello there');
    await ctx.background.drain();
    expect(await ctx.prisma.agentShadowRun.findUnique({ where: { runId } })).toMatchObject({
      status: 'unknown_prompt',
      prompts: [CANDIDATE],
      agent: null,
      outcome: null,
      inputTokens: 0,
      costMicroUsd: 0n,
    });
    expect(await spent('agent-shadow')).toBe(0);
  });

  it('holds the spend when no line follows an answer, and gives it back when there was no answer', async () => {
    mock.use(async (_request, emit) => {
      await emit(answered('An answer, and then the stream ends.'));
    });
    const conversationId = await open();
    await say(conversationId, 'One');
    await ctx.background.drain();
    // A shadow turn may have run and been billed before the stream broke.
    expect(await ctx.prisma.agentShadowRun.count()).toBe(0);
    expect(await spent('agent-shadow')).toBe(5000);

    mock.use(async (_request, emit) => {
      await emit(
        answered('', {
          outcome: 'guard_blocked',
          answer: null,
          notice: 'cannot_answer',
        }),
      );
      // A line for a turn that was not answered is not one the service sends; it is dropped
      // only if it is not a shadow line, so nothing here depends on it.
    });
    await say(conversationId, 'Two');
    await ctx.background.drain();
    // The agent service never starts a shadow turn after such an end: nothing was spent.
    expect(await spent('agent-shadow')).toBe(5000);
    expect(await ctx.prisma.agentShadowRun.count()).toBe(0);
  });

  it('asks for none beside a message that answers a waiting confirmation', async () => {
    const asked: boolean[] = [];
    mock.use(async (request, emit) => {
      asked.push(request.shadow !== undefined);
      await emit(answered('An answer.'));
      if (request.shadow) await emit(compared());
    });
    const conversationId = await open();
    await ctx.prisma.agentRun.create({
      data: {
        conversationId,
        audience: 'customer',
        channel: 'web',
        agent: 'bookings',
        trigger: 'message',
        status: 'waiting',
      },
    });
    await say(conversationId, 'Actually, tell me about bags instead');
    await ctx.background.drain();
    expect(asked).toEqual([false]);
    expect(await spent('agent-shadow')).toBe(0);
  });
});

describe('shadow turns, with no share of turns set (e2e)', () => {
  let ctx: TestContext;
  let ada: TokenSession;
  const { open, say, spent } = harness(
    () => ctx,
    () => ada,
  );

  beforeAll(async () => {
    // Candidates are named, but the share is the default: 0.
    ctx = await createTestApp(SETTINGS);
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  it('asks for nothing, holds nothing and keeps nothing', async () => {
    await resetState(ctx);
    const mock = ctx.app.get(MockAgentClient);
    const asked: boolean[] = [];
    mock.use(async (request, emit) => {
      asked.push(request.shadow !== undefined);
      await emit(answered('An answer.'));
      // A line nobody asked for is dropped on the wire.
      await emit(compared());
    });
    ada = await signUp(ctx, 'shadow-off@example.com');
    const conversationId = await open();
    await say(conversationId, 'Flights to Abuja');
    await ctx.background.drain();
    expect(asked).toEqual([false]);
    expect(await ctx.prisma.agentShadowRun.count()).toBe(0);
    expect(await spent('agent-shadow')).toBe(0);
  });
});
