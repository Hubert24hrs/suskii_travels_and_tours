import type { AgentRunEvent, AgentRunShadow } from '@suskii/shared';
import { describe, expect, it } from 'vitest';

import { ROUTE_TOOL, type RecordedTurn } from './model/mock-model.js';
import type { ModelRequest } from './model/model.js';
import { promptFor, promptsWith, type Prompt } from './prompts/prompts.js';
import { checkpointText, denied, harness, ok, request, tool } from './test/harness.js';

const CONFIRMATION = '0193a000-0000-7000-8000-0000000c0f1a';
const LIVE_ANSWER = 'I found 2 flights. The first leaves at 10:25.';
const SHADOW_ANSWER = 'CANDIDATE WORDS: two flights, the earlier at 10:25.';

/** A candidate for the flights agent: the live prompt's id, a version no live prompt has. */
const CANDIDATE: Prompt = {
  id: 'flights',
  version: 99,
  render: () => 'CANDIDATE INSTRUCTIONS for flights, version 99.',
};
const REF = 'flights@99';

const FLIGHTS = {
  count: 2,
  flights: [{ carrier: 'XY', departure: '2026-12-01T10:25' }],
  cards: [],
};

const route = (agent: string): RecordedTurn => ({
  toolCalls: [{ name: ROUTE_TOOL, arguments: { agent } }],
});
const call = (name: string, args: Record<string, unknown> = {}): RecordedTurn => ({
  toolCalls: [{ name, arguments: args }],
});

/** Turns for the live prompts and turns for the candidate, each taken in order. */
function twoScripts(turns: {
  router?: RecordedTurn[];
  live: RecordedTurn[];
  candidate: RecordedTurn[];
}): (model: ModelRequest) => RecordedTurn | undefined {
  const router = [...(turns.router ?? [])];
  const live = [...turns.live];
  const candidate = [...turns.candidate];
  return (model) => {
    if (model.role === 'router') return router.shift();
    return model.prompt.version === CANDIDATE.version ? candidate.shift() : live.shift();
  };
}

const shadowOf = (events: readonly AgentRunEvent[]): AgentRunShadow | undefined =>
  events.find((event): event is AgentRunShadow => event.type === 'shadow');

const SEARCH = { from: 'LOS', to: 'ABV', date: '2026-12-01' };
const tools = [
  tool('flights.search', ['flights']),
  tool('bookings.cancel', ['flights'], 'commit'),
  tool('hotels.search', ['hotels']),
];

describe('candidate prompts (ADR-106)', () => {
  it('swaps a candidate in for the prompt it would replace, and names what it does not ship', () => {
    const { prompts, unknown } = promptsWith([REF, 'hotels@7'], [CANDIDATE]);
    expect(unknown).toEqual(['hotels@7']);
    expect(prompts.specialist('flights')).toBe(CANDIDATE);
    // Everything else is the live prompt, routers included.
    expect(prompts.specialist('hotels')).toBe(promptFor('hotels'));
    expect(prompts.router('customer').id).toBe('router');
    expect(prompts.router('staff').id).toBe('staff_router');
    // No candidate ships today: a reference to one is unknown to this build.
    expect(promptsWith([REF]).unknown).toEqual([REF]);
  });
});

describe('a shadow turn (ADR-106)', () => {
  it('runs the same turn again with the candidate, after the answer went out, without calling a tool', async () => {
    const h = harness(tools, { 'flights.search': () => ok(FLIGHTS) }, { candidates: [CANDIDATE] });
    const { end, events } = await h.send('Flights from Lagos to Abuja on 1 December', {
      shadow: { prompts: [REF] },
      script: twoScripts({
        router: [route('flights'), route('flights')],
        live: [call('flights__search', SEARCH), { text: LIVE_ANSWER }],
        candidate: [
          // The same search, with its arguments in another order: answered from the record.
          call('flights__search', { date: '2026-12-01', to: 'ABV', from: 'LOS' }),
          // A search the live turn never made: there is nothing to answer it from.
          call('flights__search', { ...SEARCH, date: '2026-12-02' }),
          { text: SHADOW_ANSWER },
        ],
      }),
    });

    // The traveller's answer is the live prompt's, and it went out before the shadow line.
    expect(end).toMatchObject({ outcome: 'answered', prompts: ['router@1', 'flights@2'] });
    expect(end.answer?.text).toBe(LIVE_ANSWER);
    expect(events.at(-1)?.type).toBe('shadow');
    expect(events.at(-2)?.type).toBe('end');

    expect(shadowOf(events)).toEqual({
      type: 'shadow',
      status: 'compared',
      prompts: [REF],
      outcome: 'answered',
      agent: 'flights',
      steps: 4,
      replayed: 1,
      missed: 1,
      usage: [
        expect.objectContaining({ role: 'router', calls: 1 }),
        expect.objectContaining({ role: 'specialist', calls: 3 }),
      ],
    });
    // The gateway was reached once, by the live turn: the candidate's calls never left.
    expect(h.gateway.calls.map((entry) => entry.tool)).toEqual(['flights.search']);
    // The candidate did run with its own instructions.
    const candidateTurns = h.model.requests.filter(
      (entry) => entry.request.prompt.version === CANDIDATE.version,
    );
    expect(candidateTurns).toHaveLength(3);
    expect(candidateTurns[0]?.request.system).toContain('CANDIDATE INSTRUCTIONS');

    // What it wrote went nowhere: not into an event, not into the thread.
    expect(JSON.stringify(events)).not.toContain('CANDIDATE');
    const kept = await checkpointText(h.saver);
    expect(kept).toContain(LIVE_ANSWER);
    expect(kept).not.toContain('CANDIDATE');

    // The next turn of the conversation remembers the live answer and nothing of the shadow.
    await h.send('And the day after?', {
      script: twoScripts({
        router: [route('flights')],
        live: [{ text: 'Ask me for a date.' }],
        candidate: [],
      }),
    });
    const history = JSON.stringify(h.model.requests.map((entry) => entry.request.messages));
    expect(history).toContain(LIVE_ANSWER);
    expect(history).not.toContain('CANDIDATE');
  });

  it('cannot start a confirmation or run a tool the live turn did not', async () => {
    const h = harness(
      tools,
      {
        'flights.search': () => ok(FLIGHTS),
        'bookings.cancel': () => denied('confirmation_required', { confirmationId: CONFIRMATION }),
      },
      { candidates: [CANDIDATE] },
    );
    const { end, events } = await h.send('Flights from Lagos to Abuja on 1 December', {
      shadow: { prompts: [REF] },
      script: twoScripts({
        router: [route('flights'), route('flights')],
        live: [call('flights__search', SEARCH), { text: LIVE_ANSWER }],
        candidate: [
          call('bookings__cancel', { bookingId: CONFIRMATION }),
          { text: 'I could not do that. Here are the flights.' },
        ],
      }),
    });
    expect(end.outcome).toBe('answered');
    // Refused where it was asked: no confirmation exists, and the turn simply went on.
    expect(shadowOf(events)).toMatchObject({
      status: 'compared',
      outcome: 'answered',
      replayed: 0,
      missed: 1,
    });
    expect(h.gateway.calls.map((entry) => entry.tool)).toEqual(['flights.search']);
  });

  it('reports how a candidate failed where the live prompt answered', async () => {
    const h = harness(tools, { 'flights.search': () => ok(FLIGHTS) }, { candidates: [CANDIDATE] });
    const { end, events } = await h.send('Flights from Lagos to Abuja on 1 December', {
      shadow: { prompts: [REF] },
      script: twoScripts({
        router: [route('flights'), route('flights')],
        live: [call('flights__search', SEARCH), { text: LIVE_ANSWER }],
        // A figure no tool returned, twice: the guard refuses the candidate's answer.
        candidate: [
          call('flights__search', SEARCH),
          { text: 'There are 7 flights from NGN 1,000.' },
          { text: 'There are 7 flights from NGN 1,000.' },
        ],
      }),
    });
    expect(end.outcome).toBe('answered');
    expect(shadowOf(events)).toMatchObject({
      status: 'compared',
      outcome: 'guard_blocked',
      replayed: 1,
      missed: 0,
    });
  });

  it('says why nothing was compared, and then calls no model', async () => {
    const script = () =>
      twoScripts({
        router: [route('flights')],
        live: [call('flights__search', SEARCH), { text: LIVE_ANSWER }],
        candidate: [],
      });
    const modelCalls = (h: ReturnType<typeof harness>) => h.model.requests.length;

    // A candidate this build does not ship.
    const unknown = harness(tools, { 'flights.search': () => ok(FLIGHTS) });
    const first = await unknown.send('Flights to Abuja', {
      shadow: { prompts: [REF] },
      script: script(),
    });
    expect(shadowOf(first.events)).toEqual({
      type: 'shadow',
      status: 'unknown_prompt',
      prompts: [REF],
      outcome: null,
      agent: null,
      steps: 0,
      replayed: 0,
      missed: 0,
      usage: [],
    });
    expect(modelCalls(unknown)).toBe(3);

    // A candidate for an agent that did not work on the turn.
    const other = harness(
      tools,
      { 'flights.search': () => ok(FLIGHTS) },
      { candidates: [{ ...CANDIDATE, id: 'hotels' }] },
    );
    const second = await other.send('Flights to Abuja', {
      shadow: { prompts: ['hotels@99'] },
      script: script(),
    });
    expect(shadowOf(second.events)).toMatchObject({ status: 'not_used', usage: [] });
    expect(modelCalls(other)).toBe(3);

    // Too many shadow turns at once: skipped, never queued.
    const busy = harness(
      tools,
      { 'flights.search': () => ok(FLIGHTS) },
      { candidates: [CANDIDATE], maxConcurrentShadows: 0 },
    );
    const third = await busy.send('Flights to Abuja', {
      shadow: { prompts: [REF] },
      script: script(),
    });
    expect(shadowOf(third.events)).toMatchObject({ status: 'busy', usage: [] });
    expect(modelCalls(busy)).toBe(3);
  });

  it('follows only a plain message that got an answer', async () => {
    const h = harness(
      tools,
      {
        'flights.search': () => ok(FLIGHTS),
        'bookings.cancel': () => denied('confirmation_required', { confirmationId: CONFIRMATION }),
      },
      { candidates: [CANDIDATE] },
    );
    // Not asked for: no line.
    const plain = await h.send('Flights to Abuja', {
      script: twoScripts({
        router: [route('flights')],
        live: [call('flights__search', SEARCH), { text: LIVE_ANSWER }],
        candidate: [],
      }),
    });
    expect(shadowOf(plain.events)).toBeUndefined();

    // An answer the guard refused is not compared.
    const blocked = await h.send('Flights to Abuja', {
      shadow: { prompts: [REF] },
      script: twoScripts({
        router: [route('flights')],
        live: [{ text: 'There are 9 flights.' }, { text: 'There are 9 flights.' }],
        candidate: [],
      }),
    });
    expect(blocked.end.outcome).toBe('guard_blocked');
    expect(shadowOf(blocked.events)).toBeUndefined();

    // A turn that waits for a tap, and the turn that resumes it, are the traveller's alone.
    const waiting = await h.send('Cancel my booking', {
      shadow: { prompts: [REF] },
      script: twoScripts({
        router: [route('flights')],
        live: [call('bookings__cancel', { bookingId: CONFIRMATION })],
        candidate: [],
      }),
    });
    expect(waiting.end.outcome).toBe('confirmation');
    expect(shadowOf(waiting.events)).toBeUndefined();
    const resumed: AgentRunEvent[] = [];
    h.model.use(twoScripts({ live: [{ text: 'It was not cancelled.' }], candidate: [] }));
    await h.service.run(
      request({
        shadow: { prompts: [REF] },
        input: { kind: 'resume', confirmationId: CONFIRMATION, decision: 'declined' },
      }),
      (event) => resumed.push(event),
      new AbortController().signal,
    );
    expect(resumed.at(-1)?.type).toBe('end');
    expect(shadowOf(resumed)).toBeUndefined();
  });

  it('never holds the thread: the next message runs while a shadow turn is still thinking', async () => {
    const h = harness(tools, { 'flights.search': () => ok(FLIGHTS) }, { candidates: [CANDIDATE] });
    const second: AgentRunEvent[] = [];
    const during: Promise<void>[] = [];
    const live = [
      call('flights__search', SEARCH),
      { text: LIVE_ANSWER },
      { text: 'Second answer.' },
    ];
    const router = [route('flights'), route('flights'), route('flights')];
    const events: AgentRunEvent[] = [];
    h.model.use((model) => {
      if (model.role === 'router') return router.shift();
      if (model.prompt.version !== CANDIDATE.version) return live.shift();
      // The candidate is thinking: the traveller writes again on the same thread.
      if (during.length === 0) {
        during.push(
          h.service.run(
            request({ input: { kind: 'message', text: 'And tomorrow?' } }),
            (event) => second.push(event),
            new AbortController().signal,
          ),
        );
      }
      return { text: SHADOW_ANSWER };
    });
    await h.service.run(
      request({
        shadow: { prompts: [REF] },
        input: { kind: 'message', text: 'Flights to Abuja' },
      }),
      (event) => events.push(event),
      new AbortController().signal,
    );
    await Promise.all(during);
    expect(shadowOf(events)?.status).toBe('compared');
    const end = second.find((event) => event.type === 'end');
    expect(end).toMatchObject({ outcome: 'answered' });
  });
});
