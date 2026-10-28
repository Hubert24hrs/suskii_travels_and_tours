import { createHmac } from 'node:crypto';

import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import type { LlmExtraction } from '../src/ai-search/llm-provider';
import { MockLlmProvider } from '../src/ai-search/mock-llm-provider';
import { MockWhatsAppChannel } from '../src/support/whatsapp/whatsapp-channel';

import { staffSession } from './helpers/admin';
import { bearer, E2E_TURNSTILE, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The after-hours assistant (ADR-085): outside staffed hours it answers from the published FAQs
 * and the conversation's booking, cites what it used, never touches the SLA, hands over once
 * when it cannot answer, stays quiet once a person has replied or it has answered enough, and
 * sends nothing that names the traveller to the model.
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });
let sequence = 0;
const next = (): number => (sequence += 1);
const APP_SECRET = 'e2e-assistant-app-secret-0123456789';
const PHONE_NUMBER_ID = '106540352242922';

/** The seeded FAQ the mock model matches for questions about paying in instalments. */
const INSTALMENTS = 'Can I pay for this trip in instalments?';
const INSTALMENTS_ANSWER =
  'Eligible bookings show the available payment plans at checkout before you pay.';

interface Message {
  id: string;
  author: string;
  kind: string;
  text: string;
  sources?: { kind: string; id?: string; key?: string; question?: string }[] | null;
}

describe('support assistant (e2e)', () => {
  let ctx: TestContext;
  let agent: TokenSession;
  let operations: TokenSession;
  let mock: MockLlmProvider;
  let requests: LlmExtraction[];

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      SUPPORT_ASSISTANT_ENABLED: true,
      SUPPORT_HOURS: '',
      WHATSAPP_SUPPORT_PROVIDER: 'mock',
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: 'e2e-assistant-verify-token',
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    });
    mock = ctx.app.get(MockLlmProvider);
    // Every request the assistant sends to the model, to check what leaves.
    const extract = mock.extract.bind(mock);
    mock.extract = (request) => {
      requests.push(request);
      return extract(request);
    };
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    requests = [];
    ctx.app.get(MockWhatsAppChannel).outbox.splice(0);
    agent = await staffSession(ctx, 'agent@suskii.test', ['support']);
    operations = await staffSession(ctx, 'ops@suskii.test', ['operations']);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const start = async (body: Record<string, unknown>, headers: Record<string, string>) => {
    const started = await ctx
      .http()
      .post('/v1/support/conversations')
      .set(headers)
      .send(body)
      .expect(201);
    await ctx.background.drain();
    return started.body.conversation as { id: string };
  };
  const travellerView = async (id: string, headers: Record<string, string>) =>
    (await ctx.http().get(`/v1/support/conversations/${id}`).set(headers).expect(200)).body as {
      status: string;
      messages: Message[];
    };
  const staffView = async (id: string) =>
    (
      await ctx
        .http()
        .get(`/v1/admin/support/conversations/${id}`)
        .set(bearer(agent.accessToken))
        .expect(200)
    ).body as { status: string; awaitingReply: boolean; messages: Message[] };
  const write = async (id: string, message: string, headers: Record<string, string>) => {
    await ctx
      .http()
      .post(`/v1/support/conversations/${id}/messages`)
      .set(headers)
      .send({ message })
      .expect(201);
    await ctx.background.drain();
  };
  const assistantMessages = (messages: Message[]) =>
    messages.filter((message) => message.author === 'assistant');

  it('answers from an FAQ, cites it for staff and leaves the SLA to people', async () => {
    const member = await signUp(ctx, 'ada@example.com');
    const auth = bearer(member.accessToken);
    const { id } = await start({ category: 'payment', message: INSTALMENTS }, auth);

    const view = await travellerView(id, auth);
    expect(view.messages).toEqual([
      expect.objectContaining({ author: 'customer', kind: 'text', text: INSTALMENTS }),
      expect.objectContaining({ author: 'assistant', kind: 'text', text: INSTALMENTS_ANSWER }),
    ]);
    expect(view.status).toBe('open');

    const staff = await staffView(id);
    expect(staff.awaitingReply).toBe(true);
    const faq = await ctx.prisma.faq.findFirstOrThrow({
      where: { question: 'Can I pay in instalments?', locale: 'en-NG' },
    });
    expect(assistantMessages(staff.messages)[0]?.sources).toEqual([
      { kind: 'faq', id: faq.id, question: 'Can I pay in instalments?' },
    ]);
    // The assistant is not a first response: the reply is still owed from the traveller's message.
    const row = await ctx.prisma.supportConversation.findUniqueOrThrow({ where: { id } });
    expect(row.lastStaffMessageAt).toBeNull();
    expect(row.replyOwedSince).toEqual(row.createdAt);
    expect(row.messageCount).toBe(2);

    // The model saw the FAQs and the scrubbed words, never who asked.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.purpose).toBe('support-answer');
    expect(JSON.stringify(requests[0])).not.toContain('ada@example.com');
    expect(JSON.stringify(requests[0])).not.toContain(member.userId);
  });

  it("answers from the booking's facts without names, contacts or references", async () => {
    const date = inDays(20);
    const { bookingId, token, reference } = await guestTour(date);
    const message = 'What time does my tour start?';
    mock.record(message, {
      answerable: true,
      answer: `Your tour starts on ${date} at 09:00 local time and lasts 3 hours.`,
      sources: ['tour.trip'],
    });
    const { id } = await start(
      {
        category: 'general',
        message,
        bookingId,
        email: 'kemi@example.com',
        turnstileToken: E2E_TURNSTILE,
      },
      { 'X-Booking-Token': token },
    );
    const conversation = await ctx.prisma.supportConversation.findUniqueOrThrow({ where: { id } });
    expect(conversation.bookingId).toBe(bookingId);

    const staff = await staffView(id);
    expect(assistantMessages(staff.messages)).toEqual([
      expect.objectContaining({
        kind: 'text',
        text: `Your tour starts on ${date} at 09:00 local time and lasts 3 hours.`,
        sources: [{ kind: 'fact', key: 'tour.trip' }],
      }),
    ]);
    const sent = JSON.stringify(requests);
    expect(sent).toContain('[tour.trip] Tour: Lagos walking tour, Lagos');
    for (const secret of ['KEMI', 'ADE', 'kemi@example.com', '8012345678', 'A1234567', reference]) {
      expect(sent).not.toContain(secret);
    }
  });

  it('hands over once when it cannot answer, then stays quiet', async () => {
    const member = await signUp(ctx, 'bola@example.com');
    const auth = bearer(member.accessToken);
    const { id } = await start(
      { category: 'payment', message: 'Was my card charged twice for the Lagos tour?' },
      auth,
    );
    let view = await travellerView(id, auth);
    expect(assistantMessages(view.messages)).toEqual([
      expect.objectContaining({ kind: 'handover', text: expect.stringContaining('offline') }),
    ]);

    await write(id, INSTALMENTS, auth);
    view = await travellerView(id, auth);
    expect(assistantMessages(view.messages)).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('turns an answer with a figure its sources do not have into the handover', async () => {
    const member = await signUp(ctx, 'chi@example.com');
    const auth = bearer(member.accessToken);
    const message = 'How long do refunds take?';
    mock.record(message, {
      answerable: true,
      answer: 'Refunds reach you within 3 days.',
      sources: ['faq-1'],
    });
    const { id } = await start({ category: 'cancellation_refund', message }, auth);
    const staff = await staffView(id);
    expect(assistantMessages(staff.messages)).toEqual([
      expect.objectContaining({ kind: 'handover', sources: null }),
    ]);
    expect(JSON.stringify(staff.messages)).not.toContain('3 days');
  });

  it('stops after three answers', async () => {
    const member = await signUp(ctx, 'dayo@example.com');
    const auth = bearer(member.accessToken);
    const { id } = await start({ category: 'payment', message: INSTALMENTS }, auth);
    for (let count = 0; count < 3; count += 1) await write(id, INSTALMENTS, auth);
    expect(assistantMessages((await travellerView(id, auth)).messages)).toHaveLength(3);
    expect(requests).toHaveLength(3);
  });

  it('stays out once a person has replied', async () => {
    const member = await signUp(ctx, 'ebun@example.com');
    const auth = bearer(member.accessToken);
    const { id } = await start({ category: 'payment', message: INSTALMENTS }, auth);
    await ctx
      .http()
      .post(`/v1/admin/support/conversations/${id}/messages`)
      .set(bearer(agent.accessToken))
      .send({ message: 'Hi, I can help with that.', internal: false })
      .expect(201);
    await write(id, INSTALMENTS, auth);
    const messages = (await travellerView(id, auth)).messages;
    expect(messages.map((message) => message.author)).toEqual([
      'customer',
      'assistant',
      'staff',
      'customer',
    ]);
    expect(requests).toHaveLength(1);
  });

  it('hands over without calling the model when the day’s spend is used up', async () => {
    const day = new Date().toISOString().slice(0, 10);
    await ctx.redis.set(`support-assistant:spend:${day}:all`, 5_000_000);
    const member = await signUp(ctx, 'efe@example.com');
    const auth = bearer(member.accessToken);
    const { id } = await start({ category: 'payment', message: INSTALMENTS }, auth);
    expect(assistantMessages((await travellerView(id, auth)).messages)).toEqual([
      expect.objectContaining({ kind: 'handover' }),
    ]);
    expect(requests).toHaveLength(0);
  });

  it('answers on WhatsApp through the channel', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                contacts: [{ wa_id: '2348099990000' }],
                messages: [
                  {
                    from: '2348099990000',
                    id: `wamid.assistant-${next()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: INSTALMENTS },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await ctx
      .http()
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`,
      )
      .send(body)
      .expect(200);
    await ctx.background.drain();
    expect(ctx.app.get(MockWhatsAppChannel).outbox).toEqual([
      expect.objectContaining({ kind: 'text', to: '2348099990000', body: INSTALMENTS_ANSWER }),
    ]);
    const message = await ctx.prisma.supportMessage.findFirstOrThrow({
      where: { author: 'assistant' },
    });
    expect(message.deliveryStatus).toBe('sent');
  });

  /** A guest's confirmed tour booking starting on `date`. */
  async function guestTour(
    date: string,
  ): Promise<{ bookingId: string; token: string; reference: string }> {
    const city = await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos' } });
    const staff = bearer(operations.accessToken);
    const created = await ctx
      .http()
      .post('/v1/admin/tours')
      .set(staff)
      .send({
        slug: `assistant-walk-${next()}`,
        title: 'Lagos walking tour',
        summary: 'Markets and history on foot.',
        cityId: city.id,
        timeZone: 'Africa/Lagos',
        durationMinutes: 180,
        meetingPoint: { name: 'Tafawa Balewa Square', address: 'Lagos Island', notes: null },
        cancellationPolicy: [{ daysBefore: 0, refundBps: 0 }],
      })
      .expect(201);
    const tourId = created.body.id as string;
    const departure = await ctx
      .http()
      .post(`/v1/admin/tours/${tourId}/departures`)
      .set(staff)
      .send({
        startsAtLocal: `${date}T09:00`,
        capacity: 8,
        prices: { adult: ngn(30_000), child: null, infant: null },
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/v1/admin/tours/${tourId}`)
      .set(staff)
      .send({ status: 'published' })
      .expect(204);
    const quote = await ctx
      .http()
      .post('/v1/inhouse-quotes')
      .send({
        kind: 'tour',
        departureId: departure.body.id,
        travellers: { adults: 1, children: 0, infants: 0 },
      })
      .expect(201);
    const booking = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', `e2e-assistant-${Date.now()}-${next()}`)
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: 'kemi@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'KEMI',
            surname: 'ADE',
            dateOfBirth: '1991-02-03',
            nationality: 'NG',
            document: { number: 'A1234567', issuingCountry: 'NG', expiryDate: inDays(3650) },
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: E2E_TURNSTILE,
      })
      .expect(201);
    return {
      bookingId: booking.body.booking.id as string,
      token: booking.body.accessToken as string,
      reference: booking.body.booking.reference as string,
    };
  }
});

describe('support assistant during staffed hours (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      SUPPORT_ASSISTANT_ENABLED: true,
      SUPPORT_HOURS: 'mon-sun 00:00-24:00',
    });
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('leaves the conversation to people while someone is on shift', async () => {
    await resetState(ctx);
    const member = await signUp(ctx, 'femi@example.com');
    const started = await ctx
      .http()
      .post('/v1/support/conversations')
      .set(bearer(member.accessToken))
      .send({ category: 'payment', message: INSTALMENTS })
      .expect(201);
    await ctx.background.drain();
    expect(
      await ctx.prisma.supportMessage.count({
        where: { conversationId: started.body.conversation.id as string, author: 'assistant' },
      }),
    ).toBe(0);
  });
});
