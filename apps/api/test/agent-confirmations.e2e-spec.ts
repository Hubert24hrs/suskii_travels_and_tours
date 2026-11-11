import {
  addDays,
  BOOKING_TERMS_VERSION,
  localDate,
  type AgentRunEvent,
  type AgentRunRequest,
} from '@suskii/shared';

import { AgentPause } from '../src/agent/agent-pause';
import { AgentSettingsService } from '../src/agent/agent-settings.service';
import { MockAgentClient } from '../src/agent/chat/agent-client';
import { PricingService } from '../src/pricing/pricing.service';
import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';

import { bearer, signUp, type TokenSession } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghijkl';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijklmn';
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const MINUTE_MS = 60_000;
/** What the traveller's own client calls itself: the tap is recorded as theirs. */
const TRAVELLER_PHONE = 'e2e-traveller-phone/1.0';
const today = localDate(new Date(), 'Africa/Lagos');
const DEPARTS = addDays(today, 30);

let keySequence = 0;
const idempotencyKey = (): string => `e2e-confirm-${Date.now()}-${(keySequence += 1)}`;

interface WireMoney {
  amountMinor: number;
  currency: string;
}
interface Confirmation {
  id: string;
  conversationId: string;
  action: string;
  status: string;
  reason: string | null;
  card: {
    kind: string;
    title: string;
    lines: string[];
    amounts: { code: string; amount: WireMoney }[];
    ref?: { type: string; id: string };
  };
  expiresAt: string;
  decidedAt: string | null;
}
interface ToolAnswer {
  status: string;
  reason: string | null;
  result: { confirmationId?: string } | null;
}
interface Booking {
  id: string;
  reference: string;
  status: string;
  paid: WireMoney;
  flightCancellable: boolean;
  scheduleChange: {
    id: string;
    status: string;
    acceptable: boolean;
    significant: boolean;
    refundOffer: { amount: WireMoney } | null;
  } | null;
  refunds: { amount: WireMoney; status: string }[];
}

const USAGE = {
  role: 'specialist' as const,
  provider: 'mock',
  model: 'mock-specialist',
  calls: 1,
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const ended = (over: Partial<Extract<AgentRunEvent, { type: 'end' }>>): AgentRunEvent =>
  ({
    type: 'end',
    outcome: 'answered',
    agent: 'bookings',
    agents: ['bookings'],
    answer: null,
    notice: null,
    confirmationId: null,
    prompts: ['bookings@1'],
    steps: 1,
    usage: [USAGE],
    ...over,
  }) satisfies AgentRunEvent;

/**
 * Confirmations (ADR-107), end to end with the agent service played by a script: a commit tool
 * called by an agent changes nothing and becomes a card the API built; only the traveller's
 * own tap, with their session and an idempotency key, runs the ordinary service; and the
 * assistant is then told what the records hold.
 */
describe('assistant confirmations (e2e)', () => {
  let ctx: TestContext;
  let agent: MockAgentClient;
  let supplier: MockFlightSupplier;
  let ada: TokenSession;
  let bola: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
    });
    agent = ctx.app.get(MockAgentClient);
    supplier = ctx.app.get(MockFlightSupplier);
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    agent.use(null);
    supplier.scheduleRules.clear();
    supplier.airlineChanges.clear();
    supplier.failNextChangeAcceptances = 0;
    supplier.failNextCancellations = 0;
    supplier.involuntaryRefundBps = 10_000;
    supplier.cancelledOrders.clear();
    ada = await signUp(ctx, 'confirm-ada@example.com');
    bola = await signUp(ctx, 'confirm-bola@example.com');
  });
  afterEach(async () => {
    await ctx.background.drain();
  });
  afterAll(async () => {
    await ctx.close();
  });

  const as = (session: TokenSession) => bearer(session.accessToken);

  /** Ada's own flight from Lagos to Abuja, booked with her account; paid and ticketed or not. */
  async function flight(options: { refundable?: boolean; pay?: boolean } = {}): Promise<string> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .set(as(ada))
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: DEPARTS }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offers = search.body.offers as { id: string; conditions: { refundable: boolean } }[];
    const offer = offers.find(
      (candidate) => candidate.conditions.refundable === (options.refundable ?? true),
    );
    if (!offer) throw new Error('The mock sells no such fare');
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${offer.id}/quote`)
      .set(as(ada))
      .expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(as(ada))
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId as string,
        contact: { email: 'confirm-ada@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Adaeze',
            surname: 'Okafor',
            dateOfBirth: '1990-04-01',
            nationality: 'NG',
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(201);
    const id = created.body.booking.id as string;
    if (options.pay === false) return id;
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${id}/payments`)
      .set(as(ada))
      .set('Idempotency-Key', idempotencyKey())
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    expect((await booking(id)).status).toBe('CONFIRMED');
    return id;
  }

  const booking = async (id: string, session: TokenSession = ada): Promise<Booking> =>
    (await ctx.http().get(`/v1/bookings/${id}`).set(as(session)).expect(200)).body as Booking;

  /** The airline moves the flight by `minutes`, and the worker's sweep finds it. */
  async function airlineMoves(bookingId: string, minutes: number): Promise<void> {
    supplier.scheduleRules.set('LOS-ABV', minutes);
    await ctx.prisma.bookingItem.updateMany({
      where: { bookingId },
      data: { nextChangeCheckAt: new Date(Date.now() - MINUTE_MS) },
    });
    await ctx.http().post('/v1/internal/bookings/schedule-changes-due').set(INTERNAL).expect(200);
    await ctx.background.drain();
  }

  const conversationOf = async (session: TokenSession = ada): Promise<string> =>
    (
      (await ctx.http().post('/v1/agent/conversations').set(as(session)).send({}).expect(201))
        .body as { conversation: { id: string } }
    ).conversation.id;

  /**
   * One turn in which the agent calls a tool of the bookings agent with the grant it was
   * handed, and ends as the real service would: waiting for the tap when the gateway made a
   * confirmation, with a plain sentence otherwise.
   */
  async function ask(
    conversationId: string,
    tool: string,
    bookingId: string,
    session: TokenSession = ada,
  ): Promise<{ runId: string; answer: ToolAnswer }> {
    let answer: ToolAnswer | null = null;
    agent.use(async (request, emit) => {
      const response = await ctx
        .http()
        .post(`/v1/internal/agent-tools/${tool}`)
        .set('Authorization', `Bearer ${TOOLS_TOKEN}`)
        .send({ grant: request.grant, agent: 'bookings', arguments: { bookingId } });
      answer = response.body as ToolAnswer;
      const confirmationId = answer.result?.confirmationId ?? null;
      await emit(
        confirmationId
          ? ended({ outcome: 'confirmation', confirmationId })
          : ended({
              answer: { kind: 'text', text: 'That cannot be done here.', cards: [], sources: [] },
            }),
      );
    });
    const sent = await ctx
      .http()
      .post('/v1/agent/chat')
      .set(as(session))
      .send({ conversationId, text: 'Please go ahead with that booking.' })
      .expect(202);
    await ctx.background.drain();
    if (!answer) throw new Error('The agent was not run');
    return { runId: (sent.body as { runId: string }).runId, answer };
  }

  /** What the assistant is told after a tap: the script records it and says one sentence. */
  function listen(): { requests: AgentRunRequest[] } {
    const heard: { requests: AgentRunRequest[] } = { requests: [] };
    agent.use(async (request, emit) => {
      heard.requests.push(request);
      await emit(ended({ answer: { kind: 'text', text: 'Noted.', cards: [], sources: [] } }));
    });
    return heard;
  }

  const read = (id: string, session: TokenSession | null = ada) => {
    const request = ctx.http().get(`/v1/agent/confirmations/${id}`);
    return session ? request.set(as(session)) : request;
  };
  const tap = (
    id: string,
    decision: 'confirm' | 'decline',
    session: TokenSession | null = ada,
    key: string | null = idempotencyKey(),
  ) => {
    const request = ctx.http().post(`/v1/agent/confirmations/${id}/${decision}`);
    void request.set('User-Agent', TRAVELLER_PHONE);
    if (session) void request.set(as(session));
    if (key) void request.set('Idempotency-Key', key);
    return request.send();
  };

  it('turns a cancellation into a card the API built, and cancels only at the tap', async () => {
    const bookingId = await flight();
    const paid = (await booking(bookingId)).paid;
    const conversationId = await conversationOf();
    const { runId, answer } = await ask(conversationId, 'bookings.cancel', bookingId);

    // The agent's call changed nothing: it was refused, with the id of a confirmation.
    expect(answer).toMatchObject({ status: 'denied', reason: 'confirmation_required' });
    const confirmationId = answer.result?.confirmationId ?? '';
    expect(confirmationId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
    expect(supplier.cancelledOrders.size).toBe(0);
    expect(
      await ctx.prisma.agentToolCall.findMany({
        where: { runId },
        select: { tool: true, status: true, reason: true, tier: true },
      }),
    ).toEqual([
      {
        tool: 'bookings.cancel',
        status: 'denied',
        reason: 'confirmation_required',
        tier: 'commit',
      },
    ]);
    // The run waits; its message carries the confirmation and no words of a model.
    expect(await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })).toMatchObject({
      status: 'waiting',
      outcome: 'confirmation',
    });
    const thread = await ctx
      .http()
      .get(`/v1/agent/conversations/${conversationId}`)
      .set(as(ada))
      .expect(200);
    const messages = (
      thread.body as { messages: { role: string; confirmationId: string | null }[] }
    ).messages;
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', confirmationId });

    // The card: what it is, when, what comes back and what is kept. Nobody's name or code.
    const shown = (await read(confirmationId).expect(200)).body as Confirmation;
    expect(shown).toMatchObject({
      id: confirmationId,
      conversationId,
      action: 'bookings.cancel',
      status: 'pending',
      reason: null,
      decidedAt: null,
      card: { kind: 'booking', lines: [DEPARTS], ref: { type: 'booking', id: bookingId } },
    });
    expect(shown.card.title).toMatch(/^Lagos \(LOS\) to Abuja \(ABV\), /);
    const [refund, kept] = shown.card.amounts;
    expect(shown.card.amounts.map((line) => line.code)).toEqual(['refund', 'kept']);
    expect(refund?.amount.amountMinor).toBeGreaterThan(0);
    expect((refund?.amount.amountMinor ?? 0) + (kept?.amount.amountMinor ?? 0)).toBe(
      paid.amountMinor,
    );
    const reference = (await booking(bookingId)).reference;
    expect(JSON.stringify(shown)).not.toMatch(
      new RegExp(`Adaeze|Okafor|example\\.com|${reference}`),
    );
    // The airline holds its quote for less than a confirmation waits: the card ends with it.
    expect(Date.parse(shown.expiresAt) - Date.now()).toBeLessThanOrEqual(15 * MINUTE_MS);

    // A tap is a write with an idempotency key, like every write that moves money.
    expect((await tap(confirmationId, 'confirm', ada, null)).status).toBe(400);
    expect((await booking(bookingId)).status).toBe('CONFIRMED');

    const heard = listen();
    const key = idempotencyKey();
    const done = await tap(confirmationId, 'confirm', ada, key);
    expect(done.status).toBe(202);
    const decided = done.body as { confirmation: Confirmation; runId: string | null };
    expect(decided.confirmation).toMatchObject({ status: 'confirmed', reason: null });
    expect(decided.confirmation.decidedAt).not.toBeNull();
    await ctx.background.drain();

    // The ordinary service did it, as the traveller: the airline first, then the refund.
    expect(supplier.cancelledOrders.size).toBe(1);
    const after = await booking(bookingId);
    expect(['REFUND_PENDING', 'REFUNDED']).toContain(after.status);
    expect(after.refunds).toEqual([expect.objectContaining({ amount: refund?.amount })]);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { targetId: bookingId, action: { contains: 'cancel' } },
      orderBy: { id: 'desc' },
    });
    expect(audit.actorUserId).toBe(ada.userId);
    // What is recorded is the traveller's own request, not the assistant's.
    expect(audit.userAgent).toBe(TRAVELLER_PHONE);

    // The assistant is told what the records hold, under keys, and nothing about a person.
    expect(decided.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(heard.requests).toHaveLength(1);
    const told = heard.requests[0]?.input;
    expect(told).toMatchObject({
      kind: 'resume',
      confirmationId,
      decision: 'confirmed',
      facts: {
        bookingId,
        bookingStatus: 'refund_pending',
        cancellationStatus: 'succeeded',
        refunds: [{ amount: refund?.amount, refundStatus: 'in_progress' }],
      },
    });
    expect(JSON.stringify(told)).not.toMatch(
      new RegExp(`Adaeze|Okafor|example\\.com|${reference}`),
    );
    // The run that waited has done its part; the new one answered.
    expect((await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe(
      'succeeded',
    );
    expect(
      await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: decided.runId ?? '' } }),
    ).toMatchObject({ trigger: 'resume', status: 'succeeded', outcome: 'answered' });

    // The same tap again answers the same, and does nothing twice.
    const again = await tap(confirmationId, 'confirm', ada, key);
    expect(again.status).toBe(202);
    expect(again.body).toEqual(done.body);
    // Another tap finds it answered.
    const late = await tap(confirmationId, 'confirm');
    expect(late.status).toBe(409);
    expect((late.body as { type: string }).type).toContain('confirmation-decided');
    expect((await tap(confirmationId, 'decline')).status).toBe(409);
    await ctx.background.drain();
    expect(supplier.cancelledOrders.size).toBe(1);
    expect(heard.requests).toHaveLength(1);
  });

  it('cancels nothing when the traveller declines, or writes instead of tapping', async () => {
    const bookingId = await flight();
    const conversationId = await conversationOf();
    const first = (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result
      ?.confirmationId;
    if (!first) throw new Error('No confirmation was made');

    const heard = listen();
    const declined = await tap(first, 'decline', ada, null);
    expect(declined.status).toBe(202);
    expect((declined.body as { confirmation: Confirmation }).confirmation.status).toBe('declined');
    await ctx.background.drain();
    expect(heard.requests[0]?.input).toEqual({
      kind: 'resume',
      confirmationId: first,
      decision: 'declined',
    });
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
    expect(supplier.cancelledOrders.size).toBe(0);
    expect((await tap(first, 'confirm')).status).toBe(409);

    // Asked again: a new card. Asked a third time: the second one is over, one question at a time.
    const second = (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result
      ?.confirmationId;
    const third = (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result
      ?.confirmationId;
    if (!second || !third) throw new Error('No confirmation was made');
    expect(((await read(second).expect(200)).body as Confirmation).status).toBe('expired');
    expect(((await read(third).expect(200)).body as Confirmation).status).toBe('pending');

    // The traveller writes something else instead of tapping: what waited is over.
    agent.use(null);
    await ctx
      .http()
      .post('/v1/agent/chat')
      .set(as(ada))
      .send({ conversationId, text: 'Actually, what is the baggage allowance?' })
      .expect(202);
    await ctx.background.drain();
    expect(((await read(third).expect(200)).body as Confirmation).status).toBe('expired');
    const late = await tap(third, 'confirm');
    expect(late.status).toBe(409);
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
    expect(supplier.cancelledOrders.size).toBe(0);
  });

  it('shows a confirmation to its traveller alone, and takes a tap from nobody else', async () => {
    const bookingId = await flight();
    const conversationId = await conversationOf();
    const confirmationId =
      (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result?.confirmationId ?? '';

    // Someone else, signed in: it does not exist. Nobody signed in: sign in first.
    expect((await read(confirmationId, bola)).status).toBe(404);
    expect((await tap(confirmationId, 'confirm', bola)).status).toBe(404);
    expect((await tap(confirmationId, 'decline', bola)).status).toBe(404);
    expect((await read(confirmationId, null)).status).toBe(401);
    expect((await tap(confirmationId, 'confirm', null)).status).toBe(401);
    expect((await read('0193a000-0000-7000-8000-00000000dead')).status).toBe(404);
    expect((await read('not-an-id')).status).toBe(400);
    // The agent service's own token opens no such route.
    const service = await ctx
      .http()
      .post(`/v1/agent/confirmations/${confirmationId}/confirm`)
      .set('Authorization', `Bearer ${TOOLS_TOKEN}`)
      .set('Idempotency-Key', idempotencyKey())
      .send();
    expect(service.status).toBe(401);

    // Someone else's booking is not there to be cancelled: no card is made for it.
    const theirs = await conversationOf(bola);
    const refused = await ask(theirs, 'bookings.cancel', bookingId, bola);
    expect(refused.answer).toEqual({ status: 'error', reason: 'not_found', result: null });
    expect(await ctx.prisma.agentConfirmation.count({ where: { userId: bola.userId } })).toBe(0);

    expect(((await read(confirmationId).expect(200)).body as Confirmation).status).toBe('pending');
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
  });

  it('does what the card showed or nothing: a changed refund, a lapsed card', async () => {
    const bookingId = await flight();
    const conversationId = await conversationOf();
    const first = (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result
      ?.confirmationId;
    if (!first) throw new Error('No confirmation was made');

    // The refund the card promised is no longer the one the airline's quote holds.
    const row = await ctx.prisma.agentConfirmation.findUniqueOrThrow({ where: { id: first } });
    const promised = row.expected as unknown as { refund: WireMoney };
    await ctx.prisma.agentConfirmation.update({
      where: { id: first },
      data: {
        expected: {
          refund: { ...promised.refund, amountMinor: promised.refund.amountMinor + 100 },
        },
      },
    });
    const heard = listen();
    const failed = await tap(first, 'confirm');
    expect(failed.status).toBe(202);
    expect((failed.body as { confirmation: Confirmation }).confirmation).toMatchObject({
      status: 'failed',
      reason: 'refused',
    });
    await ctx.background.drain();
    expect(heard.requests[0]?.input).toEqual({
      kind: 'resume',
      confirmationId: first,
      decision: 'failed',
      facts: { actionStatus: 'failed', reason: 'refused' },
    });
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
    expect(supplier.cancelledOrders.size).toBe(0);

    // A card past its time is over, whoever taps.
    const second = (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result
      ?.confirmationId;
    if (!second) throw new Error('No confirmation was made');
    await ctx.prisma.agentConfirmation.update({
      where: { id: second },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const lapsed = await tap(second, 'confirm');
    expect(lapsed.status).toBe(409);
    expect(((await read(second).expect(200)).body as Confirmation).status).toBe('expired');
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
    expect(supplier.cancelledOrders.size).toBe(0);
  });

  it('releases a booking nobody paid for, with nothing to refund', async () => {
    const bookingId = await flight({ pay: false });
    const conversationId = await conversationOf();
    const { answer } = await ask(conversationId, 'bookings.cancel', bookingId);
    const confirmationId = answer.result?.confirmationId ?? '';
    const shown = (await read(confirmationId).expect(200)).body as Confirmation;
    expect(shown.card.amounts).toEqual([]);

    const heard = listen();
    expect((await tap(confirmationId, 'confirm')).status).toBe(202);
    await ctx.background.drain();
    expect((await booking(bookingId)).status).toBe('CANCELLED');
    expect(heard.requests[0]?.input).toMatchObject({
      decision: 'confirmed',
      facts: { bookingStatus: 'cancelled', cancellationStatus: 'succeeded', refunds: [] },
    });

    // What is already cancelled cannot be asked about again.
    const again = await ask(conversationId, 'bookings.cancel', bookingId);
    expect(again.answer).toEqual({ status: 'error', reason: 'refused', result: null });
  });

  it("accepts an airline's new times only at the tap, and only the change the card showed", async () => {
    const bookingId = await flight();
    const conversationId = await conversationOf();
    // No change is open: nothing to accept, and no refund on offer.
    expect((await ask(conversationId, 'changes.accept', bookingId)).answer).toEqual({
      status: 'error',
      reason: 'refused',
      result: null,
    });

    await airlineMoves(bookingId, 90);
    const change = (await booking(bookingId)).scheduleChange;
    expect(change).toMatchObject({ status: 'open', acceptable: true, refundOffer: null });
    // Ninety minutes is not a significant change: the airline owes no refund.
    expect((await ask(conversationId, 'changes.take_refund_offer', bookingId)).answer.reason).toBe(
      'refused',
    );

    const { answer } = await ask(conversationId, 'changes.accept', bookingId);
    const confirmationId = answer.result?.confirmationId ?? '';
    const shown = (await read(confirmationId).expect(200)).body as Confirmation;
    expect(shown).toMatchObject({ action: 'changes.accept', status: 'pending' });
    expect(shown.card.amounts).toEqual([]);
    // The new times, as the airline now has them.
    expect(shown.card.lines).toHaveLength(1);
    expect(shown.card.lines[0]).toMatch(
      /^Lagos \(LOS\) \d{4}-\d{2}-\d{2} \d{2}:\d{2} → Abuja \(ABV\) \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
    expect((await booking(bookingId)).scheduleChange?.status).toBe('open');

    const heard = listen();
    expect((await tap(confirmationId, 'confirm')).status).toBe(202);
    await ctx.background.drain();
    expect((await booking(bookingId)).scheduleChange?.status).toBe('accepted');
    expect([...supplier.airlineChanges.values()][0]?.change.actionTaken).toBe('accepted');
    expect(heard.requests[0]?.input).toMatchObject({
      decision: 'confirmed',
      facts: { bookingStatus: 'confirmed', cancellationStatus: 'none', changeStatus: 'accepted' },
    });
  });

  it("takes the airline's full refund only at the tap, and the airline cancels first", async () => {
    // A fare that refunds nothing on its own terms, moved by four hours: a significant change.
    const bookingId = await flight({ refundable: false });
    await airlineMoves(bookingId, 240);
    const before = await booking(bookingId);
    expect(before.scheduleChange).toMatchObject({
      status: 'open',
      significant: true,
      refundOffer: { amount: before.paid },
    });
    const conversationId = await conversationOf();
    const { answer } = await ask(conversationId, 'changes.take_refund_offer', bookingId);
    const confirmationId = answer.result?.confirmationId ?? '';
    const shown = (await read(confirmationId).expect(200)).body as Confirmation;
    expect(shown).toMatchObject({
      action: 'changes.take_refund_offer',
      card: { amounts: [{ code: 'refund', amount: before.paid }], lines: [DEPARTS] },
    });
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
    expect(supplier.cancelledOrders.size).toBe(0);

    const heard = listen();
    expect((await tap(confirmationId, 'confirm')).status).toBe(202);
    await ctx.background.drain();
    expect(supplier.cancelledOrders.size).toBe(1);
    const after = await booking(bookingId);
    expect(['REFUND_PENDING', 'REFUNDED']).toContain(after.status);
    expect(after.scheduleChange).toMatchObject({ status: 'cancelled', refundOffer: null });
    expect(after.refunds).toEqual([expect.objectContaining({ amount: before.paid })]);
    expect(heard.requests[0]?.input).toMatchObject({
      decision: 'confirmed',
      facts: {
        bookingStatus: 'refund_pending',
        cancellationStatus: 'succeeded',
        refunds: [{ amount: before.paid, refundStatus: 'in_progress' }],
      },
    });
  });

  it('leaves the booking alone when the airline cannot be reached at the tap', async () => {
    const bookingId = await flight();
    const conversationId = await conversationOf();
    const confirmationId =
      (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result?.confirmationId ?? '';
    supplier.failNextCancellations = 5;
    const heard = listen();
    const failed = await tap(confirmationId, 'confirm');
    expect(failed.status).toBe(202);
    expect((failed.body as { confirmation: Confirmation }).confirmation).toMatchObject({
      status: 'failed',
      reason: 'failed',
    });
    await ctx.background.drain();
    expect(heard.requests[0]?.input).toMatchObject({
      decision: 'failed',
      facts: { actionStatus: 'failed', reason: 'failed' },
    });
    const after = await booking(bookingId);
    expect(after.status).toBe('CONFIRMED');
    expect(after.refunds).toEqual([]);
  });

  it('prepares nothing at advice only, and takes no tap while the assistant is paused', async () => {
    const bookingId = await flight();
    const conversationId = await conversationOf();
    const settings = ctx.app.get(AgentSettingsService);
    const admin = await signUp(ctx, 'confirm-admin@suskii.test');

    const staff = { userId: admin.userId, context: { ip: '127.0.0.1' } };
    await settings.setAutonomy(
      { subject: 'tool', name: 'bookings.cancel', level: 'manual' },
      staff,
    );
    expect((await ask(conversationId, 'bookings.cancel', bookingId)).answer).toEqual({
      status: 'denied',
      reason: 'autonomy',
      result: null,
    });
    expect(await ctx.prisma.agentConfirmation.count()).toBe(0);
    await settings.setAutonomy(
      { subject: 'tool', name: 'bookings.cancel', level: 'supervised' },
      staff,
    );

    const confirmationId =
      (await ask(conversationId, 'bookings.cancel', bookingId)).answer.result?.confirmationId ?? '';
    const pause = ctx.app.get(AgentPause);
    await pause.pause('maintenance');
    const paused = await tap(confirmationId, 'confirm');
    expect(paused.status).toBe(503);
    expect((await booking(bookingId)).status).toBe('CONFIRMED');
    expect(supplier.cancelledOrders.size).toBe(0);
    // The card is still there once the assistant is back.
    await pause.resume();
    expect(((await read(confirmationId).expect(200)).body as Confirmation).status).toBe('pending');
  });
});
