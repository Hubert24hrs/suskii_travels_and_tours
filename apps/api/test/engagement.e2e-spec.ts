import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { WhatsAppProvider, type MockWhatsAppProvider } from '../src/notifications/whatsapp';

import {
  bearer,
  E2E_TURNSTILE,
  grantRoles,
  login,
  enrolTotp,
  totp,
  PASSWORD,
  register,
  signUp,
  type TokenSession,
} from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
let keySequence = 0;
const idempotencyKey = (): string => `e2e-engage-${Date.now()}-${(keySequence += 1)}`;

describe('engagement (e2e): notifications, price alerts, referrals and reminders', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      REFERRAL_REWARD_REFERRER_MINOR: 200_000,
      REFERRAL_REWARD_REFEREE_MINOR: 100_000,
      REFERRAL_REWARD_CURRENCY: 'NGN',
    });
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get<WhatsAppProvider, MockWhatsAppProvider>(WhatsAppProvider).outbox.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  const internal = (path: string) => ctx.http().post(`/v1/internal/${path}`).set(INTERNAL);
  const mails = (to: string, template: string) =>
    ctx.emails.outbox.filter((mail) => mail.to === to && mail.template === template);

  /** A confirmed account flight, paid with the mock provider. */
  async function confirmedFlight(session: TokenSession, email: string): Promise<string> {
    const auth = bearer(session.accessToken);
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: addDays(today, 20) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .set(auth)
      .expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email, phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Amaka',
            surname: 'Obi',
            dateOfBirth: '1992-03-04',
            nationality: 'NG',
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

  /** Moves the first flight of a booking: departing `hoursFromNow` (negative: in the past). */
  async function moveDeparture(bookingId: string, hoursFromNow: number): Promise<void> {
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId } });
    const payload = item.payload as {
      offer: {
        slices: {
          departureLocal: string;
          departureUtc: string;
          arrivalLocal: string;
          arrivalUtc: string;
        }[];
      };
    };
    const departs = new Date(Date.now() + hoursFromNow * 3_600_000);
    const arrives = new Date(departs.getTime() + 70 * 60_000);
    for (const slice of payload.offer.slices) {
      slice.departureUtc = departs.toISOString();
      slice.arrivalUtc = arrives.toISOString();
      slice.departureLocal = departs.toISOString().slice(0, 16);
      slice.arrivalLocal = arrives.toISOString().slice(0, 16);
    }
    await ctx.prisma.bookingItem.update({ where: { id: item.id }, data: { payload } });
  }

  describe('price alerts', () => {
    it('limits alerts per account and checks ownership', async () => {
      const session = await signUp(ctx, 'limits@example.com');
      const auth = bearer(session.accessToken);
      const alert = (destination: string, extra: Record<string, unknown> = {}) =>
        ctx
          .http()
          .post('/v1/me/price-alerts')
          .set(auth)
          .send({
            origin: 'LOS',
            destination,
            departureDate: addDays(today, 30),
            currency: 'NGN',
            ...extra,
          });

      const first = await alert('ABV').expect(201);
      expect(first.body).toMatchObject({
        origin: 'LOS',
        destination: 'ABV',
        cabinClass: 'economy',
        active: true,
        lastPrice: null,
      });
      const duplicate = await alert('ABV').expect(409);
      expect(duplicate.body.type).toBe('urn:suskii:problem:price-alert-exists');
      const past = await alert('LHR', { departureDate: addDays(today, -1) }).expect(422);
      expect(past.body.type).toBe('urn:suskii:problem:price-alert-dates');

      for (const code of ['LHR', 'DXB', 'JFK', 'ACC', 'NBO', 'JNB', 'CDG', 'IST', 'DOH']) {
        await alert(code).expect(201);
      }
      const limit = await alert('PHC').expect(409);
      expect(limit.body.type).toBe('urn:suskii:problem:price-alert-limit');

      const other = await signUp(ctx, 'other@example.com');
      await ctx
        .http()
        .delete(`/v1/me/price-alerts/${first.body.id as string}`)
        .set(bearer(other.accessToken))
        .expect(404);
      await ctx
        .http()
        .delete(`/v1/me/price-alerts/${first.body.id as string}`)
        .set(auth)
        .expect(204);
      const list = await ctx.http().get('/v1/me/price-alerts').set(auth).expect(200);
      expect(list.body).toMatchObject({ limit: 10 });
      expect(list.body.alerts).toHaveLength(9);
    });

    it('notifies at the target through the chosen channels and logs every attempt', async () => {
      const session = await signUp(ctx, 'watcher@example.com');
      const auth = bearer(session.accessToken);
      await ctx
        .http()
        .patch('/v1/me/notification-preferences')
        .set(auth)
        .send({ changes: [{ category: 'price_alert', channel: 'whatsapp', enabled: true }] })
        .expect(200);
      const created = await ctx
        .http()
        .post('/v1/me/price-alerts')
        .set(auth)
        .send({
          origin: 'LOS',
          destination: 'ABV',
          departureDate: addDays(today, 30),
          currency: 'NGN',
          targetMinor: 1_000_000_000,
        })
        .expect(201);

      const run = await internal('price-alerts/run').expect(200);
      expect(run.body).toEqual({ checked: 1, notified: 1, retired: 0, failed: 0 });
      expect(mails('watcher@example.com', 'price-alert')).toHaveLength(1);
      expect(mails('watcher@example.com', 'price-alert')[0]?.text).toContain(
        'https://web.suskii.test/flights/search?trip=one_way&from=LOS&to=ABV',
      );
      const log = await ctx.prisma.notification.findMany({
        where: { userId: session.userId },
        orderBy: { channel: 'asc' },
      });
      expect(log.map((row) => [row.channel, row.status, row.reason])).toEqual([
        ['email', 'sent', null],
        ['sms', 'skipped', 'preference_off'],
        ['whatsapp', 'skipped', 'no_verified_phone'],
        ['push', 'skipped', 'no_device'],
      ]);

      const listed = await ctx.http().get('/v1/me/price-alerts').set(auth).expect(200);
      expect(listed.body.alerts[0]).toMatchObject({
        id: created.body.id,
        lastPrice: { currency: 'NGN' },
        lastNotifiedAt: expect.any(String),
      });
      // Checked at most every PRICE_ALERT_INTERVAL_HOURS.
      expect((await internal('price-alerts/run').expect(200)).body.checked).toBe(0);
    });

    it('records a baseline first, then notifies a big enough drop', async () => {
      const session = await signUp(ctx, 'drops@example.com');
      await ctx
        .http()
        .post('/v1/me/price-alerts')
        .set(bearer(session.accessToken))
        .send({
          origin: 'LOS',
          destination: 'ABV',
          departureMonth: addDays(today, 45).slice(0, 7),
          currency: 'NGN',
        })
        .expect(201);
      expect((await internal('price-alerts/run').expect(200)).body.notified).toBe(0);
      const alert = await ctx.prisma.priceAlert.findFirstOrThrow({
        where: { userId: session.userId },
      });
      expect(alert.lastNotifiedMinor).toBe(alert.lastPriceMinor);
      expect(alert.lastNotifiedAt).toBeNull();

      // Pretend the fare was far higher at the baseline and the interval has passed.
      await ctx.prisma.priceAlert.update({
        where: { id: alert.id },
        data: {
          lastNotifiedMinor: (alert.lastPriceMinor ?? 0n) * 2n,
          lastCheckedAt: new Date(Date.now() - 7 * 3_600_000),
        },
      });
      expect((await internal('price-alerts/run').expect(200)).body.notified).toBe(1);
      expect(mails('drops@example.com', 'price-alert')).toHaveLength(1);
    });

    it('respects a price-alert email opt-out', async () => {
      const session = await signUp(ctx, 'quiet@example.com');
      const auth = bearer(session.accessToken);
      await ctx
        .http()
        .patch('/v1/me/notification-preferences')
        .set(auth)
        .send({ changes: [{ category: 'price_alert', channel: 'email', enabled: false }] })
        .expect(200);
      await ctx
        .http()
        .post('/v1/me/price-alerts')
        .set(auth)
        .send({
          origin: 'LOS',
          destination: 'ABV',
          departureDate: addDays(today, 30),
          currency: 'NGN',
          targetMinor: 1_000_000_000,
        })
        .expect(201);
      await internal('price-alerts/run').expect(200);
      expect(mails('quiet@example.com', 'price-alert')).toHaveLength(0);
      const email = await ctx.prisma.notification.findFirstOrThrow({
        where: { userId: session.userId, channel: 'email' },
      });
      expect([email.status, email.reason]).toEqual(['skipped', 'preference_off']);
    });
  });

  describe('referrals', () => {
    async function referrer(email: string) {
      const session = await signUp(ctx, email);
      const mine = await ctx
        .http()
        .get('/v1/me/referrals')
        .set(bearer(session.accessToken))
        .expect(200);
      // Tests run from one address; give the referrer's sessions another one.
      await ctx.prisma.session.updateMany({
        where: { userId: session.userId },
        data: { ipHash: 'elsewhere' },
      });
      return { session, code: mine.body.code as string, body: mine.body };
    }

    it('rewards both wallets once the referred friend has completed a trip', async () => {
      const { session: inviter, code, body } = await referrer('inviter@example.com');
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(body).toMatchObject({
        shareUrl: `https://web.suskii.test/register?ref=${code}`,
        counts: { pending: 0, rewarded: 0 },
        rewards: {
          referrer: { amountMinor: 200_000, currency: 'NGN' },
          referee: { amountMinor: 100_000, currency: 'NGN' },
          minSpend: null,
        },
        referredBy: null,
      });

      await ctx
        .http()
        .post('/v1/auth/register')
        .send({
          turnstileToken: E2E_TURNSTILE,
          email: 'friend@example.com',
          password: PASSWORD,
          referralCode: code.toLowerCase().replace(/(.{4})/, '$1-'),
        })
        .expect(202);
      await ctx.background.drain();
      const friend = await login(ctx, 'friend@example.com');
      const referral = await ctx.prisma.referral.findUniqueOrThrow({
        where: { refereeId: friend.userId },
      });
      expect(referral).toMatchObject({ referrerId: inviter.userId, status: 'pending', flags: [] });
      expect(JSON.stringify(referral.signals)).not.toContain('friend@example.com');

      // Nothing before the trip is over.
      const bookingId = await confirmedFlight(friend, 'friend@example.com');
      expect((await internal('referrals/run').expect(200)).body).toEqual({
        qualified: 0,
        review: 0,
        rewarded: 0,
      });
      await moveDeparture(bookingId, -72);
      expect((await internal('referrals/run').expect(200)).body).toEqual({
        qualified: 1,
        review: 0,
        rewarded: 1,
      });
      expect((await internal('referrals/run').expect(200)).body.rewarded).toBe(0);

      const wallet = async (token: string) =>
        (await ctx.http().get('/v1/me/wallet').set(bearer(token)).expect(200)).body as {
          balances: { balance: { amountMinor: number } }[];
        };
      expect(JSON.stringify(await wallet(inviter.accessToken))).toContain('200000');
      expect(JSON.stringify(await wallet(friend.accessToken))).toContain('100000');
      const promotions = await ctx.prisma.ledgerAccount.findUniqueOrThrow({
        where: { code: 'expense:promotions:NGN' },
      });
      expect(promotions.balanceMinor).toBe(300_000n);
      expect(mails('inviter@example.com', 'referral-reward')).toHaveLength(1);

      const after = await ctx
        .http()
        .get('/v1/me/referrals')
        .set(bearer(inviter.accessToken))
        .expect(200);
      expect(after.body.counts).toMatchObject({ rewarded: 1, pending: 0 });
      const friendView = await ctx
        .http()
        .get('/v1/me/referrals')
        .set(bearer(friend.accessToken))
        .expect(200);
      expect(friendView.body.referredBy).toMatchObject({ status: 'rewarded' });
    });

    it('ignores unknown codes and sends suspicious sign-ups to staff review', async () => {
      const { session: inviter, code } = await referrer('host@example.com');
      await register(ctx, 'nobody@example.com');
      await ctx
        .http()
        .post('/v1/auth/register')
        .send({
          turnstileToken: E2E_TURNSTILE,
          email: 'stranger@example.com',
          password: PASSWORD,
          referralCode: 'ZZZZZZZZ',
        })
        .expect(202);
      await ctx.background.drain();
      expect(await ctx.prisma.referral.count()).toBe(0);

      await ctx
        .http()
        .post('/v1/auth/register')
        .send({
          turnstileToken: E2E_TURNSTILE,
          email: 'temp@mailinator.com',
          password: PASSWORD,
          referralCode: code,
        })
        .expect(202);
      await ctx.background.drain();
      const flagged = await ctx.prisma.referral.findFirstOrThrow();
      expect(flagged).toMatchObject({ status: 'review', flags: ['disposable_email'] });

      const finance = await signUp(ctx, 'reviewer@example.com');
      await grantRoles(ctx, finance.userId, ['finance']);
      const { secret } = await enrolTotp(ctx, finance.accessToken);
      const pending = await ctx
        .http()
        .post('/v1/auth/login')
        .send({ email: 'reviewer@example.com', password: PASSWORD })
        .expect(200);
      const verified = await ctx
        .http()
        .post('/v1/auth/mfa/verify')
        .send({ mfaToken: pending.body.mfaToken, code: totp(secret, 1) })
        .expect(200);
      const staff = bearer(verified.body.accessToken as string);

      const queue = await ctx.http().get('/v1/admin/referrals').set(staff).expect(200);
      expect(queue.body.referrals).toEqual([
        expect.objectContaining({ id: flagged.id, referrerId: inviter.userId, status: 'review' }),
      ]);
      await ctx.http().get('/v1/admin/referrals').set(bearer(inviter.accessToken)).expect(403);
      await ctx
        .http()
        .post(`/v1/admin/referrals/${flagged.id}/decision`)
        .set(staff)
        .send({ decision: 'reject' })
        .expect(204);
      await ctx
        .http()
        .post(`/v1/admin/referrals/${flagged.id}/decision`)
        .set(staff)
        .send({ decision: 'approve' })
        .expect(409);
      expect((await ctx.prisma.referral.findFirstOrThrow()).status).toBe('rejected');
    });
  });

  describe('reminders', () => {
    it('reminds account travellers to check in once, the day before departure', async () => {
      const session = await signUp(ctx, 'flyer@example.com');
      const bookingId = await confirmedFlight(session, 'flyer@example.com');
      expect((await internal('reminders/run').expect(200)).body).toEqual({ checkin: 0, prime: 0 });

      await moveDeparture(bookingId, 5);
      expect((await internal('reminders/run').expect(200)).body).toEqual({ checkin: 1, prime: 0 });
      expect(mails('flyer@example.com', 'checkin-reminder')).toHaveLength(1);
      expect((await internal('reminders/run').expect(200)).body.checkin).toBe(0);
      const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(booking.checkinRemindedAt).toBeInstanceOf(Date);
    });

    it('reminds members before their last paid term ends', async () => {
      const session = await signUp(ctx, 'member@example.com');
      const plan = await ctx.prisma.primePlan.create({
        data: {
          slug: 'prime-test',
          name: 'Suskii Prime Test',
          summary: 'Test plan.',
          period: 'month',
          prices: [{ amountMinor: 100_000, currency: 'NGN' }],
          benefits: { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: false },
          status: 'published',
        },
      });
      const ends = new Date(Date.now() + 3 * 86_400_000);
      await ctx.prisma.primeMembership.create({
        data: {
          userId: session.userId,
          planId: plan.id,
          bookingId: '01920000-0000-7000-8000-00000000b001',
          startsAt: new Date(ends.getTime() - 30 * 86_400_000),
          endsAt: ends,
          benefits: { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: false },
        },
      });
      expect((await internal('reminders/run').expect(200)).body).toEqual({ checkin: 0, prime: 1 });
      expect(mails('member@example.com', 'prime-expiry')).toHaveLength(1);
      expect((await internal('reminders/run').expect(200)).body.prime).toBe(0);
    });
  });
});
