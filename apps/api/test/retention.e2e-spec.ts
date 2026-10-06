import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { REDACTED_CONTACT_PAYLOAD } from '../src/bookings/bookings.service';
import { contactContext } from '../src/crypto/encryption-contexts';
import { FieldEncryption } from '../src/crypto/field-encryption';
import { RETENTION_RULES, RetentionService } from '../src/privacy/retention.service';

import { bearer, signUp, type TokenSession } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
const DAY = 86_400_000;
const ago = (days: number): Date => new Date(Date.now() - days * DAY);
let keySequence = 0;
const idempotencyKey = (): string => `e2e-retention-${Date.now()}-${(keySequence += 1)}`;

/**
 * ADR-039: the daily retention sweep removes what is past its period, anonymises bookings closed
 * for longer than FINANCIAL_RECORDS_RETENTION_YEARS, leaves everything else alone and finds
 * nothing on a second run.
 */
describe('retention sweep (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    await resetState(ctx);
  });
  afterAll(async () => {
    await resetState(ctx);
    await ctx.close();
  });

  async function quote(): Promise<string> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: addDays(today, 30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quoted = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    return quoted.body.quoteId as string;
  }

  async function confirmedBooking(session: TokenSession, surname: string): Promise<string> {
    const auth = bearer(session.accessToken);
    const quoteId = await quote();
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId,
        contact: { email: 'traveller@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Chioma',
            surname,
            dateOfBirth: '1990-04-01',
            nationality: 'NG',
            document: {
              number: 'B1234567',
              issuingCountry: 'NG',
              expiryDate: addDays(today, 3650),
            },
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(201);
    const bookingId = created.body.booking.id as string;
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    return bookingId;
  }

  it('purges what is past its period and anonymises long-closed bookings', async () => {
    const session = await signUp(ctx, 'retention@example.com');
    const oldBooking = await confirmedBooking(session, 'Okafor');
    const recentBooking = await confirmedBooking(session, 'Adeyemi');
    const unbookedQuote = await quote();
    const ledgerEntries = await ctx.prisma.ledgerEntry.count();

    // Age the records past their periods (and leave a recent one of each kind).
    await ctx.prisma.$executeRaw`
      UPDATE bookings SET updated_at = now() - interval '8 years' WHERE id = ${oldBooking}::uuid`;
    const revoked = await signUp(ctx, 'old-device@example.com');
    await ctx.prisma.session.update({
      where: { id: revoked.sessionId },
      data: { revokedAt: ago(40), revokedReason: 'logout' },
    });
    await ctx.prisma.verificationToken.updateMany({ data: { expiresAt: ago(10) } });
    await ctx.prisma.idempotencyKey.updateMany({ data: { expiresAt: ago(1) } });
    await ctx.prisma.offer.updateMany({ data: { expiresAt: ago(40) } });
    const oldWebhook = await ctx.prisma.webhookEvent.findFirstOrThrow({
      orderBy: { receivedAt: 'asc' },
    });
    await ctx.prisma.webhookEvent.update({
      where: { id: oldWebhook.id },
      data: { receivedAt: ago(100) },
    });
    const notifications = await ctx.prisma.notification.findMany({ take: 1 });
    await ctx.prisma.notification.updateMany({
      where: { id: { in: notifications.map((row) => row.id) } },
      data: { createdAt: ago(200) },
    });
    const searchLog = await ctx.prisma.searchLog.findFirstOrThrow();
    await ctx.prisma.searchLog.update({
      where: { id: searchLog.id },
      data: { occurredAt: ago(500) },
    });
    const consent = { consentVersion: 'v1', consentedAt: ago(40), createdAt: ago(40) };
    await ctx.prisma.newsletterSubscription.createMany({
      data: [
        { email: 'never-confirmed@example.com', status: 'pending', ...consent },
        { email: 'subscriber@example.com', status: 'confirmed', confirmedAt: ago(39), ...consent },
      ],
    });

    const consentId = '0192d3a0-7c1e-7b2a-9f00-00000000c0c0';
    await ctx.prisma.cookieConsent.createMany({
      data: [
        { consentId, policyVersion: 1, analytics: true, marketing: false, createdAt: ago(800) },
        { consentId, policyVersion: 1, analytics: false, marketing: false },
      ],
    });

    const sweeps = () =>
      ctx.prisma.auditLog.count({ where: { action: 'retention.swept', actorType: 'system' } });
    const sweepsBefore = await sweeps();
    const retention = ctx.app.get(RetentionService);
    const first = await retention.run();
    expect(first).toMatchObject({
      sessions: 1,
      'webhook-events': 1,
      notifications: notifications.length,
      'search-logs': 1,
      'newsletter-pending': 1,
      'cookie-consents': 1,
      'closed-bookings': 1,
    });
    expect(first['verification-tokens']).toBeGreaterThanOrEqual(2);
    expect(first['idempotency-keys']).toBeGreaterThanOrEqual(4);
    // Every quote except the two that were booked.
    expect(first.offers).toBeGreaterThanOrEqual(1);
    expect(await ctx.prisma.offer.count({ where: { id: unbookedQuote } })).toBe(0);
    expect(await ctx.prisma.offer.count({ where: { bookingItems: { some: {} } } })).toBe(2);

    // The live session, the confirmed subscriber and the recent booking are untouched.
    await ctx.http().get('/v1/me').set(bearer(session.accessToken)).expect(200);
    expect(await ctx.prisma.newsletterSubscription.count()).toBe(1);
    expect(await ctx.prisma.cookieConsent.count({ where: { consentId } })).toBe(1);
    const recent = await ctx.prisma.bookingPassenger.findFirstOrThrow({
      where: { bookingId: recentBooking },
    });
    expect(recent.surname).toBe('ADEYEMI');

    // The long-closed booking keeps its money and loses its personal data.
    const anonymised = await ctx.prisma.booking.findUniqueOrThrow({
      where: { id: oldBooking },
      include: { passengers: true },
    });
    expect(anonymised.anonymisedAt).toBeInstanceOf(Date);
    expect(anonymised.status).toBe('CONFIRMED');
    expect(
      ctx.app.get(FieldEncryption).decrypt(anonymised.contactEncrypted, contactContext(oldBooking)),
    ).toBe(REDACTED_CONTACT_PAYLOAD);
    expect(anonymised.passengers).toEqual([
      expect.objectContaining({
        givenNames: 'REDACTED',
        surname: 'REDACTED',
        dateOfBirth: null,
        passportEncrypted: null,
        documentHint: null,
      }),
    ]);
    expect(await ctx.prisma.ledgerEntry.count()).toBe(ledgerEntries);

    // Nothing is left for a second run, which the worker reaches through the internal route.
    const second = await ctx
      .http()
      .post('/v1/internal/retention/run')
      .set('Authorization', `Bearer ${E2E_INTERNAL_TOKEN}`)
      .expect(200);
    expect(second.body).toEqual(Object.fromEntries(RETENTION_RULES.map((rule) => [rule, 0])));
    // The audit log is append-only, so earlier runs' rows are still there.
    expect((await sweeps()) - sweepsBefore).toBe(2);
  });

  it('records cookie choices without linking them to a person (ADR-042)', async () => {
    const consentId = '0192d3a0-7c1e-7b2a-9f00-00000000c0c1';
    const record = (body: object) =>
      ctx
        .http()
        .post('/v1/privacy/cookie-consents')
        .set('Cookie', 'suskii_locale=en-GB')
        .send(body);

    const saved = await record({
      consentId,
      policyVersion: 1,
      choices: { analytics: true, marketing: false },
    }).expect(201);
    expect(saved.body).toEqual({
      consentId,
      policyVersion: 1,
      choices: { analytics: true, marketing: false },
      recordedAt: expect.any(String),
    });
    // A later change appends, so the history of choices stays provable.
    await record({
      consentId,
      policyVersion: 1,
      choices: { analytics: false, marketing: false },
    }).expect(201);
    const rows = await ctx.prisma.cookieConsent.findMany({
      where: { consentId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((row) => row.analytics)).toEqual([true, false]);

    // Unknown policy versions, missing categories and invented ids are refused.
    await record({
      consentId,
      policyVersion: 99,
      choices: { analytics: true, marketing: true },
    }).expect(400);
    await record({ consentId, policyVersion: 1, choices: { analytics: true } }).expect(400);
    await record({
      consentId: 'not-a-uuid',
      policyVersion: 1,
      choices: { analytics: false, marketing: false },
    }).expect(400);
  });
});
