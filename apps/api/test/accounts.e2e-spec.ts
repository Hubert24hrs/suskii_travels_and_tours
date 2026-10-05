import { addDays, BOOKING_TERMS_VERSION, localDate, money } from '@suskii/shared';

import { BookingsService } from '../src/bookings/bookings.service';
import { transfer } from '../src/ledger/ledger.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { EXPORT_SECTIONS } from '../src/privacy/data-registry';

import {
  bearer,
  enrolTotp,
  grantRoles,
  lastSmsCode,
  login,
  PASSWORD,
  signUp,
  totp,
  type TokenSession,
} from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
let keySequence = 0;
const idempotencyKey = (): string => `e2e-accounts-${Date.now()}-${(keySequence += 1)}`;

describe('accounts (e2e): preferences, data export and deletion', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** A confirmed, paid account booking for a domestic flight, with a saved traveller. */
  async function confirmedBooking(session: TokenSession): Promise<{ id: string }> {
    const auth = bearer(session.accessToken);
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: addDays(today, 30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set(auth)
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId,
        contact: { email: 'traveller@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Chioma',
            surname: 'Okafor',
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
    const booking = await ctx.http().get(`/v1/bookings/${bookingId}`).set(auth).expect(200);
    expect(booking.body.status).toBe('CONFIRMED');
    return { id: bookingId };
  }

  /** Moves a booked flight into the past (the trip is over). */
  async function travelled(bookingId: string): Promise<void> {
    const item = await ctx.prisma.bookingItem.findFirstOrThrow({ where: { bookingId } });
    const payload = item.payload as {
      offer: { slices: { departureLocal: string; arrivalLocal: string }[] };
    };
    const past = addDays(today, -20);
    for (const slice of payload.offer.slices) {
      slice.departureLocal = `${past}T08:00`;
      slice.arrivalLocal = `${past}T09:10`;
    }
    await ctx.prisma.bookingItem.update({ where: { id: item.id }, data: { payload } });
  }

  async function saveTraveller(session: TokenSession): Promise<void> {
    await ctx
      .http()
      .post('/v1/me/travellers')
      .set(bearer(session.accessToken))
      .send({
        title: 'mr',
        gender: 'm',
        givenNames: 'Emeka',
        surname: 'Okafor',
        dateOfBirth: '1988-02-11',
        nationality: 'NG',
        document: { number: 'A7654321', issuingCountry: 'NG', expiryDate: addDays(today, 2000) },
      })
      .expect(201);
  }

  describe('preferences', () => {
    it('stores settings and ties marketing channels to recorded consent', async () => {
      const session = await signUp(ctx, 'prefs@example.com');
      const auth = bearer(session.accessToken);

      const initial = await ctx.http().get('/v1/me/preferences').set(auth).expect(200);
      expect(initial.body).toEqual({
        locale: null,
        currency: null,
        homeAirport: null,
        marketingConsent: false,
        marketingConsentAt: null,
      });

      const updated = await ctx
        .http()
        .patch('/v1/me/preferences')
        .set(auth)
        .set('X-Suskii-Client', 'web/1.0.0')
        .send({ locale: 'en-GB', currency: 'GBP', homeAirport: 'los', marketingConsent: true })
        .expect(200);
      expect(updated.body).toMatchObject({
        locale: 'en-GB',
        currency: 'GBP',
        homeAirport: 'LOS',
        marketingConsent: true,
      });
      const stored = await ctx.prisma.userPreference.findUniqueOrThrow({
        where: { userId: session.userId },
      });
      expect(stored.marketingConsentSource).toBe('account:web');

      const channels = await ctx
        .http()
        .get('/v1/me/notification-preferences')
        .set(auth)
        .expect(200);
      expect(channels.body.preferences).toHaveLength(24);
      const enabled = (category: string, channel: string): boolean =>
        (
          channels.body.preferences as { category: string; channel: string; enabled: boolean }[]
        ).find((row) => row.category === category && row.channel === channel)?.enabled ?? false;
      expect(enabled('marketing', 'email')).toBe(true);
      expect(enabled('booking', 'email')).toBe(true);
      expect(enabled('booking', 'sms')).toBe(false);
      expect(channels.body.phoneVerified).toBe(false);

      // Withdrawing consent switches every marketing channel off.
      await ctx
        .http()
        .patch('/v1/me/preferences')
        .set(auth)
        .send({ marketingConsent: false, homeAirport: null })
        .expect(200);
      const after = await ctx.http().get('/v1/me/notification-preferences').set(auth).expect(200);
      expect(
        (after.body.preferences as { category: string; enabled: boolean }[])
          .filter((row) => row.category === 'marketing')
          .every((row) => !row.enabled),
      ).toBe(true);
      expect(after.body.marketingConsent).toBe(false);
    });

    it('refuses to turn off booking and payment email and records channel choices', async () => {
      const session = await signUp(ctx, 'channels@example.com');
      const auth = bearer(session.accessToken);
      const refused = await ctx
        .http()
        .patch('/v1/me/notification-preferences')
        .set(auth)
        .send({ changes: [{ category: 'payment', channel: 'email', enabled: false }] })
        .expect(422);
      expect(refused.body.type).toBe('urn:suskii:problem:notification-mandatory');

      const changed = await ctx
        .http()
        .patch('/v1/me/notification-preferences')
        .set(auth)
        .send({
          changes: [
            { category: 'price_alert', channel: 'whatsapp', enabled: true },
            { category: 'trip_reminder', channel: 'push', enabled: false },
            { category: 'marketing', channel: 'push', enabled: true },
          ],
        })
        .expect(200);
      const rows = changed.body.preferences as {
        category: string;
        channel: string;
        enabled: boolean;
        mandatory: boolean;
      }[];
      expect(rows).toContainEqual({
        category: 'price_alert',
        channel: 'whatsapp',
        enabled: true,
        mandatory: false,
      });
      expect(rows).toContainEqual({
        category: 'trip_reminder',
        channel: 'push',
        enabled: false,
        mandatory: false,
      });
      expect(rows).toContainEqual({
        category: 'booking',
        channel: 'email',
        enabled: true,
        mandatory: true,
      });
      // Opting in to a marketing channel is consent.
      expect(changed.body.marketingConsent).toBe(true);
    });
  });

  describe('data export', () => {
    it('asks for fresh proof, then returns every section of the account data', async () => {
      const session = await signUp(ctx, 'export@example.com');
      const auth = bearer(session.accessToken);
      await saveTraveller(session);
      const { id: bookingId } = await confirmedBooking(session);
      await ctx
        .http()
        .post('/v1/me/price-alerts')
        .set(auth)
        .send({
          origin: 'LOS',
          destination: 'DXB',
          departureDate: addDays(today, 40),
          currency: 'NGN',
        })
        .expect(201);
      const referrals = await ctx.http().get('/v1/me/referrals').set(auth).expect(200);
      // A membership term (buying one is covered by prime.e2e-spec.ts).
      const plan = await ctx.prisma.primePlan.create({
        data: {
          slug: 'export-plan',
          name: 'Export plan',
          summary: 'A plan for the export test.',
          period: 'year',
          prices: [{ amountMinor: 2_500_000, currency: 'NGN' }],
          benefits: { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: true },
          status: 'published',
        },
      });
      await ctx.prisma.primeMembership.create({
        data: {
          userId: session.userId,
          planId: plan.id,
          bookingId,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
          benefits: { markupShareBps: 0, waivedFeeCodes: [], prioritySupport: true },
        },
      });

      const requirements = await ctx.http().get('/v1/me/reauth').set(auth).expect(200);
      expect(requirements.body).toEqual({
        method: 'password',
        mfa: false,
        recentSignInMinutes: 10,
      });

      const missing = await ctx.http().post('/v1/me/data-export').set(auth).send({}).expect(401);
      expect(missing.body).toMatchObject({
        type: 'urn:suskii:problem:reauthentication-required',
        method: 'password',
        mfa: false,
      });
      await ctx
        .http()
        .post('/v1/me/data-export')
        .set(auth)
        .send({ password: 'not the password' })
        .expect(401);

      const response = await ctx
        .http()
        .post('/v1/me/data-export')
        .set(auth)
        .send({ password: PASSWORD })
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks).toString('utf8')));
        })
        .expect(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['content-disposition']).toMatch(
        /^attachment; filename="suskii-data-export-\d{4}-\d{2}-\d{2}\.json"$/,
      );
      expect(response.headers['cache-control']).toBe('no-store');

      const raw = response.body as string;
      const document = JSON.parse(raw) as {
        format: string;
        accountId: string;
        data: Record<string, unknown>;
      };
      expect(document).toMatchObject({ format: 'suskii-data-export', accountId: session.userId });
      expect(Object.keys(document.data).sort()).toEqual([...EXPORT_SECTIONS].sort());
      expect(document.data.profile).toMatchObject({
        email: 'export@example.com',
        hasPassword: true,
        roles: ['customer'],
      });
      expect(document.data.travellers).toEqual([
        expect.objectContaining({
          givenNames: 'EMEKA',
          passport: expect.objectContaining({ number: 'A7654321' }),
        }),
      ]);
      const bookings = document.data.bookings as { id: string; contact: { email: string } }[];
      expect(bookings).toEqual([
        expect.objectContaining({
          id: bookingId,
          status: 'CONFIRMED',
          contact: { email: 'traveller@example.com', phone: '+2348012345678' },
        }),
      ]);
      expect(document.data.priceAlerts).toEqual([
        expect.objectContaining({ origin: 'LOS', destination: 'DXB', currency: 'NGN' }),
      ]);
      expect(document.data.referrals).toMatchObject({
        code: { code: referrals.body.code as string, active: true },
        referred: [],
        referredBy: null,
      });
      expect(document.data.memberships).toEqual([
        expect.objectContaining({
          plan: { slug: 'export-plan', name: 'Export plan', period: 'year' },
          status: 'active',
          bookingId,
        }),
      ]);
      expect(document.data.payments).toEqual([
        expect.objectContaining({ bookingId, status: 'succeeded' }),
      ]);
      expect(document.data.sessions).toEqual([
        expect.objectContaining({ id: session.sessionId, signInMethod: 'password' }),
      ]);
      expect(document.data.activity).toEqual(
        expect.arrayContaining([expect.objectContaining({ action: 'auth.registered' })]),
      );

      // Never credentials, internal costs or the stored passport ciphertext.
      for (const forbidden of [
        'passwordHash',
        'tokenHash',
        'secretCiphertext',
        'passportEncrypted',
        'supplierTotal',
        'markup',
        PASSWORD,
        session.refreshToken,
      ]) {
        expect(raw).not.toContain(forbidden);
      }

      const audited = await ctx.prisma.auditLog.count({
        where: { action: 'account.data_exported', actorUserId: session.userId },
      });
      expect(audited).toBe(1);
    });

    it('needs the second factor when MFA is on', async () => {
      const session = await signUp(ctx, 'mfa-export@example.com');
      const { secret } = await enrolTotp(ctx, session.accessToken);
      const auth = bearer(session.accessToken);
      const requirements = await ctx.http().get('/v1/me/reauth').set(auth).expect(200);
      expect(requirements.body).toMatchObject({ method: 'password', mfa: true });

      const passwordOnly = await ctx
        .http()
        .post('/v1/me/data-export')
        .set(auth)
        .send({ password: PASSWORD })
        .expect(401);
      expect(passwordOnly.body).toMatchObject({
        type: 'urn:suskii:problem:reauthentication-required',
        mfa: true,
      });
      await ctx
        .http()
        .post('/v1/me/data-export')
        .set(auth)
        .send({ password: PASSWORD, mfaCode: totp(secret, 1) })
        .expect(200);
    });

    it('confirms passwordless phone accounts with a texted code', async () => {
      const phone = '+2348098765432';
      await ctx.http().post('/v1/auth/otp/request').send({ phone }).expect(202);
      const signedIn = await ctx
        .http()
        .post('/v1/auth/otp/verify')
        .send({ phone, code: lastSmsCode(ctx, phone) })
        .expect(200);
      const auth = bearer(signedIn.body.accessToken as string);

      const requirements = await ctx.http().get('/v1/me/reauth').set(auth).expect(200);
      expect(requirements.body).toMatchObject({ method: 'sms_code', mfa: false });
      await ctx.http().post('/v1/me/reauth/code').set(auth).expect(202);
      const code = lastSmsCode(ctx, phone);
      await ctx.http().post('/v1/me/data-export').set(auth).send({ code: '000000' }).expect(401);
      await ctx.http().post('/v1/me/data-export').set(auth).send({ code }).expect(200);
      // Codes are single-use.
      await ctx.http().post('/v1/me/data-export').set(auth).send({ code }).expect(401);
    });
  });

  describe('account deletion', () => {
    it('is refused while a trip is upcoming, money is held or the account is staff', async () => {
      const session = await signUp(ctx, 'blocked@example.com');
      const auth = bearer(session.accessToken);
      await confirmedBooking(session);

      const check = await ctx.http().get('/v1/me/deletion').set(auth).expect(200);
      expect(check.body).toEqual({
        allowed: false,
        blockers: ['upcoming_trip'],
        retentionYears: 7,
      });
      const refused = await ctx
        .http()
        .post('/v1/me/deletion')
        .set(auth)
        .send({ password: PASSWORD, confirm: 'DELETE' })
        .expect(409);
      expect(refused.body).toMatchObject({
        type: 'urn:suskii:problem:account-deletion-blocked',
        blockers: ['upcoming_trip'],
      });

      // Money in the wallet must be paid out first.
      const other = await signUp(ctx, 'wallet@example.com');
      const ledger = ctx.app.get(LedgerService);
      await ctx.prisma.$transaction((tx) =>
        ledger.post(tx, {
          key: `e2e:wallet:${other.userId}`,
          kind: 'refund_to_wallet',
          lines: transfer(
            { kind: 'psp', provider: 'mock', currency: 'NGN' },
            { kind: 'wallet', userId: other.userId, currency: 'NGN' },
            money(5_000n, 'NGN'),
          ),
        }),
      );
      await grantRoles(ctx, other.userId, ['operations']);
      const blocked = await ctx
        .http()
        .get('/v1/me/deletion')
        .set(bearer(other.accessToken))
        .expect(200);
      expect(blocked.body.blockers).toEqual(['staff_account', 'wallet_balance']);
    });

    it('anonymises the account, keeps the financial record and signs out everywhere', async () => {
      const session = await signUp(ctx, 'leaving@example.com');
      const auth = bearer(session.accessToken);
      await saveTraveller(session);
      await ctx
        .http()
        .patch('/v1/me/preferences')
        .set(auth)
        .send({ marketingConsent: true, currency: 'NGN' })
        .expect(200);
      const { id: bookingId } = await confirmedBooking(session);
      await travelled(bookingId);
      const second = await login(ctx, 'leaving@example.com');
      const ledgerEntries = await ctx.prisma.ledgerEntry.count();
      const documents = await ctx.prisma.bookingDocument.count({ where: { bookingId } });
      expect(documents).toBe(1);

      await ctx.http().post('/v1/me/deletion').set(auth).send({ password: PASSWORD }).expect(400);
      const deleted = await ctx
        .http()
        .post('/v1/me/deletion')
        .set(auth)
        .send({ password: PASSWORD, confirm: 'DELETE' })
        .expect(200);
      expect(deleted.body).toMatchObject({ retainedBookings: 1, retentionYears: 7 });

      // The tombstone: no way to sign in, nothing personal left on the user row.
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
      expect(user).toMatchObject({
        email: `deleted-${session.userId}@deleted.invalid`,
        emailVerifiedAt: null,
        phone: null,
        passwordHash: null,
        displayName: null,
        status: 'deleted',
      });
      expect(user.deletedAt).toBeInstanceOf(Date);
      await ctx.http().get('/v1/me').set(auth).expect(401);
      await ctx.http().get('/v1/me').set(bearer(second.accessToken)).expect(401);
      await ctx
        .http()
        .post('/v1/auth/login')
        .send({ email: 'leaving@example.com', password: PASSWORD })
        .expect(401);

      const where = { userId: session.userId };
      expect(
        await Promise.all([
          ctx.prisma.session.count({ where }),
          ctx.prisma.userRole.count({ where }),
          ctx.prisma.traveller.count({ where }),
          ctx.prisma.userPreference.count({ where }),
          ctx.prisma.notificationPreference.count({ where }),
          ctx.prisma.socialIdentity.count({ where }),
          ctx.prisma.verificationToken.count({ where }),
          ctx.prisma.bookingDocument.count({ where: { bookingId } }),
        ]),
      ).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);

      // The booking stays for the accounts, without contact details or passports.
      const booking = await ctx.prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { passengers: true, payments: true },
      });
      expect(booking.redactedAt).toBeInstanceOf(Date);
      expect(booking.userId).toBe(session.userId);
      expect(ctx.app.get(BookingsService).contact(booking).email).toMatch(/\.invalid$/);
      expect(booking.passengers[0]).toMatchObject({
        givenNames: 'CHIOMA',
        surname: 'OKAFOR',
        passportEncrypted: null,
        documentHint: null,
        dateOfBirth: null,
      });
      expect(booking.payments).toHaveLength(1);
      expect(await ctx.prisma.ledgerEntry.count()).toBe(ledgerEntries);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'user.deleted', actorUserId: session.userId },
        }),
      ).toBe(1);

      // The email is free for a new account.
      const fresh = await signUp(ctx, 'leaving@example.com');
      expect(fresh.userId).not.toBe(session.userId);
    });
  });
});
