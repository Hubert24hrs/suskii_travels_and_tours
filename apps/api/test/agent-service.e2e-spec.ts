import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { bearer, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The whole chain with nothing stood in (ADR-101): the API's chat routes, the agent service as
 * its own process reached over HTTP, the tool gateway called back over HTTP with the service's
 * own token, and checkpoints in the `agent` schema. The model is the sample one, which calls no
 * vendor: asked about the "status" it reads the status page through the gateway, otherwise it
 * says one fixed sentence. Everything else in this suite is as production runs it.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghijkl';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijklmn';
const AGENT_DIR = join(__dirname, '..', '..', 'agent');

const SAMPLE =
  'This is the sample assistant. No language model is connected in this environment, so I cannot answer questions yet.';
const SAMPLE_STATUS =
  'This is the sample assistant. It read the status page through the tool gateway; no language model is connected in this environment.';

interface Message {
  role: string;
  kind: string;
  agent: string | null;
  text: string;
  notice: string | null;
}

/** A port nothing listens on right now. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

/** A candidate prompt no build ships: the service must say so, never run it. */
const CANDIDATE = 'concierge@99';

describe('the assistant end to end, with the agent service as its own process (e2e)', () => {
  let ctx: TestContext;
  let agent: ChildProcess | null = null;
  let agentUrl = '';
  let output = '';
  let ada: TokenSession;

  const stopAgent = async (): Promise<void> => {
    const child = agent;
    agent = null;
    if (child?.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    });
  };

  beforeAll(async () => {
    const agentPort = await freePort();
    agentUrl = `http://127.0.0.1:${agentPort}`;
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'http',
      AGENT_URL: agentUrl,
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      AGENT_RUN_TIMEOUT_MS: 20_000,
      // Every turn asks for a candidate prompt in its shadow (ADR-106). The service ships
      // none, so each run is followed by one line saying so: the whole wire, at no cost.
      AGENT_SHADOW_PROMPTS: [CANDIDATE],
      AGENT_SHADOW_SAMPLE_PERCENT: 100,
    });
    // The agent service calls the gateway back, so the API listens on a real port.
    await ctx.app.listen(0, '127.0.0.1');
    const { port: apiPort } = ctx.app.getHttpServer().address() as AddressInfo;

    // From source, as `pnpm dev` runs it: no build step to order before this suite.
    agent = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/main.ts'], {
      cwd: AGENT_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        AGENT_PORT: String(agentPort),
        API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
        AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
        AGENT_RUN_TOKEN: RUN_TOKEN,
        // The suite's database; the role's narrow rights have their own suite (app-role).
        AGENT_DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
        AGENT_MODEL_PROVIDER: 'mock',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    agent.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    agent.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

    const deadline = Date.now() + 60_000;
    for (;;) {
      if (agent.exitCode !== null) throw new Error(`the agent service stopped: ${output}`);
      const ready = await fetch(`${agentUrl}/ready`)
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) break;
      if (Date.now() > deadline) throw new Error(`the agent service did not start: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, 90_000);
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ada = await signUp(ctx, 'service-ada@example.com');
  });
  afterAll(async () => {
    await stopAgent();
    await ctx.background.drain();
    await ctx.close();
  });

  const headers = () => bearer(ada.accessToken);
  const converse = async (): Promise<string> =>
    (
      (await ctx.http().post('/v1/agent/conversations').set(headers()).send({}).expect(201))
        .body as { conversation: { id: string } }
    ).conversation.id;
  const say = async (conversationId: string, text: string): Promise<string> => {
    const response = await ctx
      .http()
      .post('/v1/agent/chat')
      .set(headers())
      .send({ conversationId, text })
      .expect(202);
    await ctx.background.drain();
    return (response.body as { runId: string }).runId;
  };
  const messages = async (conversationId: string): Promise<Message[]> =>
    (
      (await ctx.http().get(`/v1/agent/conversations/${conversationId}`).set(headers()).expect(200))
        .body as { messages: Message[] }
    ).messages;
  const checkpoints = async (threadId: string): Promise<number> =>
    Number(
      (
        await ctx.prisma.$queryRawUnsafe<{ count: bigint }[]>(
          'SELECT count(*) AS count FROM agent.checkpoints WHERE thread_id = $1',
          threadId,
        )
      )[0]?.count ?? 0,
    );

  it('answers a message through the service and keeps the thread in the agent schema', async () => {
    const conversationId = await converse();
    const runId = await say(conversationId, 'What does Suskii sell?');

    const last = (await messages(conversationId)).at(-1);
    expect(last).toMatchObject({
      role: 'assistant',
      kind: 'text',
      agent: 'concierge',
      text: SAMPLE,
    });
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({
      status: 'succeeded',
      outcome: 'answered',
      agent: 'concierge',
      modelProvider: 'mock',
      model: 'mock-specialist',
      promptVersion: 'concierge@3',
      toolCallCount: 0,
    });
    // The router and the specialist each took a turn, and the usage they reported is stored.
    expect(run.steps).toBe(2);
    expect(run.inputTokens).toBeGreaterThan(0);
    expect(run.outputTokens).toBeGreaterThan(0);
    // The thread is the conversation, checkpointed by the service in its own schema.
    expect(await checkpoints(conversationId)).toBeGreaterThan(0);

    // The line about the shadow turn came after the answer, over the same stream, and was
    // kept: this build knows no such candidate, called no model for it and spent nothing.
    expect(await ctx.prisma.agentShadowRun.findUnique({ where: { runId } })).toMatchObject({
      status: 'unknown_prompt',
      prompts: [CANDIDATE],
      liveAgent: 'concierge',
      agent: null,
      outcome: null,
      steps: 0,
      costMicroUsd: 0n,
    });
    // Nothing of it is in the traveller's thread.
    expect(await checkpoints(`shadow-${runId}`)).toBe(0);
    expect(await messages(conversationId)).toHaveLength(2);
  });

  it('runs a tool through the gateway with the grant the API sealed for the run', async () => {
    const conversationId = await converse();
    const runId = await say(conversationId, 'What is the status of the website right now?');

    const last = (await messages(conversationId)).at(-1);
    expect(last).toMatchObject({ role: 'assistant', kind: 'text', text: SAMPLE_STATUS });
    const calls = await ctx.prisma.agentToolCall.findMany({ where: { runId } });
    expect(calls.map((call) => [call.tool, call.tier, call.status, call.agent])).toEqual([
      ['platform.status', 'read', 'ok', 'concierge'],
    ]);
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: 'succeeded', toolCallCount: 1, steps: 3 });
    // The events a client streams name the tool while it runs, and nothing of its result.
    const events = await ctx.http().get(`/v1/agent/runs/${runId}`).set(headers()).expect(200);
    const log = (events.body as { events: { type: string; phase?: string; tool?: string }[] })
      .events;
    expect(log.some((event) => event.phase === 'tool' && event.tool === 'platform.status')).toBe(
      true,
    );
    expect(log.at(-1)).toMatchObject({ type: 'done', outcome: 'answered' });
  });

  it('remembers the thread across messages, and forgets it with the conversation', async () => {
    const conversationId = await converse();
    await say(conversationId, 'What does Suskii sell?');
    const before = await checkpoints(conversationId);
    await say(conversationId, 'And where do I find my tickets?');
    expect(await checkpoints(conversationId)).toBeGreaterThan(before);
    expect((await messages(conversationId)).map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);

    await ctx.http().delete(`/v1/agent/conversations/${conversationId}`).set(headers()).expect(204);
    expect(await checkpoints(conversationId)).toBe(0);
  });

  it('opens the service only to the API, and the gateway only to the service', async () => {
    const body = JSON.stringify({});
    const post = (token: string | null) =>
      fetch(`${agentUrl}/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
      }).then((response) => response.status);
    // Without the API's token the service has no such route, whoever asks.
    expect(await post(null)).toBe(404);
    expect(await post(TOOLS_TOKEN)).toBe(404);
    expect(await post(ada.accessToken)).toBe(404);
    // With it the request is read, and refused for what it is: not a run.
    expect(await post(RUN_TOKEN)).toBe(400);
    // The token that starts runs opens nothing on the API.
    await ctx
      .http()
      .get('/v1/internal/agent-tools')
      .set('authorization', `Bearer ${RUN_TOKEN}`)
      .expect(401);
  });

  it('tells the traveller the assistant is unavailable when the service is gone', async () => {
    const conversationId = await converse();
    await stopAgent();
    const runId = await say(conversationId, 'What does Suskii sell?');
    expect((await messages(conversationId)).at(-1)).toMatchObject({
      role: 'assistant',
      kind: 'notice',
      notice: 'unavailable',
      text: '',
    });
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: 'failed', outcome: 'failed' });
    // Nothing is left looking busy: the next message is taken.
    await ctx
      .http()
      .post('/v1/agent/chat')
      .set(headers())
      .send({ conversationId, text: 'Are you back?' })
      .expect(202);
    await ctx.background.drain();
  });
});
