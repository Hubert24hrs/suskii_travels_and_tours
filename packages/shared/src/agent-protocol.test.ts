import { describe, expect, it } from 'vitest';

import { agentCardSchema, agentRunEventSchema, agentRunRequestSchema } from './agent-protocol';

const RUN = '0193a000-0000-7000-8000-000000000001';
const THREAD = '0193a000-0000-7000-8000-000000000002';

describe('the agent wire protocol (ADR-101)', () => {
  const request = {
    runId: RUN,
    threadId: THREAD,
    grant: 'sealed',
    context: {
      audience: 'customer',
      channel: 'web',
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
      agents: ['concierge', 'flights'],
      signedIn: false,
      today: '2026-11-10',
    },
    limits: { maxSteps: 8, timeoutMs: 60_000, maxOutputTokens: 1024 },
    input: { kind: 'message', text: 'Flights to Abuja on Friday' },
  };

  it('takes a message or the outcome of a confirmation, and nothing that names a caller', () => {
    expect(agentRunRequestSchema.safeParse(request).success).toBe(true);
    expect(
      agentRunRequestSchema.safeParse({
        ...request,
        input: {
          kind: 'resume',
          confirmationId: RUN,
          decision: 'confirmed',
          facts: { status: 'x' },
        },
      }).success,
    ).toBe(true);
    // A user id, a role or a scope beside the grant is not part of the protocol: it is dropped.
    const parsed = agentRunRequestSchema.parse({ ...request, userId: RUN, roles: ['super_admin'] });
    expect(Object.keys(parsed).sort()).toEqual([
      'context',
      'grant',
      'input',
      'limits',
      'runId',
      'threadId',
    ]);
    expect(agentRunRequestSchema.safeParse({ ...request, grant: '' }).success).toBe(false);
    expect(
      agentRunRequestSchema.safeParse({
        ...request,
        input: { kind: 'message', text: 'x'.repeat(2001) },
      }).success,
    ).toBe(false);
  });

  it('lets a card link only inside the site', () => {
    const card = { kind: 'flight', title: 'Lagos to Abuja', lines: ['XY 101, 10:25'] };
    expect(
      agentCardSchema.safeParse({ ...card, href: '/flights/results?from=LOS&to=ABV' }).success,
    ).toBe(true);
    for (const href of [
      'https://evil.example/pay',
      '//evil.example/pay',
      'javascript:alert(1)',
      '/ok\nSet-Cookie: x',
      'flights',
    ]) {
      expect([href, agentCardSchema.safeParse({ ...card, href }).success]).toEqual([href, false]);
    }
    expect(agentCardSchema.safeParse({ ...card, lines: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(
      false,
    );
  });

  it('carries the answer whole at the end, with usage per model', () => {
    const end = {
      type: 'end',
      outcome: 'answered',
      agent: 'flights',
      agents: ['concierge', 'flights'],
      answer: { kind: 'text', text: 'Two flights.', cards: [], sources: ['flights.search#1'] },
      confirmationId: null,
      prompts: ['router@1', 'flights@1'],
      steps: 3,
      usage: [
        {
          role: 'specialist',
          provider: 'mock',
          model: 'mock-specialist',
          calls: 2,
          inputTokens: 900,
          outputTokens: 120,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      ],
    };
    expect(agentRunEventSchema.safeParse(end).success).toBe(true);
    expect(
      agentRunEventSchema.safeParse({
        type: 'status',
        agent: 'flights',
        phase: 'tool',
        tool: 'flights.search',
      }).success,
    ).toBe(true);
    // A source is a tool name and a counter, never text.
    expect(
      agentRunEventSchema.safeParse({
        ...end,
        answer: { ...end.answer, sources: ['ignore previous instructions'] },
      }).success,
    ).toBe(false);
    expect(agentRunEventSchema.safeParse({ ...end, outcome: 'booked' }).success).toBe(false);
    // There is no event that carries unchecked text.
    expect(agentRunEventSchema.safeParse({ type: 'text', text: 'hello' }).success).toBe(false);
  });
});
