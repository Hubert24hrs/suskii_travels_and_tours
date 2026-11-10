import type { AgentRunEvent, AgentRunRequest } from '@suskii/shared';

import { HttpAgentClient, MOCK_AGENT_ANSWER, MockAgentClient } from './agent-client';

const REQUEST: AgentRunRequest = {
  runId: '019a0000-0000-7000-8000-000000000001',
  threadId: '019a0000-0000-7000-8000-000000000002',
  grant: 'sealed-grant',
  context: {
    audience: 'customer',
    channel: 'web',
    locale: 'en-NG',
    currency: 'NGN',
    country: 'NG',
    agents: ['concierge', 'flights'],
    signedIn: true,
    today: '2026-11-10',
  },
  limits: { maxSteps: 10, timeoutMs: 120_000, maxOutputTokens: 1024 },
  input: { kind: 'message', text: 'A flight to Abuja on Friday' },
};

const STATUS: AgentRunEvent = { type: 'status', agent: 'flights', phase: 'thinking' };
const END: AgentRunEvent = {
  type: 'end',
  outcome: 'answered',
  agent: 'flights',
  agents: ['flights'],
  answer: { kind: 'text', text: 'Here are three flights.', cards: [], sources: [] },
  notice: null,
  confirmationId: null,
  prompts: ['router@1', 'flights@1'],
  steps: 2,
  usage: [],
};

const lines = (...events: unknown[]): string =>
  events.map((event) => `${JSON.stringify(event)}\n`).join('');

/** A response whose body arrives in the pieces given, as a network would deliver it. */
function streamed(pieces: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status });
}

interface Call {
  url: string;
  init: RequestInit;
}

function client(answer: (call: Call) => Response | Promise<Response>): {
  client: HttpAgentClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call = { url: input instanceof Request ? input.url : input.toString(), init: init ?? {} };
    calls.push(call);
    return Promise.resolve().then(() => answer(call));
  }) as typeof globalThis.fetch;
  return {
    client: new HttpAgentClient({
      baseUrl: 'https://agent.internal.example',
      token: 'run-token',
      fetch,
    }),
    calls,
  };
}

async function run(
  subject: HttpAgentClient | MockAgentClient,
  signal: AbortSignal = new AbortController().signal,
): Promise<AgentRunEvent[]> {
  const seen: AgentRunEvent[] = [];
  await subject.run(
    REQUEST,
    (event) => {
      seen.push(event);
    },
    signal,
  );
  return seen;
}

describe('HttpAgentClient', () => {
  it('posts the run with its own token and never follows a redirect', async () => {
    const { client: subject, calls } = client(() => streamed([lines(STATUS, END)]));
    await run(subject);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://agent.internal.example/runs');
    expect(calls[0]?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: 'Bearer run-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(REQUEST);
  });

  it('reads events whole however the stream is cut, and nothing after the end', async () => {
    const text = lines(STATUS, { ...STATUS, phase: 'checking' }, END, STATUS);
    const cut = [text.slice(0, 17), text.slice(17, 18), text.slice(18, 140), text.slice(140)];
    const { client: subject } = client(() => streamed(cut));
    expect(await run(subject)).toEqual([STATUS, { ...STATUS, phase: 'checking' }, END]);
  });

  it('ends the run as failed at the first line that is not an event of ours', async () => {
    for (const bad of [
      'not json\n',
      `${JSON.stringify({ type: 'end', outcome: 'answered' })}\n`,
      `${JSON.stringify({ ...STATUS, agent: 'someone-else' })}\n`,
      `${JSON.stringify({ type: 'text', delta: 'unchecked words' })}\n`,
    ]) {
      const { client: subject } = client(() => streamed([lines(STATUS), bad, lines(END)]));
      const seen = await run(subject);
      expect(seen).toHaveLength(2);
      expect(seen[0]).toEqual(STATUS);
      expect(seen[1]).toMatchObject({
        type: 'end',
        outcome: 'failed',
        answer: null,
        notice: 'unavailable',
      });
    }
  });

  it('ends the run as failed when the service refuses, answers nothing or stops early', async () => {
    const failed = { type: 'end', outcome: 'failed', notice: 'unavailable', usage: [] };
    const { client: refused } = client(() => streamed([lines(END)], 401));
    expect(await run(refused)).toEqual([expect.objectContaining(failed)]);
    const { client: empty } = client(() => new Response(null, { status: 200 }));
    expect(await run(empty)).toEqual([expect.objectContaining(failed)]);
    // A stream that closes without its end, even in the middle of a line.
    const { client: early } = client(() => streamed([lines(STATUS), '{"type":"end","outco']));
    expect(await run(early)).toEqual([STATUS, expect.objectContaining(failed)]);
  });

  it('gives up on a line far longer than any answer', async () => {
    const long = {
      ...END,
      answer: { kind: 'text', text: 'x'.repeat(300_000), cards: [], sources: [] },
    };
    const { client: subject } = client(() => streamed([lines(long)]));
    expect(await run(subject)).toEqual([expect.objectContaining({ outcome: 'failed' })]);
    const endless = 'y'.repeat(300_000);
    const { client: unbroken } = client(() => streamed([endless]));
    expect(await run(unbroken)).toEqual([expect.objectContaining({ outcome: 'failed' })]);
  });

  it('ends as failed when the service cannot be reached, and as a timeout when the wait ran out', async () => {
    const { client: down } = client(() => {
      throw new TypeError('fetch failed');
    });
    expect(await run(down)).toEqual([
      expect.objectContaining({ outcome: 'failed', notice: 'unavailable' }),
    ]);
    const aborted = new AbortController();
    aborted.abort();
    const { client: slow } = client(() => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    expect(await run(slow, aborted.signal)).toEqual([
      expect.objectContaining({ outcome: 'timeout', notice: 'timeout' }),
    ]);
  });
});

describe('MockAgentClient', () => {
  it('says one fixed sentence that claims nothing, and costs nothing', async () => {
    const mock = new MockAgentClient();
    const seen = await run(mock);
    expect(seen.map((event) => event.type)).toEqual(['status', 'end']);
    expect(seen[1]).toMatchObject({
      outcome: 'answered',
      agent: 'concierge',
      answer: { kind: 'text', text: MOCK_AGENT_ANSWER, cards: [], sources: [] },
    });
    expect(mock.requests).toEqual([REQUEST]);
  });

  it('holds a script to the same wire as the real service', async () => {
    const mock = new MockAgentClient();
    mock.use(async (_request, emit) => {
      await emit(STATUS);
      await emit({ ...END, steps: -1 });
      await emit(END);
    });
    const seen = await run(mock);
    // The event that does not fit ends the run; what follows is ignored.
    expect(seen).toEqual([STATUS, expect.objectContaining({ outcome: 'failed', answer: null })]);

    mock.use(() => {
      throw new Error('the script fell over');
    });
    expect(await run(mock)).toEqual([expect.objectContaining({ outcome: 'failed' })]);
  });
});
