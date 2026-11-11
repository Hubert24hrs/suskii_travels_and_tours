import type { AgentRunEvent, AgentRunRequest } from '@suskii/shared';

import { AgentGrants } from '../src/agent/agent-grants';
import { AgentPause } from '../src/agent/agent-pause';
import { MOCK_AGENT_ANSWER, MockAgentClient } from '../src/agent/chat/agent-client';

import { bearer, E2E_TURNSTILE, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The assistant's chat routes (ADR-101, ADR-105, ADR-107) end to end, with the agent service
 * played by a mock the tests script: who may open a conversation, what the model is sent, how a
 * run's events and answer reach the client, and what stops a run from starting.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefgh';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghij';

interface Message {
  id: string;
  role: string;
  kind: string;
  agent: string | null;
  text: string;
  notice: string | null;
  cards: unknown[];
  feedback: string | null;
}
interface Conversation {
  id: string;
  reference: string;
  messageCount: number;
  activeRunId: string | null;
  messages: Message[];
}
interface RunEvents {
  status: string;
  done: boolean;
  events: ({ id: number; type: string } & Record<string, unknown>)[];
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
const answered = (text: string, over: Partial<Extract<AgentRunEvent, { type: 'end' }>> = {}) =>
  ({
    type: 'end',
    outcome: 'answered',
    agent: 'flights',
    agents: ['flights'],
    answer: { kind: 'text', text, cards: [], sources: ['flights.search#1'] },
    notice: null,
    confirmationId: null,
    prompts: ['router@1', 'flights@1'],
    steps: 2,
    usage: [USAGE],
    ...over,
  }) satisfies AgentRunEvent;

describe('assistant chat (e2e)', () => {
  let ctx: TestContext;
  let mock: MockAgentClient;
  let ada: TokenSession;
  let bola: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      // One run at these prices costs 1000 * 2 + 200 * 10 = 4000 micro-dollars.
      AGENT_MODEL_PRICES: {
        'mock-specialist': { input: 2_000_000, output: 10_000_000, cacheRead: 0, cacheWrite: 0 },
      },
      AGENT_RUN_RESERVE_MICROUSD: 5000,
      AGENT_USER_DAILY_MICROUSD: 12_000,
    });
    mock = ctx.app.get(MockAgentClient);
  });
  beforeEach(async () => {
    await resetState(ctx);
    mock.use(null);
    ada = await signUp(ctx, 'chat-ada@example.com');
    bola = await signUp(ctx, 'chat-bola@example.com');
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  const as = (session: TokenSession) => bearer(session.accessToken);
  const start = async (session: TokenSession | null = ada, body: Record<string, unknown> = {}) => {
    const request = ctx.http().post('/v1/agent/conversations');
    if (session) void request.set(as(session));
    return request.send(body);
  };
  const conversationOf = async (session: TokenSession = ada): Promise<Conversation> => {
    const response = await start(session);
    expect(response.status).toBe(201);
    return (response.body as { conversation: Conversation }).conversation;
  };
  const say = (conversationId: string, text: string, session: TokenSession = ada) =>
    ctx.http().post('/v1/agent/chat').set(as(session)).send({ conversationId, text });
  const events = async (runId: string, after = 0, session: TokenSession = ada) => {
    const response = await ctx
      .http()
      .get(`/v1/agent/runs/${runId}?after=${after}`)
      .set(as(session));
    return { status: response.status, body: response.body as RunEvents };
  };
  const read = async (id: string, session: TokenSession = ada): Promise<Conversation> =>
    (await ctx.http().get(`/v1/agent/conversations/${id}`).set(as(session)).expect(200))
      .body as Conversation;
  const runOf = async (response: { status: number; body: unknown }): Promise<string> => {
    expect(response.status).toBe(202);
    await ctx.background.drain();
    return (response.body as { runId: string }).runId;
  };

  it('opens a conversation only to the person it belongs to', async () => {
    const mine = await conversationOf(ada);
    expect(mine).toMatchObject({ messageCount: 0, activeRunId: null, messages: [] });
    expect(mine.reference).toMatch(/^A-[A-Z0-9]{6}$/);

    const list = await ctx.http().get('/v1/agent/conversations').set(as(ada)).expect(200);
    expect(
      (list.body as { conversations: { id: string }[] }).conversations.map((c) => c.id),
    ).toEqual([mine.id]);
    // Someone else, and nobody: it does not exist.
    for (const request of [
      () => ctx.http().get(`/v1/agent/conversations/${mine.id}`).set(as(bola)),
      () => ctx.http().get(`/v1/agent/conversations/${mine.id}`),
      () =>
        ctx.http().get(`/v1/agent/conversations/${mine.id}`).set('X-Agent-Token', 'x'.repeat(43)),
      () => say(mine.id, 'Hello there', bola),
      () => ctx.http().delete(`/v1/agent/conversations/${mine.id}`).set(as(bola)),
    ]) {
      expect((await request()).status).toBe(404);
    }
    expect(
      (
        (await ctx.http().get('/v1/agent/conversations').set(as(bola))).body as {
          conversations: unknown[];
        }
      ).conversations,
    ).toEqual([]);
  });

  it('gives a guest a token once, after a human check, and nothing without it', async () => {
    expect((await start(null)).status).toBe(400);
    const started = await start(null, {
      turnstileToken: E2E_TURNSTILE,
      locale: 'fr',
      currency: 'USD',
    });
    expect(started.status).toBe(201);
    const { conversation, accessToken } = started.body as {
      conversation: Conversation & { locale: string; currency: string };
      accessToken: string;
    };
    expect(accessToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(conversation).toMatchObject({ locale: 'fr', currency: 'USD' });
    // Only its HMAC is kept.
    const row = await ctx.prisma.agentConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(row.accessTokenHash).not.toBeNull();
    expect(row.accessTokenHash).not.toContain(accessToken);

    const guest = { 'X-Agent-Token': accessToken };
    await ctx.http().get(`/v1/agent/conversations/${conversation.id}`).set(guest).expect(200);
    expect((await ctx.http().get(`/v1/agent/conversations/${conversation.id}`)).status).toBe(404);
    // A signed-in person with someone's id but not their token gets nothing either.
    expect(
      (await ctx.http().get(`/v1/agent/conversations/${conversation.id}`).set(as(ada))).status,
    ).toBe(404);

    let sent: AgentRunRequest | null = null;
    mock.use((request) => {
      sent = request;
    });
    const response = await ctx
      .http()
      .post('/v1/agent/chat')
      .set(guest)
      .send({ conversationId: conversation.id, text: 'Bonjour, un vol pour Abuja ?' });
    await runOf(response);
    // A guest's grant: no account, no roles, and the scopes of a visitor.
    const grant = ctx.app.get(AgentGrants).open((sent as AgentRunRequest | null)?.grant ?? '');
    expect(grant).toMatchObject({ userId: null, roles: [], audience: 'customer', locale: 'fr' });
    expect(grant?.scopes).toEqual(['catalog', 'search', 'quotes', 'support']);
    expect((sent as AgentRunRequest | null)?.context).toMatchObject({
      signedIn: false,
      locale: 'fr',
    });
  });

  it('runs a message: the words sealed, a scrubbed copy to the agent, events and an answer back', async () => {
    const conversation = await conversationOf();
    let sent: AgentRunRequest | null = null;
    let toolAnswer: unknown = null;
    mock.use(async (request, emit) => {
      sent = request;
      await emit({ type: 'status', agent: 'flights', phase: 'thinking' });
      await emit({ type: 'status', agent: 'flights', phase: 'tool', tool: 'platform.status' });
      // The agent service calls the gateway with the grant it was handed, unopened.
      const answer = await ctx
        .http()
        .post('/v1/internal/agent-tools/platform.status')
        .set('Authorization', `Bearer ${TOOLS_TOKEN}`)
        .send({ grant: request.grant, agent: 'concierge', arguments: {} });
      toolAnswer = answer.body;
      await emit(
        answered('XY leaves at 10:25.', {
          answer: {
            kind: 'text',
            text: 'XY leaves at 10:25.',
            cards: [
              { kind: 'flight', title: 'Lagos to Abuja', lines: ['XY, 10:25'], href: '/flights' },
            ],
            sources: ['flights.search#1'],
          },
        }),
      );
    });

    const text =
      'Flights to Abuja on 2026-12-01? Mail me at ada@example.com or call +234 801 234 5678';
    const response = await say(conversation.id, text);
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ message: { role: 'user', kind: 'text', text } });
    const runId = await runOf(response);

    // What the agent service got: the date kept, the contact details gone, nobody named.
    const request = sent as AgentRunRequest | null;
    expect(request?.input).toMatchObject({ kind: 'message' });
    const scrubbed = request?.input.kind === 'message' ? request.input.text : '';
    expect(scrubbed).toContain('2026-12-01');
    expect(scrubbed).not.toContain('ada@example.com');
    expect(scrubbed).not.toContain('801 234');
    expect(request).toMatchObject({
      runId,
      threadId: conversation.id,
      context: { audience: 'customer', channel: 'web', signedIn: true, currency: 'NGN' },
    });
    const outside = JSON.stringify({ ...request, grant: undefined });
    expect(outside).not.toContain(ada.userId);
    expect(outside).not.toContain('chat-ada');
    expect(ctx.app.get(AgentGrants).open(request?.grant ?? '')).toMatchObject({
      runId,
      userId: ada.userId,
      conversationId: conversation.id,
      scopes: ['catalog', 'search', 'quotes', 'support', 'account'],
    });
    expect(toolAnswer).toMatchObject({ status: 'ok', reason: null });

    const polled = await events(runId);
    expect(polled.body).toMatchObject({ status: 'succeeded', done: true });
    expect(polled.body.events.map((event) => [event.id, event.type])).toEqual([
      [1, 'status'],
      [2, 'status'],
      [3, 'message'],
      [4, 'done'],
    ]);
    expect(polled.body.events[3]).toMatchObject({ outcome: 'answered', confirmationId: null });
    expect((await events(runId, 2)).body.events.map((event) => event.id)).toEqual([3, 4]);
    // Somebody else's run does not exist.
    expect((await events(runId, 0, bola)).status).toBe(404);

    const after = await read(conversation.id);
    expect(after.messageCount).toBe(2);
    expect(after.messages.map((message) => [message.role, message.kind, message.agent])).toEqual([
      ['user', 'text', null],
      ['assistant', 'text', 'flights'],
    ]);
    expect(after.messages[1]).toMatchObject({
      text: 'XY leaves at 10:25.',
      cards: [{ kind: 'flight', title: 'Lagos to Abuja', href: '/flights' }],
    });

    // At rest: sealed words, and a run that holds codes and counts only.
    const rows = await ctx.prisma.agentMessage.findMany({
      where: { conversationId: conversation.id },
    });
    for (const row of rows) {
      expect(row.bodyEncrypted).not.toContain('Abuja');
      expect(row.bodyEncrypted).not.toContain('10:25');
    }
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({
      status: 'succeeded',
      outcome: 'answered',
      agent: 'flights',
      agents: ['flights'],
      model: 'mock-specialist',
      modelProvider: 'mock',
      promptVersion: 'flights@1',
      inputTokens: 1000,
      outputTokens: 200,
      steps: 2,
      toolCallCount: 1,
    });
    expect(run.costMicroUsd).toBe(4000n);
    expect(
      JSON.stringify(run, (_key, value: unknown) =>
        typeof value === 'bigint' ? Number(value) : value,
      ),
    ).not.toContain('Abuja');

    // The run is over: its grant is dead.
    const late = await ctx
      .http()
      .post('/v1/internal/agent-tools/platform.status')
      .set('Authorization', `Bearer ${TOOLS_TOKEN}`)
      .send({ grant: request?.grant, agent: 'concierge', arguments: {} });
    expect(late.body).toMatchObject({ status: 'denied', reason: 'grant' });
  });

  it('answers with the sample assistant when nothing is scripted, and shows a notice as a code', async () => {
    const conversation = await conversationOf();
    await runOf(await say(conversation.id, 'What does Suskii do?'));
    expect((await read(conversation.id)).messages[1]).toMatchObject({
      text: MOCK_AGENT_ANSWER,
      agent: 'concierge',
    });

    mock.use(async (_request, emit) => {
      await emit(
        answered('unused', { outcome: 'guard_blocked', answer: null, notice: 'cannot_answer' }),
      );
    });
    const runId = await runOf(await say(conversation.id, 'How much is the cheapest flight?'));
    const notice = (await read(conversation.id)).messages.at(-1);
    expect(notice).toMatchObject({ kind: 'notice', notice: 'cannot_answer', text: '', cards: [] });
    expect((await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      'failed',
    );
  });

  it('ends a run as unavailable when the agent service breaks its own protocol', async () => {
    const conversation = await conversationOf();
    mock.use(async (_request, emit) => {
      // A card that links outside the site is not an event the wire allows.
      await emit(
        answered('Pay here', {
          answer: {
            kind: 'text',
            text: 'Pay here',
            cards: [{ kind: 'link', title: 'Pay', lines: [], href: 'https://evil.example/pay' }],
            sources: [],
          },
        }),
      );
    });
    const runId = await runOf(await say(conversation.id, 'How do I pay?'));
    expect((await events(runId)).body.events.at(-1)).toMatchObject({
      type: 'done',
      outcome: 'failed',
    });
    const last = (await read(conversation.id)).messages.at(-1);
    expect(last).toMatchObject({ kind: 'notice', notice: 'unavailable', cards: [] });

    mock.use(() => {
      throw new Error('the service fell over');
    });
    await runOf(await say(conversation.id, 'And now?'));
    expect((await read(conversation.id)).messages.at(-1)).toMatchObject({ notice: 'unavailable' });
  });

  it('closes a run whose answer could not be stored, and frees the conversation', async () => {
    const conversation = await conversationOf();
    mock.use(async (_request, emit) => {
      // The database fails once, at the moment the answer is stored.
      jest.spyOn(ctx.prisma, '$transaction').mockRejectedValueOnce(new Error('database away'));
      await emit(answered('Nobody will read this.'));
    });
    const runId = await runOf(await say(conversation.id, 'Hello, what can you do?'));
    const after = await events(runId);
    expect(after.body).toMatchObject({ status: 'failed', done: true });
    expect(after.body.events.at(-1)).toMatchObject({ type: 'done', outcome: 'failed' });
    // No answer, no run left running, and the next message is taken.
    const stored = await read(conversation.id);
    expect(stored.activeRunId).toBeNull();
    expect(stored.messages.map((message) => message.role)).toEqual(['user']);
    mock.use(null);
    await runOf(await say(conversation.id, 'Hello again'));
    expect((await read(conversation.id)).messages.at(-1)).toMatchObject({
      text: MOCK_AGENT_ANSWER,
    });
  });

  it('takes one message at a time, and frees the conversation when the run ends', async () => {
    const conversation = await conversationOf();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.use(async (_request, emit) => {
      await held;
      await emit(answered('Here you go.'));
    });
    const first = await say(conversation.id, 'First question');
    expect(first.status).toBe(202);
    const second = await say(conversation.id, 'Second question');
    expect(second.status).toBe(409);
    expect((second.body as { type: string }).type).toContain('agent-busy');
    expect((await read(conversation.id)).activeRunId).toBe((first.body as { runId: string }).runId);

    release();
    await ctx.background.drain();
    expect((await read(conversation.id)).activeRunId).toBeNull();
    mock.use(null);
    expect((await say(conversation.id, 'Second question')).status).toBe(202);
    await ctx.background.drain();
  });

  it("stops at the day's spend cap, a full conversation and the pause", async () => {
    const conversation = await conversationOf();
    mock.use(async (_request, emit) => {
      await emit(answered('Done.'));
    });
    // 4000 a run against a cap of 12,000, reserving 5000 first: two runs fit, a third does not.
    await runOf(await say(conversation.id, 'One'));
    await runOf(await say(conversation.id, 'Two'));
    const third = await say(conversation.id, 'Three');
    expect(third.status).toBe(429);
    expect((third.body as { type: string }).type).toContain('agent-budget');
    // A refused message is not stored, and the conversation is free again.
    expect((await read(conversation.id)).messageCount).toBe(4);
    // Another person has their own cap.
    const other = await conversationOf(bola);
    expect((await say(other.id, 'One', bola)).status).toBe(202);
    await ctx.background.drain();

    await ctx.prisma.agentConversation.update({
      where: { id: other.id },
      data: { messageCount: 200 },
    });
    const full = await say(other.id, 'One more', bola);
    expect([full.status, (full.body as { type: string }).type]).toEqual([
      409,
      'urn:suskii:problem:agent-conversation-full',
    ]);

    await ctx.app.get(AgentPause).pause('maintenance');
    const fresh = await start(bola);
    expect([fresh.status, (fresh.body as { type: string }).type]).toEqual([
      503,
      'urn:suskii:problem:agent-paused',
    ]);
    const paused = await say(conversation.id, 'Hello?');
    expect(paused.status).toBe(503);
    // Reading what was already said still works while paused.
    expect((await read(conversation.id)).messageCount).toBe(4);
  });

  it('streams the same events, and resumes after the last one seen', async () => {
    const conversation = await conversationOf();
    mock.use(async (_request, emit) => {
      await emit({ type: 'status', agent: 'concierge', phase: 'thinking' });
      await emit(answered('Welcome.', { agent: 'concierge', agents: ['concierge'] }));
    });
    const runId = await runOf(await say(conversation.id, 'Tell me about Suskii'));
    const stream = await ctx.http().get(`/v1/agent/runs/${runId}/stream`).set(as(ada)).buffer(true);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.headers['cache-control']).toBe('no-store');
    expect(stream.headers['content-encoding']).toBeUndefined();
    const frames = stream.text.split('\n\n').filter((frame) => frame.startsWith('id: '));
    expect(frames.map((frame) => frame.split('\n').slice(0, 2).join('|'))).toEqual([
      'id: 1|event: status',
      'id: 2|event: message',
      'id: 3|event: done',
    ]);
    expect(frames[1]).toContain('"text":"Welcome."');

    const resumed = await ctx
      .http()
      .get(`/v1/agent/runs/${runId}/stream`)
      .set(as(ada))
      .set('Last-Event-ID', '2')
      .buffer(true);
    expect(resumed.text.split('\n\n').filter((frame) => frame.startsWith('id: '))).toHaveLength(1);
    expect((await ctx.http().get(`/v1/agent/runs/${runId}/stream`).set(as(bola))).status).toBe(404);
  });

  it('takes a thumb on an answer of your own conversation only', async () => {
    const conversation = await conversationOf();
    await runOf(await say(conversation.id, 'Hello, what can you do?'));
    const [question, answer] = (await read(conversation.id)).messages;
    const rate = (id: string, feedback: string | null, session = ada) =>
      ctx.http().put(`/v1/agent/messages/${id}/feedback`).set(as(session)).send({ feedback });
    expect((await rate(answer?.id ?? '', 'down')).body).toMatchObject({ feedback: 'down' });
    expect((await read(conversation.id)).messages[1]?.feedback).toBe('down');
    expect((await rate(answer?.id ?? '', null)).body).toMatchObject({ feedback: null });
    expect((await rate(answer?.id ?? '', 'up', bola)).status).toBe(404);
    // Only answers are rated.
    expect((await rate(question?.id ?? '', 'up')).status).toBe(404);
    expect((await rate(answer?.id ?? '', 'sideways')).status).toBe(400);
  });

  it('deletes a conversation with its messages, and keeps the run as a count', async () => {
    const conversation = await conversationOf();
    const runId = await runOf(await say(conversation.id, 'Hello, what can you do?'));
    await ctx.prisma.$executeRawUnsafe(
      `INSERT INTO "agent"."checkpoints" (thread_id, checkpoint_id, checkpoint) VALUES ('${conversation.id}', 'c1', '{}')`,
    );
    await ctx.http().delete(`/v1/agent/conversations/${conversation.id}`).set(as(ada)).expect(204);
    expect(
      (await ctx.http().get(`/v1/agent/conversations/${conversation.id}`).set(as(ada))).status,
    ).toBe(404);
    expect(
      await ctx.prisma.agentMessage.count({ where: { conversationId: conversation.id } }),
    ).toBe(0);
    const threads = await ctx.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM "agent"."checkpoints" WHERE thread_id = '${conversation.id}'`,
    );
    expect(Number(threads[0]?.count)).toBe(0);
    // The run stays as operations data without the conversation, and nobody can read it.
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.conversationId).toBeNull();
    expect((await events(runId)).status).toBe(404);
  });

  it('stores no answer for a conversation deleted while its run worked', async () => {
    const conversation = await conversationOf();
    mock.use(async (_request, emit) => {
      await ctx.prisma.agentConversation.delete({ where: { id: conversation.id } });
      await emit(answered('Too late.'));
    });
    const response = await say(conversation.id, 'Hello, what can you do?');
    expect(response.status).toBe(202);
    await ctx.background.drain();
    expect(await ctx.prisma.agentMessage.count()).toBe(0);
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({
      where: { id: (response.body as { runId: string }).runId },
    });
    expect(run).toMatchObject({ status: 'succeeded', conversationId: null });
  });
});

describe('assistant chat, switched off (e2e)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false, AGENT_ENABLED: false });
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('answers 404 on every route, as if they did not exist', async () => {
    const session = await signUp(ctx, 'chat-off@example.com');
    const id = '0193a000-0000-7000-8000-000000000001';
    const auth = bearer(session.accessToken);
    for (const request of [
      () => ctx.http().post('/v1/agent/conversations').set(auth).send({}),
      () => ctx.http().get('/v1/agent/conversations').set(auth),
      () => ctx.http().get(`/v1/agent/conversations/${id}`).set(auth),
      () => ctx.http().delete(`/v1/agent/conversations/${id}`).set(auth),
      () => ctx.http().post('/v1/agent/chat').set(auth).send({ conversationId: id, text: 'Hello' }),
      () => ctx.http().get(`/v1/agent/runs/${id}`).set(auth),
      () => ctx.http().get(`/v1/agent/runs/${id}/stream`).set(auth),
      () => ctx.http().put(`/v1/agent/messages/${id}/feedback`).set(auth).send({ feedback: 'up' }),
    ]) {
      expect((await request()).status).toBe(404);
    }
    expect((await ctx.http().get('/v1/agent/status')).body).toEqual({
      enabled: false,
      paused: false,
      available: false,
    });
  });
});
