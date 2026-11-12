import { describe, expect, it } from 'vitest';

import { GeminiAgentModel } from './gemini-model.js';
import { ModelError, type ModelMessage, type ModelRequest } from './model.js';

const KEY = 'test-key-not-a-real-one';

/** A fetch that answers with `answer` and remembers what it was asked. */
function fakeFetch(answer: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    return Promise.resolve(
      new Response(typeof answer === 'string' ? answer : JSON.stringify(answer), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof globalThis.fetch;
  const body = (index = 0): Record<string, unknown> => {
    const sent = calls[index]?.init.body;
    return JSON.parse(typeof sent === 'string' ? sent : '{}') as Record<string, unknown>;
  };
  return { fetch, calls, body };
}

const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  role: 'specialist',
  prompt: { id: 'flights', version: 3 },
  system: 'You are the flights specialist.',
  messages: [{ role: 'user', text: 'Lagos to Abuja on Friday' }],
  tools: [],
  maxOutputTokens: 800,
  signal: new AbortController().signal,
  ...overrides,
});

const SEARCH_TOOL = {
  name: 'flights__search',
  description: 'Search flights for given airports and dates.',
  parameters: {
    type: 'object',
    properties: { origin: { type: 'string' }, adults: { type: 'integer', default: 1 } },
    required: ['origin'],
    additionalProperties: false,
  },
};

const text = (value: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { role: 'model', parts: [{ text: value }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
  modelVersion: 'gemini-2.5-flash',
  ...extra,
});

const failure = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    return error instanceof ModelError ? error.reason : `other: ${String(error)}`;
  }
  return 'answered';
};

describe('GeminiAgentModel', () => {
  it('asks one fixed host, with the key in a header and never in the address', async () => {
    const { fetch, calls, body } = fakeFetch(text('Three flights leave on Friday.'));
    const model = new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch });

    const turn = await model.complete(request(), 'gemini-2.5-flash');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.headers).toEqual({
      'content-type': 'application/json',
      'x-goog-api-key': KEY,
    });
    expect(body()).toEqual({
      systemInstruction: { parts: [{ text: 'You are the flights specialist.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Lagos to Abuja on Friday' }] }],
      // 2.5 Flash thinks only when asked to: it is not asked.
      generationConfig: { maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
    });
    expect(turn).toEqual({
      text: 'Three flights leave on Friday.',
      toolCalls: [],
      stop: 'end',
      usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
      model: 'gemini-2.5-flash',
    });
  });

  it("hands over the registry's JSON Schema and lets the model choose, or forces one tool", async () => {
    const free = fakeFetch(text('ok'));
    await new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch: free.fetch }).complete(
      request({ tools: [SEARCH_TOOL] }),
      'gemini-2.5-flash',
    );
    expect(free.body().tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'flights__search',
            description: 'Search flights for given airports and dates.',
            parametersJsonSchema: SEARCH_TOOL.parameters,
          },
        ],
      },
    ]);
    expect(free.body().toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });

    const forced = fakeFetch(text('ok'));
    await new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch: forced.fetch }).complete(
      request({ role: 'router', tools: [SEARCH_TOOL], toolChoice: { name: 'flights__search' } }),
      'gemini-2.5-flash',
    );
    expect(forced.body().toolConfig).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['flights__search'] },
    });
  });

  it('reads function calls, keeps the ids the API gave and makes its own for the rest', async () => {
    const { fetch } = fakeFetch({
      candidates: [
        {
          content: {
            parts: [
              { text: 'Let me look.' },
              { text: 'thinking aloud', thought: true },
              {
                functionCall: { id: 'fc-1', name: 'flights__search', args: { origin: 'LOS' } },
                thoughtSignature: 'c2lnbmF0dXJl',
              },
              { functionCall: { name: 'catalog__places', args: { q: 'Abuja' } } },
              { functionCall: { name: 'broken', args: 'not an object' } },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 900,
        cachedContentTokenCount: 600,
        candidatesTokenCount: 40,
        thoughtsTokenCount: 25,
      },
    });
    const turn = await new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch }).complete(
      request({ tools: [SEARCH_TOOL] }),
      'gemini-3.8-flash',
    );

    expect(turn.stop).toBe('tool_use');
    // A summary of the model's thinking is not part of what it said.
    expect(turn.text).toBe('Let me look.');
    expect(turn.toolCalls).toEqual([
      {
        id: 'fc-1',
        name: 'flights__search',
        arguments: { origin: 'LOS' },
        signature: 'c2lnbmF0dXJl',
      },
      {
        id: expect.stringMatching(/^gm_[0-9a-f-]{36}$/) as unknown as string,
        name: 'catalog__places',
        arguments: { q: 'Abuja' },
      },
      { id: expect.stringMatching(/^gm_/) as unknown as string, name: 'broken', arguments: {} },
    ]);
    // Cached input is counted on its own; thinking is billed as output; no reply named a model.
    expect(turn.usage).toEqual({
      inputTokens: 300,
      outputTokens: 65,
      cacheReadTokens: 600,
      cacheWriteTokens: 0,
    });
    expect(turn.model).toBe('gemini-3.8-flash');
  });

  it('sends a conversation back with roles that alternate, results in order and signatures untouched', async () => {
    const { fetch, body } = fakeFetch(text('The cheapest is ₦85,000.'));
    const messages: ModelMessage[] = [
      { role: 'user', text: 'Lagos to Abuja on Friday' },
      {
        role: 'assistant',
        text: 'Let me look.',
        toolCalls: [
          { id: 'fc-1', name: 'flights__search', arguments: { origin: 'LOS' }, signature: 'c2ln' },
          { id: 'gm_made-here', name: 'catalog__places', arguments: { q: 'Abuja' } },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'fc-1',
        name: 'flights__search',
        content: '{"found":3}',
        isError: false,
      },
      {
        role: 'tool',
        toolCallId: 'gm_made-here',
        name: 'catalog__places',
        content: 'not_found',
        isError: true,
      },
      // Words after the results (a note from the guard) belong to the same user turn.
      { role: 'user', text: 'Write the answer again using only what the tools returned.' },
      // An assistant turn with nothing in it has no parts to send.
      { role: 'assistant', text: '', toolCalls: [] },
      { role: 'user', text: 'And on Saturday?' },
    ];
    await new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch }).complete(
      request({ messages }),
      'gemini-3.8-flash',
    );

    expect(body().contents).toEqual([
      { role: 'user', parts: [{ text: 'Lagos to Abuja on Friday' }] },
      {
        role: 'model',
        parts: [
          { text: 'Let me look.' },
          {
            functionCall: { name: 'flights__search', args: { origin: 'LOS' }, id: 'fc-1' },
            thoughtSignature: 'c2ln',
          },
          // An id made here is ours alone: the API never saw it, so it is not sent.
          { functionCall: { name: 'catalog__places', args: { q: 'Abuja' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'flights__search',
              response: { output: { found: 3 } },
              id: 'fc-1',
            },
          },
          { functionResponse: { name: 'catalog__places', response: { error: 'not_found' } } },
          { text: 'Write the answer again using only what the tools returned.' },
          { text: 'And on Saturday?' },
        ],
      },
    ]);
  });

  it('sets a thinking level only for Gemini 3 and later, and leaves unknown models alone', async () => {
    const config = async (model: string, level?: 'minimal' | 'low' | 'high') => {
      const { fetch, body } = fakeFetch(text('ok'));
      await new GeminiAgentModel({
        apiKey: KEY,
        timeoutMs: 5000,
        fetch,
        thinkingLevel: level,
      }).complete(request(), model);
      return body().generationConfig;
    };
    // A model that thinks counts its thoughts against the limit: room for them comes on top
    // of the answer's own 800 tokens, more for a higher level (ADR-112).
    expect(await config('gemini-3.8-flash')).toEqual({
      maxOutputTokens: 800 + 1024,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect(await config('gemini-3.5-flash-lite', 'minimal')).toEqual({
      maxOutputTokens: 800 + 512,
      thinkingConfig: { thinkingLevel: 'minimal' },
    });
    expect(await config('gemini-3.5-flash', 'high')).toEqual({
      maxOutputTokens: 800 + 8192,
      thinkingConfig: { thinkingLevel: 'high' },
    });
    expect(await config('gemini-2.5-flash-lite', 'high')).toEqual({
      maxOutputTokens: 800,
      thinkingConfig: { thinkingBudget: 0 },
    });
    // 2.5 Pro cannot switch thinking off, and older or unknown models take no such setting.
    expect(await config('gemini-2.5-pro')).toEqual({ maxOutputTokens: 800 + 4096 });
    expect(await config('gemini-2.0-flash')).toEqual({ maxOutputTokens: 800 });
    expect(await config('some-other-model')).toEqual({ maxOutputTokens: 800 });
  });

  it('tells a refusal and a cut-off answer from an answer', async () => {
    const stop = async (answer: unknown) => {
      const { fetch } = fakeFetch(answer);
      const turn = await new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch }).complete(
        request(),
        'gemini-2.5-flash',
      );
      return turn.stop;
    };
    const finished = (finishReason: string, said = 'Part of an answer') => ({
      candidates: [{ content: { parts: said ? [{ text: said }] : [] }, finishReason }],
    });
    expect(await stop(finished('MAX_TOKENS'))).toBe('max_tokens');
    expect(await stop(finished('SAFETY', ''))).toBe('refusal');
    expect(await stop(finished('PROHIBITED_CONTENT'))).toBe('refusal');
    // The prompt itself was blocked: no candidate at all.
    expect(await stop({ promptFeedback: { blockReason: 'SAFETY' } })).toBe('refusal');
    // An odd stop after real words is still an answer.
    expect(await stop(finished('OTHER'))).toBe('end');
  });

  it('says which failures may pass on another try, and never retries by itself', async () => {
    const run = (answer: unknown, status: number) => {
      const fake = fakeFetch(answer, status);
      const model = new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch: fake.fetch });
      return failure(model.complete(request(), 'gemini-2.5-flash')).then((reason) => ({
        reason,
        asked: fake.calls.length,
      }));
    };
    const error = { error: { code: 0, status: 'X', message: 'echo of the prompt' } };
    expect(await run(error, 429)).toEqual({ reason: 'unavailable', asked: 1 });
    expect(await run(error, 503)).toEqual({ reason: 'unavailable', asked: 1 });
    expect(await run(error, 500)).toEqual({ reason: 'unavailable', asked: 1 });
    // A bad request, a bad key, a model this project may not use: another try cannot help.
    expect(await run(error, 400)).toEqual({ reason: 'rejected', asked: 1 });
    expect(await run(error, 403)).toEqual({ reason: 'rejected', asked: 1 });
    expect(await run(error, 404)).toEqual({ reason: 'rejected', asked: 1 });
    // Answers that are no turn: nothing readable, no candidate, a call the model could not form.
    expect(await run('<html>bad gateway</html>', 200)).toEqual({ reason: 'unavailable', asked: 1 });
    expect(await run({}, 200)).toEqual({ reason: 'unavailable', asked: 1 });
    expect(
      await run(
        { candidates: [{ content: { parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL' }] },
        200,
      ),
    ).toEqual({ reason: 'unavailable', asked: 1 });
  });

  it('reports a lost connection as unavailable and a stopped or late call as a timeout', async () => {
    const broken = (() => Promise.reject(new TypeError('fetch failed'))) as typeof globalThis.fetch;
    expect(
      await failure(
        new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000, fetch: broken }).complete(
          request(),
          'gemini-2.5-flash',
        ),
      ),
    ).toBe('unavailable');

    // A fetch that only ends when its signal does, as the platform's does.
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof globalThis.fetch;
    expect(
      await failure(
        new GeminiAgentModel({ apiKey: KEY, timeoutMs: 20, fetch: hanging }).complete(
          request(),
          'gemini-2.5-flash',
        ),
      ),
    ).toBe('timeout');

    const stopped = new AbortController();
    const waiting = failure(
      new GeminiAgentModel({ apiKey: KEY, timeoutMs: 60_000, fetch: hanging }).complete(
        request({ signal: stopped.signal }),
        'gemini-2.5-flash',
      ),
    );
    stopped.abort();
    expect(await waiting).toBe('timeout');
  });
});

describe('GeminiAgentModel on Vertex AI (ADR-112)', () => {
  const vertex = (overrides: Record<string, unknown> = {}) => ({
    project: 'suskii-travels-staging',
    location: 'europe-west2',
    accessToken: () => Promise.resolve('machine-token-not-a-real-one'),
    ...overrides,
  });

  it("calls the project's regional endpoint as the machine, with no key anywhere", async () => {
    const { fetch, calls, body } = fakeFetch(
      text('Three flights leave on Friday.', { modelVersion: 'gemini-3.5-flash' }),
    );
    const model = new GeminiAgentModel({ vertex: vertex(), timeoutMs: 5000, fetch });

    const turn = await model.complete(request({ tools: [SEARCH_TOOL] }), 'gemini-3.5-flash');

    expect(model.provider).toBe('vertex');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://europe-west2-aiplatform.googleapis.com/v1/projects/suskii-travels-staging/locations/europe-west2/publishers/google/models/gemini-3.5-flash:generateContent',
    );
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer machine-token-not-a-real-one',
    });
    // The request is the Gemini API's own: Vertex AI takes it as it is.
    expect(body()).toMatchObject({
      systemInstruction: { parts: [{ text: 'You are the flights specialist.' }] },
      tools: [{ functionDeclarations: [{ name: 'flights__search' }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
    });
    expect(turn).toMatchObject({ text: 'Three flights leave on Friday.', stop: 'end' });
    expect(turn.model).toBe('gemini-3.5-flash');
  });

  it('uses the global endpoint when asked to, and refuses a location that is not a region', async () => {
    const { fetch, calls } = fakeFetch(text('ok'));
    const global = new GeminiAgentModel({
      vertex: vertex({ location: 'global' }),
      timeoutMs: 5000,
      fetch,
    });
    await global.complete(request(), 'gemini-3.5-flash');
    expect(calls[0]?.url).toBe(
      'https://aiplatform.googleapis.com/v1/projects/suskii-travels-staging/locations/global/publishers/google/models/gemini-3.5-flash:generateContent',
    );

    for (const location of ['europe-west2.evil.example', 'europe-west2/../x', '', 'EUROPE-WEST2']) {
      expect(
        () => new GeminiAgentModel({ vertex: vertex({ location }), timeoutMs: 5000, fetch }),
      ).toThrow('not a region name');
    }
  });

  it('takes a key or a Vertex AI target, never both and never neither', () => {
    expect(() => new GeminiAgentModel({ timeoutMs: 5000 })).toThrow('not both');
    expect(() => new GeminiAgentModel({ apiKey: KEY, vertex: vertex(), timeoutMs: 5000 })).toThrow(
      'not both',
    );
    expect(new GeminiAgentModel({ apiKey: KEY, timeoutMs: 5000 }).provider).toBe('gemini');
  });

  it('calls nothing and reports the provider unavailable when the machine has no token', async () => {
    const { fetch, calls } = fakeFetch(text('never sent'));
    const model = new GeminiAgentModel({
      vertex: vertex({
        accessToken: () => Promise.reject(new Error('metadata server answered 404')),
      }),
      timeoutMs: 5000,
      fetch,
    });

    expect(await failure(model.complete(request(), 'gemini-3.5-flash'))).toBe('unavailable');
    expect(calls).toHaveLength(0);
  });

  it('reads a refusal of access as rejected and an overloaded region as unavailable', async () => {
    for (const [status, reason] of [
      [403, 'rejected'],
      [404, 'rejected'],
      [429, 'unavailable'],
      [503, 'unavailable'],
    ] as const) {
      const { fetch } = fakeFetch({ error: { code: status, message: 'detail' } }, status);
      const model = new GeminiAgentModel({ vertex: vertex(), timeoutMs: 5000, fetch });
      expect([status, await failure(model.complete(request(), 'gemini-3.5-flash'))]).toEqual([
        status,
        reason,
      ]);
    }
  });
});

describe('GeminiAgentModel on Vertex AI, stopped while the token is fetched', () => {
  it('sends nothing once the run has stopped, and calls that a timeout', async () => {
    const { fetch, calls } = fakeFetch(text('never sent'));
    let hand: (token: string) => void = () => undefined;
    const model = new GeminiAgentModel({
      vertex: {
        project: 'suskii-travels-staging',
        location: 'europe-west2',
        accessToken: () => new Promise<string>((resolve) => (hand = resolve)),
      },
      timeoutMs: 60_000,
      fetch,
    });
    const stopped = new AbortController();
    const waiting = failure(
      model.complete(request({ signal: stopped.signal }), 'gemini-3.5-flash'),
    );
    stopped.abort();
    hand('machine-token-not-a-real-one');

    expect(await waiting).toBe('timeout');
    expect(calls).toHaveLength(0);
  });
});
