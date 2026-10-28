import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { AccountDeletionService } from '../src/privacy/account-deletion.service';
import { DataExportService } from '../src/privacy/data-export.service';

import { staffSession } from './helpers/admin';
import { bearer, E2E_TURNSTILE, signUp, type TokenSession } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Support conversations (ADR-083): account holders, guests with a booking and visitors start
 * conversations; staff answer from the inbox with SLA due times, internal notes and assignment;
 * replies reach the traveller without the text; nobody else can open a conversation.
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });
let keySequence = 0;
const idempotencyKey = (): string => `e2e-support-${Date.now()}-${(keySequence += 1)}`;

interface Conversation {
  id: string;
  reference: string;
  status: string;
  unread: boolean;
  booking: { id: string; reference: string } | null;
  messages: { id: string; author: string; text: string }[];
}

describe('support conversations (e2e)', () => {
  let ctx: TestContext;
  let agent: TokenSession;
  let operations: TokenSession;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    agent = await staffSession(ctx, 'agent@suskii.test', ['support']);
    operations = await staffSession(ctx, 'ops@suskii.test', ['operations']);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const start = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    ctx.http().post('/v1/support/conversations').set(headers).send(body);

  const inbox = async (query: Record<string, string> = {}) =>
    (
      await ctx
        .http()
        .get('/v1/admin/support/conversations')
        .query(query)
        .set(bearer(agent.accessToken))
        .expect(200)
    ).body as { items: { id: string; priority: string; sla: { state: string } }[] };

  const staffReply = (id: string, message: string, internal = false) =>
    ctx
      .http()
      .post(`/v1/admin/support/conversations/${id}/messages`)
      .set(bearer(agent.accessToken))
      .send({ message, internal })
      .expect(201);

  /** A guest's confirmed tour booking starting on `date`. */
  async function guestTour(date: string): Promise<{ bookingId: string; token: string }> {
    const city = await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos' } });
    const staff = bearer(operations.accessToken);
    const created = await ctx
      .http()
      .post('/v1/admin/tours')
      .set(staff)
      .send({
        slug: `support-walk-${(keySequence += 1)}`,
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
      .set('Idempotency-Key', idempotencyKey())
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
    };
  }

  it('lets an account holder talk to staff, who see the due time, notes and replies', async () => {
    const member = await signUp(ctx, 'ada@example.com');
    const auth = bearer(member.accessToken);
    const started = await start(
      { category: 'pre_booking', message: '  Can I pay in parts?  ' },
      auth,
    ).expect(201);
    expect(started.body.accessToken).toBeNull();
    const conversation = started.body.conversation as Conversation;
    expect(conversation.reference).toMatch(/^S-[2-9A-HJKMNP-TV-Z]{6}$/);
    expect(conversation.messages).toEqual([
      expect.objectContaining({ author: 'customer', text: 'Can I pay in parts?' }),
    ]);

    // Stored encrypted: the text is not in the row.
    const stored = await ctx.prisma.supportMessage.findFirstOrThrow({
      where: { conversationId: conversation.id },
    });
    expect(stored.bodyEncrypted).not.toContain('pay in parts');

    // Staff: normal priority, a two-hour reply target by default, in the active queue.
    const row = await ctx.prisma.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(row.priority).toBe('normal');
    expect(row.responseDueAt!.getTime() - row.createdAt.getTime()).toBe(120 * 60_000);
    expect((await inbox()).items.map((item) => item.id)).toEqual([conversation.id]);

    await staffReply(conversation.id, 'Booked with card ending 4242, check the ledger.', true);
    const answered = await staffReply(conversation.id, 'Yes: choose "Pay in instalments".');
    expect(answered.body).toMatchObject({
      status: 'waiting',
      awaitingReply: false,
      assignee: { id: agent.userId },
    });
    expect(answered.body.messages).toHaveLength(3);

    // The traveller sees the reply, never the note, and is told without the text.
    const seen = await ctx
      .http()
      .get(`/v1/support/conversations/${conversation.id}`)
      .set(auth)
      .expect(200);
    const view = seen.body as Conversation;
    expect(view.unread).toBe(true);
    expect(view.messages.map((message) => message.author)).toEqual(['customer', 'staff']);
    expect(JSON.stringify(view)).not.toContain('4242');
    await ctx.background.drain();
    const notices = await ctx.prisma.notification.findMany({
      where: { userId: member.userId, template: 'support-reply' },
    });
    // Email goes out; texts are off by default and this account has no phone with the app.
    expect(Object.fromEntries(notices.map((notice) => [notice.channel, notice.status]))).toEqual({
      email: 'sent',
      push: 'skipped',
      sms: 'skipped',
      whatsapp: 'skipped',
    });
    const email = ctx.emails.outbox.find((message) => message.template === 'support-reply');
    expect(email?.text).toContain(conversation.reference);
    expect(email?.text).not.toContain('instalments');

    // Polling returns only newer messages; reading clears the badge.
    const polled = await ctx
      .http()
      .get(`/v1/support/conversations/${conversation.id}`)
      .query({ after: view.messages[1]!.id })
      .set(auth)
      .expect(200);
    expect(polled.body.messages).toEqual([]);
    const read = await ctx
      .http()
      .put(`/v1/support/conversations/${conversation.id}/read`)
      .set(auth)
      .expect(200);
    expect(read.body.unread).toBe(false);

    // Resolving clears the due times; writing again reopens with a new reply owed.
    await ctx
      .http()
      .post(`/v1/support/conversations/${conversation.id}/resolve`)
      .set(auth)
      .expect(200);
    expect((await inbox()).items).toEqual([]);
    const reopened = await ctx
      .http()
      .post(`/v1/support/conversations/${conversation.id}/messages`)
      .set(auth)
      .send({ message: 'One more question.' })
      .expect(201);
    expect(reopened.body.status).toBe('open');
    const after = await ctx.prisma.supportConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(after.replyOwedSince).not.toBeNull();
    expect(after.resolvedAt).toBeNull();

    const listed = await ctx.http().get('/v1/support/conversations').set(auth).expect(200);
    expect(listed.body.conversations).toEqual([
      expect.objectContaining({ id: conversation.id, status: 'open' }),
    ]);
  });

  it('serves visitors with a token and emailed links, and nobody else', async () => {
    const unverified = await start({ category: 'other', message: 'Hello' }).expect(400);
    expect(unverified.body.type).toContain('bot-check-failed');
    const noEmail = await start({
      category: 'other',
      message: 'Hello',
      turnstileToken: E2E_TURNSTILE,
    }).expect(422);
    expect(noEmail.body.type).toContain('support-email-required');

    const started = await start({
      category: 'other',
      message: 'Do you sell trips to Zanzibar?',
      email: 'visitor@example.com',
      turnstileToken: E2E_TURNSTILE,
    }).expect(201);
    const token = started.body.accessToken as string;
    const id = (started.body.conversation as Conversation).id;
    const open = (headers: Record<string, string>) =>
      ctx.http().get(`/v1/support/conversations/${id}`).set(headers);
    await open({ 'X-Support-Token': token }).expect(200);
    await open({}).expect(404);
    await open({ 'X-Support-Token': `${token}x` }).expect(404);
    const intruder = await signUp(ctx, 'intruder@example.com');
    await open(bearer(intruder.accessToken)).expect(404);

    // The reply email carries a link token that opens this conversation only.
    await staffReply(id, 'Yes, from Nairobi and Dar es Salaam.');
    await ctx.background.drain();
    const email = ctx.emails.outbox.find(
      (message) => message.to === 'visitor@example.com' && message.template === 'support-reply',
    );
    const link = /#access=([^\s"<]+)/.exec(email?.text ?? '')?.[1] ?? '';
    expect(link.split('.')[0]).toBe(id);
    await open({ 'X-Support-Token': link }).expect(200);
    await open({ 'X-Support-Token': link.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }).expect(
      404,
    );
    const other = await start({
      category: 'other',
      message: 'Another question',
      email: 'visitor@example.com',
      turnstileToken: E2E_TURNSTILE,
    }).expect(201);
    await ctx
      .http()
      .get(`/v1/support/conversations/${(other.body.conversation as Conversation).id}`)
      .set({ 'X-Support-Token': link })
      .expect(404);

    const stored = await ctx.prisma.supportConversation.findUniqueOrThrow({ where: { id } });
    expect(stored.accessTokenHash).not.toBe(token);
    expect(stored.emailEncrypted).not.toContain('visitor@');
  });

  it('puts a guest booking that starts tomorrow in the urgent queue, first', async () => {
    const member = await signUp(ctx, 'later@example.com');
    await start(
      { category: 'other', message: 'Whenever you can.' },
      bearer(member.accessToken),
    ).expect(201);
    const { bookingId, token } = await guestTour(inDays(1));

    // Someone else's booking token cannot attach a conversation to it.
    await start({
      category: 'booking_change',
      message: 'Move my tour?',
      bookingId,
      turnstileToken: E2E_TURNSTILE,
    }).expect(404);
    const started = await start(
      {
        category: 'booking_change',
        message: 'Can I move my tour to the afternoon?',
        bookingId,
        turnstileToken: E2E_TURNSTILE,
      },
      { 'X-Booking-Token': token },
    ).expect(201);
    const conversation = started.body.conversation as Conversation;
    expect(conversation.booking?.id).toBe(bookingId);

    const queue = await inbox();
    expect(queue.items.map((item) => item.priority)).toEqual(['urgent', 'normal']);
    expect(queue.items[0]!.id).toBe(conversation.id);
    expect((await inbox({ priority: 'urgent' })).items).toHaveLength(1);

    // The booking's contact email gets the reply notice.
    await staffReply(conversation.id, 'Done: 14:00 instead.');
    await ctx.background.drain();
    expect(
      ctx.emails.outbox.some(
        (message) => message.to === 'kemi@example.com' && message.template === 'support-reply',
      ),
    ).toBe(true);
  });

  it('assigns only support staff, recomputes due times and limits open conversations', async () => {
    const member = await signUp(ctx, 'busy@example.com');
    const auth = bearer(member.accessToken);
    const first = await start({ category: 'payment', message: 'Payment question' }, auth).expect(
      201,
    );
    const id = (first.body.conversation as Conversation).id;

    const agents = await ctx
      .http()
      .get('/v1/admin/support/agents')
      .set(bearer(agent.accessToken))
      .expect(200);
    expect(agents.body.agents).toEqual([expect.objectContaining({ id: agent.userId })]);
    const invalid = await ctx
      .http()
      .patch(`/v1/admin/support/conversations/${id}`)
      .set(bearer(agent.accessToken))
      .send({ assigneeId: operations.userId })
      .expect(422);
    expect(invalid.body.type).toContain('support-assignee-invalid');

    const urgent = await ctx
      .http()
      .patch(`/v1/admin/support/conversations/${id}`)
      .set(bearer(agent.accessToken))
      .send({ priority: 'urgent', assigneeId: agent.userId })
      .expect(200);
    expect(urgent.body).toMatchObject({ priority: 'urgent', assignee: { id: agent.userId } });
    const row = await ctx.prisma.supportConversation.findUniqueOrThrow({ where: { id } });
    expect(row.responseDueAt!.getTime() - row.replyOwedSince!.getTime()).toBe(15 * 60_000);
    expect((await inbox({ assignee: 'me' })).items).toHaveLength(1);
    expect((await inbox({ assignee: 'unassigned' })).items).toHaveLength(0);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'support.updated', targetId: id },
    });
    expect(JSON.stringify(audit.metadata)).toContain('priority');

    // Staff without support:manage cannot open the inbox.
    await ctx
      .http()
      .get('/v1/admin/support/conversations')
      .set(bearer(operations.accessToken))
      .expect(403);

    for (let index = 0; index < 4; index += 1) {
      await start({ category: 'other', message: `Question ${index}` }, auth).expect(201);
    }
    const limited = await start({ category: 'other', message: 'Sixth' }, auth).expect(409);
    expect(limited.body.type).toContain('support-limit');
  });

  it('exports what the traveller and staff wrote, without notes, and deletes it with the account', async () => {
    const member = await signUp(ctx, 'leaving@example.com');
    const auth = bearer(member.accessToken);
    const started = await start(
      { category: 'documents', message: 'Where is my voucher?' },
      auth,
    ).expect(201);
    const id = (started.body.conversation as Conversation).id;
    await staffReply(id, 'Internal: resend from the booking page.', true);
    await staffReply(id, 'We sent it again just now.');

    const exported = await ctx.app.get(DataExportService).build(member.userId);
    const text = JSON.stringify(exported.data.support);
    expect(text).toContain('Where is my voucher?');
    expect(text).toContain('We sent it again just now.');
    expect(text).not.toContain('Internal: resend');

    await ctx.app.get(AccountDeletionService).delete(member.userId, { ip: '127.0.0.1' });
    expect(await ctx.prisma.supportConversation.count({ where: { userId: member.userId } })).toBe(
      0,
    );
    expect(await ctx.prisma.supportMessage.count({ where: { conversationId: id } })).toBe(0);
  });
});
