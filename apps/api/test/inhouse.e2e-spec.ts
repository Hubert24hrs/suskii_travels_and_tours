import { addDays, BOOKING_TERMS_VERSION, localDate, VOUCHER_QR_PREFIX } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';

import { bearer, enrolTotp, grantRoles, PASSWORD, signUp, totp } from './helpers/flows';
import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

/**
 * Phase 8 acceptance (ADR-025, ADR-027, ADR-028): packages, tours, visa assistance and add-ons
 * are each bookable end to end with the mock payment provider, on the shared booking pipeline:
 * catalog managed through admin routes, quotes, seats reserved without overselling and released
 * on expiry, fulfilment with vouchers, redemption once, cancellation under policy, add-ons linked
 * to a trip and package payment plans.
 */

const today = localDate(new Date(), 'UTC');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };
const ngn = (naira: number) => ({ amountMinor: naira * 100, currency: 'NGN' });

let keySequence = 0;
const idempotencyKey = (): string => `e2e-inhouse-${Date.now()}-${(keySequence += 1)}`;

const contact = { email: 'amaka@example.com', phone: '+2348012345678' };
const person = (
  givenNames: string,
  surname: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames,
  surname,
  dateOfBirth: '1990-04-01',
  nationality: 'NG',
  document: {
    number: `A${Math.floor(Math.random() * 1e7)}`,
    issuingCountry: 'NG',
    expiryDate: inDays(3650),
  },
  ...extra,
});
const policy = [
  { daysBefore: 7, refundBps: 10_000 },
  { daysBefore: 2, refundBps: 5_000 },
  { daysBefore: 0, refundBps: 0 },
];

interface Money {
  amountMinor: number;
  currency: string;
}

describe('in-house products (e2e): packages, tours, visa and add-ons', () => {
  let ctx: TestContext;
  let staffHeaders: Record<string, string>;
  let lagosId: string;
  let dubaiId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    // Refunds from a previous test run in the background; let them finish before truncating.
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    staffHeaders = (await staff('ops@suskii.test', ['content_manager', 'operations'])).headers;
    lagosId = (
      await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos', countryCode: 'NG' } })
    ).id;
    dubaiId = (
      await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Dubai', countryCode: 'AE' } })
    ).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function staff(email: string, roles: Parameters<typeof grantRoles>[2]) {
    const initial = await signUp(ctx, email);
    await grantRoles(ctx, initial.userId, roles);
    const { secret } = await enrolTotp(ctx, initial.accessToken);
    const pending = await ctx
      .http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const verified = await ctx
      .http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: pending.body.mfaToken, code: totp(secret, 1) })
      .expect(200);
    return { userId: initial.userId, headers: bearer(verified.body.accessToken as string) };
  }

  const admin = () => ({
    post: (path: string, body: object) =>
      ctx.http().post(`/v1/admin/${path}`).set(staffHeaders).send(body),
    patch: (path: string, body: object) =>
      ctx.http().patch(`/v1/admin/${path}`).set(staffHeaders).send(body),
  });

  async function packageWithDeparture(
    options: { capacity?: number; startIn?: number; child?: Money | null } = {},
  ): Promise<{ packageId: string; departureId: string; slug: string }> {
    const slug = `lagos-getaway-${(keySequence += 1)}`;
    const created = await admin()
      .post('packages', {
        slug,
        title: 'Lagos getaway',
        summary: 'Three nights by the lagoon.',
        cityId: lagosId,
        nights: 3,
        passportRequired: false,
        cancellationPolicy: policy,
        inclusions: ['Hotel', 'Airport transfers'],
      })
      .expect(201);
    const packageId = created.body.id as string;
    const departure = await admin()
      .post(`packages/${packageId}/departures`, {
        startDate: inDays(options.startIn ?? 60),
        endDate: inDays((options.startIn ?? 60) + 3),
        capacity: options.capacity ?? 10,
        prices: {
          adult: ngn(200_000),
          child: options.child === undefined ? ngn(120_000) : options.child,
          infant: null,
        },
      })
      .expect(201);
    await admin().patch(`packages/${packageId}`, { status: 'published' }).expect(204);
    return { packageId, departureId: departure.body.id as string, slug };
  }

  async function tourWithDeparture(startIn = 10): Promise<{ departureId: string; slug: string }> {
    const slug = `lagos-walk-${(keySequence += 1)}`;
    const created = await admin()
      .post('tours', {
        slug,
        title: 'Lagos walking tour',
        summary: 'Markets and history on foot.',
        cityId: lagosId,
        timeZone: 'Africa/Lagos',
        durationMinutes: 180,
        meetingPoint: { name: 'Tafawa Balewa Square', address: 'Lagos Island', notes: null },
        cancellationPolicy: policy,
      })
      .expect(201);
    const departure = await admin()
      .post(`tours/${created.body.id as string}/departures`, {
        startsAtLocal: `${inDays(startIn)}T09:00`,
        capacity: 8,
        prices: { adult: ngn(30_000), child: ngn(15_000), infant: ngn(0) },
      })
      .expect(201);
    await admin()
      .patch(`tours/${created.body.id as string}`, { status: 'published' })
      .expect(204);
    return { departureId: departure.body.id as string, slug };
  }

  function quote(body: Record<string, unknown>) {
    return ctx.http().post('/v1/inhouse-quotes').send(body);
  }

  function book(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .set(headers)
      .send({
        contact,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        ...body,
      });
  }

  /** The parts of a booking these tests read (the contract is checked by the API itself). */
  interface BookingBody {
    id: string;
    reference: string;
    status: string;
    voucher: { code: string; qrPayload: string };
    cancellation: { refundBps: number; refund: Money } | null;
    visa: { applications: unknown[] };
    [field: string]: unknown;
  }

  async function payInFull(bookingId: string, token: Record<string, string>): Promise<BookingBody> {
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${bookingId}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(token)
      .send({})
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const response = await ctx.http().get(`/v1/bookings/${bookingId}`).set(token).expect(200);
    return response.body as BookingBody;
  }

  async function departureSeats(departureId: string) {
    return ctx.prisma.packageDeparture.findUniqueOrThrow({
      where: { id: departureId },
      select: { seatsReserved: true, seatsSold: true },
    });
  }

  describe('catalog management', () => {
    it('keeps drafts private, publishes through admin routes and audits every change', async () => {
      const draft = await admin()
        .post('packages', {
          slug: 'draft-package',
          title: 'Draft',
          summary: 'Not yet.',
          cityId: lagosId,
          nights: 2,
          cancellationPolicy: policy,
        })
        .expect(201);
      expect(draft.body).toEqual({ id: expect.any(String), status: 'draft' });
      await ctx.http().get('/v1/packages/draft-package').expect(404);
      await admin()
        .post('packages', {
          slug: 'draft-package',
          title: 'Again',
          summary: 'Duplicate.',
          cityId: lagosId,
          nights: 2,
          cancellationPolicy: policy,
        })
        .expect(409);
      // A policy where cancelling later refunds more is rejected.
      await admin()
        .post('packages', {
          slug: 'bad-policy',
          title: 'Bad',
          summary: 'Bad policy.',
          cityId: lagosId,
          nights: 2,
          cancellationPolicy: [
            { daysBefore: 30, refundBps: 5_000 },
            { daysBefore: 7, refundBps: 9_000 },
          ],
        })
        .expect(400);

      const { slug, departureId } = await packageWithDeparture();
      const list = await ctx.http().get('/v1/packages?adults=2').expect(200);
      expect(list.body.packages).toEqual([
        expect.objectContaining({
          slug,
          cityName: 'Lagos',
          countryCode: 'NG',
          nights: 3,
          sample: false,
          fromPrice: ngn(200_000),
          departures: 1,
        }),
      ]);
      const detail = await ctx.http().get(`/v1/packages/${slug}?adults=2&children=1`).expect(200);
      expect(detail.body.departures).toEqual([
        expect.objectContaining({
          id: departureId,
          seatsLeft: 10,
          bookable: true,
          prices: { adult: ngn(200_000), child: ngn(120_000), infant: null },
        }),
      ]);
      // Infants may not book this departure.
      const withInfant = await ctx
        .http()
        .get(`/v1/packages/${slug}?adults=2&infants=1`)
        .expect(200);
      expect(withInfant.body.departures[0].bookable).toBe(false);

      // Customers cannot manage the catalog.
      const customer = await signUp(ctx, 'shopper@example.com');
      await ctx
        .http()
        .post('/v1/admin/packages')
        .set(bearer(customer.accessToken))
        .send({})
        .expect(403);
      const audited = await ctx.prisma.auditLog.count({
        where: {
          action: {
            in: ['catalog.created', 'catalog.status_changed', 'catalog.departure_created'],
          },
        },
      });
      expect(audited).toBeGreaterThanOrEqual(3);
    });

    it('never shrinks capacity below the places already taken', async () => {
      const { departureId } = await packageWithDeparture({ capacity: 4 });
      const q = await quote({
        kind: 'package',
        departureId,
        travellers: { adults: 3, children: 0, infants: 0 },
      }).expect(201);
      await book({
        quoteId: q.body.quoteId,
        passengers: [person('Ada', 'Obi'), person('Bola', 'Obi'), person('Chidi', 'Obi')],
      }).expect(201);
      await admin().patch(`package-departures/${departureId}`, { capacity: 2 }).expect(409);
      await admin().patch(`package-departures/${departureId}`, { capacity: 3 }).expect(204);
    });
  });

  describe('packages', () => {
    it('books a package as a guest, confirms it with a voucher and sells the seats', async () => {
      const { departureId } = await packageWithDeparture();
      const q = await quote({
        kind: 'package',
        departureId,
        travellers: { adults: 2, children: 1, infants: 0 },
      }).expect(201);
      expect(q.body).toMatchObject({
        vertical: 'packages',
        flight: null,
        hotel: null,
        package: {
          departureId,
          cityName: 'Lagos',
          nights: 3,
          startDate: inDays(60),
          travellers: { adults: 2, children: 1, infants: 0 },
          cancellationPolicy: policy,
        },
        price: { total: ngn(520_000) },
      });
      // Package plans: reserve until the balance-due date (30 days before departure).
      expect(q.body.payment.hold).toEqual(expect.objectContaining({ total: ngn(520_000) }));

      // Children and infants follow the departure's price table.
      await quote({
        kind: 'package',
        departureId,
        travellers: { adults: 1, children: 0, infants: 1 },
      })
        .expect(422)
        .expect((response) => expect(response.body.code).toBe('infants_not_allowed'));

      const created = await book({
        quoteId: q.body.quoteId,
        passengers: [
          person('Amaka', 'Nwosu'),
          person('Emeka', 'Nwosu', { title: 'mr', gender: 'm' }),
          person('Ife', 'Nwosu', { type: 'child', title: 'miss', dateOfBirth: inDays(-8 * 365) }),
        ],
      }).expect(201);
      const booking = created.body.booking;
      expect(booking).toMatchObject({
        status: 'PRICED',
        vertical: 'packages',
        price: { total: ngn(520_000) },
        voucher: null,
        cancellation: null,
      });
      expect(await departureSeats(departureId)).toEqual({ seatsReserved: 3, seatsSold: 0 });

      const token = { 'X-Booking-Token': created.body.accessToken as string };
      const confirmed = await payInFull(booking.id, token);
      expect(confirmed).toMatchObject({
        status: 'CONFIRMED',
        documents: [{ type: 'package_voucher' }],
        voucher: { redeemedAt: null },
        cancellation: { refundBps: 10_000, refund: ngn(520_000) },
      });
      expect(confirmed.voucher.code).toMatch(/^([A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/);
      expect(await departureSeats(departureId)).toEqual({ seatsReserved: 0, seatsSold: 3 });

      // Only the code's HMAC is stored, and the code itself is encrypted.
      const voucher = await ctx.prisma.bookingVoucher.findFirstOrThrow({
        where: { bookingId: booking.id },
      });
      const raw = confirmed.voucher.code.replaceAll('-', '');
      expect(voucher.codeHash).not.toContain(raw);
      expect(voucher.codeEncrypted).not.toContain(raw);

      const email = ctx.emails.outbox.find((message) => message.template === 'booking-confirmed');
      expect(email?.text).toContain('holiday package');
      expect(email?.attachments?.[0]?.filename).toContain('package-voucher');
    });

    it('never oversells the last places and releases them when a booking expires', async () => {
      const { departureId } = await packageWithDeparture({ capacity: 2 });
      const travellers = { adults: 2, children: 0, infants: 0 };
      const [first, second] = await Promise.all([
        quote({ kind: 'package', departureId, travellers }).expect(201),
        quote({ kind: 'package', departureId, travellers }).expect(201),
      ]);
      const attempts = await Promise.all(
        [first, second].map((q) =>
          book({
            quoteId: q.body.quoteId,
            passengers: [
              person('Kemi', 'Ade'),
              person('Tunde', 'Ade', { title: 'mr', gender: 'm' }),
            ],
          }),
        ),
      );
      expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
      const loser = attempts.find((response) => response.status === 409);
      expect(loser?.body.type).toContain('sold-out');
      expect(await departureSeats(departureId)).toEqual({ seatsReserved: 2, seatsSold: 0 });
      await quote({ kind: 'package', departureId, travellers }).expect(409);

      const winner = attempts.find((response) => response.status === 201);
      await ctx.prisma.booking.update({
        where: { id: winner?.body.booking.id as string },
        data: { paymentDeadline: new Date(Date.now() - 60_000) },
      });
      await ctx.http().post('/v1/internal/bookings/expire-due').set(INTERNAL).expect(200);
      expect(await departureSeats(departureId)).toEqual({ seatsReserved: 0, seatsSold: 0 });
      await quote({ kind: 'package', departureId, travellers }).expect(201);
    });

    it('reserves a package with the plan deadline at the balance-due date', async () => {
      const { departureId } = await packageWithDeparture({ startIn: 50 });
      const q = await quote({
        kind: 'package',
        departureId,
        travellers: { adults: 1, children: 0, infants: 0 },
      }).expect(201);
      const created = await book({
        quoteId: q.body.quoteId,
        passengers: [person('Ngozi', 'Eke')],
      }).expect(201);
      const token = { 'X-Booking-Token': created.body.accessToken as string };
      const held = await ctx
        .http()
        .post(`/v1/bookings/${created.body.booking.id as string}/hold`)
        .set('Idempotency-Key', idempotencyKey())
        .set(token)
        .expect(200);
      expect(held.body).toMatchObject({ status: 'HELD', paymentPlan: { kind: 'hold' } });
      expect(new Date(held.body.paymentPlan.deadline as string).getTime()).toBeLessThanOrEqual(
        new Date(`${inDays(20)}T00:00:00.000Z`).getTime(),
      );
      const confirmed = await payInFull(created.body.booking.id as string, token);
      expect(confirmed.status).toBe('CONFIRMED');
    });

    it('re-checks the catalog price before payment and asks for consent when it moved', async () => {
      const { departureId } = await packageWithDeparture();
      const q = await quote({
        kind: 'package',
        departureId,
        travellers: { adults: 1, children: 0, infants: 0 },
      }).expect(201);
      const created = await book({
        quoteId: q.body.quoteId,
        passengers: [person('Uche', 'Oji')],
      }).expect(201);
      await admin()
        .patch(`package-departures/${departureId}`, {
          prices: { adult: ngn(210_000), child: null, infant: null },
        })
        .expect(204);
      const token = { 'X-Booking-Token': created.body.accessToken as string };
      const changed = await ctx
        .http()
        .post(`/v1/bookings/${created.body.booking.id as string}/payments`)
        .set('Idempotency-Key', idempotencyKey())
        .set(token)
        .send({})
        .expect(409);
      expect(changed.body.priceChange).toMatchObject({
        previous: ngn(200_000),
        current: ngn(210_000),
      });
    });
  });

  describe('tours', () => {
    it('confirms a tour with a QR voucher that operations redeem once, then cancels under policy', async () => {
      const { departureId, slug } = await tourWithDeparture(10);
      const tours = await ctx.http().get('/v1/tours?q=lagos&adults=2').expect(200);
      expect(tours.body.tours[0]).toMatchObject({
        slug,
        durationMinutes: 180,
        fromPrice: ngn(30_000),
      });
      const q = await quote({
        kind: 'tour',
        departureId,
        travellers: { adults: 2, children: 0, infants: 0 },
      }).expect(201);
      expect(q.body.tour).toMatchObject({
        startsAtLocal: `${inDays(10)}T09:00`,
        timeZone: 'Africa/Lagos',
        meetingPoint: { name: 'Tafawa Balewa Square' },
      });
      const created = await book({
        quoteId: q.body.quoteId,
        passengers: [
          person('Funmi', 'Bello'),
          person('Seun', 'Bello', { title: 'mr', gender: 'm' }),
        ],
      }).expect(201);
      const token = { 'X-Booking-Token': created.body.accessToken as string };
      const confirmed = await payInFull(created.body.booking.id as string, token);
      expect(confirmed).toMatchObject({
        status: 'CONFIRMED',
        documents: [{ type: 'tour_voucher' }],
      });
      expect(confirmed.voucher.qrPayload).toBe(
        `${VOUCHER_QR_PREFIX}${confirmed.voucher.code.replaceAll('-', '')}`,
      );
      expect(confirmed.voucher.qrPayload).not.toContain('BELLO');

      // Redeem once, by scanning; the answer carries no names.
      const redeemed = await admin()
        .post('vouchers/redeem', { code: confirmed.voucher.qrPayload })
        .expect(200);
      expect(redeemed.body).toEqual({
        bookingReference: confirmed.reference,
        kind: 'tour',
        title: 'Lagos walking tour',
        startsOn: `${inDays(10)}T09:00`,
        travellers: 2,
        redeemedAt: expect.any(String),
      });
      await admin().post('vouchers/redeem', { code: confirmed.voucher.code }).expect(409);
      await admin().post('vouchers/redeem', { code: 'ABCD-EFGH-JKMN-PQRS-TUVW' }).expect(404);

      // Ten days out: the first tier refunds everything, automatically.
      const cancelled = await ctx
        .http()
        .post(`/v1/bookings/${created.body.booking.id as string}/cancel`)
        .set(token)
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'REFUND_PENDING',
        refunds: [{ amount: ngn(60_000), status: expect.any(String) }],
        voucher: null,
      });
      await ctx.background.drain();
      await ctx.http().post('/v1/internal/bookings/refunds-due').set(INTERNAL).expect(200);
      await ctx.background.drain();
      const seats = await ctx.prisma.tourDeparture.findUniqueOrThrow({
        where: { id: departureId },
      });
      expect({ reserved: seats.seatsReserved, sold: seats.seatsSold }).toEqual({
        reserved: 0,
        sold: 0,
      });
      // A cancelled booking's voucher is void.
      const replay = await admin().post('vouchers/redeem', { code: confirmed.voucher.code });
      expect([404, 409]).toContain(replay.status);
    });

    it('keeps the fee and refunds the tier share when cancelling late', async () => {
      const { departureId } = await tourWithDeparture(4);
      const q = await quote({
        kind: 'tour',
        departureId,
        travellers: { adults: 1, children: 0, infants: 0 },
      }).expect(201);
      const created = await book({
        quoteId: q.body.quoteId,
        passengers: [person('Tobi', 'Lawal')],
      }).expect(201);
      const token = { 'X-Booking-Token': created.body.accessToken as string };
      const confirmed = await payInFull(created.body.booking.id as string, token);
      expect(confirmed.cancellation).toEqual({ refundBps: 5_000, refund: ngn(15_000) });
      const cancelled = await ctx
        .http()
        .post(`/v1/bookings/${created.body.booking.id as string}/cancel`)
        .set(token)
        .expect(200);
      expect(cancelled.body.refunds).toEqual([expect.objectContaining({ amount: ngn(15_000) })]);
      const fee = await ctx.prisma.ledgerTransaction.findFirst({
        where: { idempotencyKey: `booking:${created.body.booking.id as string}:cancellation-fee` },
      });
      expect(fee).not.toBeNull();
    });
  });

  describe('add-ons', () => {
    async function addon(requiredDetails: string[] = []) {
      const created = await admin()
        .post('addons', {
          slug: `transfer-${(keySequence += 1)}`,
          type: 'airport_transfer',
          title: 'Airport transfer',
          summary: 'Private car.',
          description: 'Meet and greet at arrivals.',
          countryCodes: ['NG'],
          pricingBasis: 'per_booking',
          price: ngn(25_000),
          maxTravellers: 4,
          requiredDetails,
          cancellationPolicy: policy,
        })
        .expect(201);
      await admin()
        .patch(`addons/${created.body.id as string}`, { status: 'published' })
        .expect(204);
      return created.body.id as string;
    }

    it('attaches an add-on to a trip found by reference and last name', async () => {
      // The trip: a confirmed package in Lagos.
      const { departureId } = await packageWithDeparture({ startIn: 40 });
      const tripQuote = await quote({
        kind: 'package',
        departureId,
        travellers: { adults: 1, children: 0, infants: 0 },
      }).expect(201);
      const trip = await book({
        quoteId: tripQuote.body.quoteId,
        passengers: [person('Zainab', 'Musa')],
      }).expect(201);
      const tripToken = { 'X-Booking-Token': trip.body.accessToken as string };
      const tripBooking = await payInFull(trip.body.booking.id as string, tripToken);

      // Wrong names and references look the same.
      await ctx
        .http()
        .post('/v1/addon-links')
        .send({ reference: tripBooking.reference, lastName: 'Someone' })
        .expect(404);
      await ctx
        .http()
        .post('/v1/addon-links')
        .send({ reference: 'ZZZZZZ', lastName: 'Musa' })
        .expect(404);
      const link = await ctx
        .http()
        .post('/v1/addon-links')
        .send({ reference: tripBooking.reference, lastName: 'musa' })
        .expect(200);
      expect(link.body.trip).toEqual({
        reference: tripBooking.reference,
        countryCode: 'NG',
        cityName: 'Lagos',
        startDate: inDays(40),
        endDate: inDays(43),
        travellers: { adults: 1, children: 0, infants: 0 },
      });
      expect(JSON.stringify(link.body)).not.toContain('MUSA');

      const addonId = await addon(['flight_number', 'arrival_time']);
      const q = await quote({
        kind: 'addon',
        addonId,
        startDate: inDays(40),
        endDate: inDays(40),
        travellers: { adults: 1, children: 0, infants: 0 },
        linkToken: link.body.linkToken,
      }).expect(201);
      expect(q.body).toMatchObject({
        vertical: 'travel_addons',
        addon: {
          type: 'airport_transfer',
          units: 1,
          countryCode: 'NG',
          // The quote already names the trip it is for.
          linkedBooking: { id: tripBooking.id, reference: tripBooking.reference },
        },
        price: { total: ngn(25_000) },
      });
      // A tampered link is refused.
      await quote({
        kind: 'addon',
        addonId,
        startDate: inDays(40),
        endDate: inDays(40),
        travellers: { adults: 1, children: 0, infants: 0 },
        linkToken: `${link.body.linkToken as string}x`,
      }).expect(422);

      await book({ quoteId: q.body.quoteId, passengers: [person('Zainab', 'Musa')] })
        .expect(422)
        .expect((response) =>
          expect(response.body.missing).toEqual(['flight_number', 'arrival_time']),
        );
      const created = await book({
        quoteId: q.body.quoteId,
        passengers: [person('Zainab', 'Musa')],
        addonDetails: { flightNumber: 'P4 7121', arrivalTime: `${inDays(40)}T14:30` },
      }).expect(201);
      expect(created.body.booking.addon.linkedBooking).toEqual({
        id: tripBooking.id,
        reference: tripBooking.reference,
      });
      const item = await ctx.prisma.bookingItem.findFirstOrThrow({
        where: { bookingId: created.body.booking.id as string },
      });
      expect(JSON.stringify(item.payload)).not.toContain('P4 7121');

      const confirmed = await payInFull(created.body.booking.id as string, {
        'X-Booking-Token': created.body.accessToken as string,
      });
      expect(confirmed).toMatchObject({
        status: 'CONFIRMED',
        documents: [{ type: 'addon_voucher' }],
      });
      // The trip lists the add-on bought by the same traveller.
      const refreshed = await ctx
        .http()
        .get(`/v1/bookings/${tripBooking.id}`)
        .set(tripToken)
        .expect(200);
      expect(refreshed.body.addons).toEqual([
        expect.objectContaining({ reference: confirmed.reference, type: 'airport_transfer' }),
      ]);
    });

    it('refuses country-specific add-ons for trips elsewhere', async () => {
      const addonId = await addon();
      await quote({
        kind: 'addon',
        addonId,
        startDate: inDays(20),
        endDate: inDays(21),
        travellers: { adults: 1, children: 0, infants: 0 },
        cityId: dubaiId,
      })
        .expect(422)
        .expect((response) => expect(response.body.code).toBe('not_available_there'));
    });
  });

  describe('visa assistance', () => {
    it('books assistance for each applicant and opens their applications on confirmation', async () => {
      const product = await admin()
        .post('visa-products', {
          slug: 'uae-tourist',
          title: 'UAE tourist visa assistance',
          summary: 'We prepare and submit your application.',
          destination: 'AE',
          purposes: ['tourism'],
          processingDaysMin: 3,
          processingDaysMax: 7,
          price: ngn(40_000),
          checklist: [
            { key: 'passport', label: 'Passport', description: 'Bio page', required: true },
            { key: 'photo', label: 'Photo', description: 'Plain background', required: true },
          ],
        })
        .expect(201);
      await admin()
        .patch(`visa-products/${product.body.id as string}`, { status: 'published' })
        .expect(204);

      await quote({
        kind: 'visa',
        productId: product.body.id,
        purpose: 'business',
        nationality: 'NG',
        travelDate: inDays(30),
        travellers: { adults: 1, children: 0, infants: 0 },
      })
        .expect(422)
        .expect((response) => expect(response.body.code).toBe('purpose_not_offered'));
      const q = await quote({
        kind: 'visa',
        productId: product.body.id,
        purpose: 'tourism',
        nationality: 'NG',
        travelDate: inDays(30),
        travellers: { adults: 2, children: 0, infants: 0 },
      }).expect(201);
      expect(q.body).toMatchObject({
        vertical: 'visa',
        visa: { destination: 'AE', purpose: 'tourism', nationality: 'NG', applications: [] },
        price: { total: ngn(80_000) },
        payment: { hold: null, installments: null },
      });

      // Applicants hold the nationality eligibility was checked for, with a passport.
      await book({
        quoteId: q.body.quoteId,
        passengers: [
          person('Halima', 'Sule'),
          person('Musa', 'Sule', { nationality: 'GH', title: 'mr', gender: 'm' }),
        ],
      })
        .expect(422)
        .expect((response) =>
          expect(response.body.issues).toContainEqual(
            expect.objectContaining({ index: 1, code: 'nationality_mismatch' }),
          ),
        );
      await book({
        quoteId: q.body.quoteId,
        passengers: [
          person('Halima', 'Sule', { document: null }),
          person('Musa', 'Sule', { title: 'mr', gender: 'm' }),
        ],
      }).expect(422);
      const created = await book({
        quoteId: q.body.quoteId,
        passengers: [
          person('Halima', 'Sule'),
          person('Musa', 'Sule', { title: 'mr', gender: 'm' }),
        ],
      }).expect(201);
      const confirmed = await payInFull(created.body.booking.id as string, {
        'X-Booking-Token': created.body.accessToken as string,
      });
      expect(confirmed).toMatchObject({
        status: 'CONFIRMED',
        documents: [{ type: 'visa_confirmation' }],
        voucher: null,
        cancellation: null,
      });
      expect(confirmed.visa.applications).toEqual([
        expect.objectContaining({ applicantPosition: 0, status: 'awaiting_documents' }),
        expect.objectContaining({ applicantPosition: 1, status: 'awaiting_documents' }),
      ]);
      const email = ctx.emails.outbox.find((message) => message.template === 'booking-confirmed');
      expect(email?.text).toContain('issuing government');
      // Visa assistance is cancelled through support once confirmed.
      await ctx
        .http()
        .post(`/v1/bookings/${created.body.booking.id as string}/cancel`)
        .set('X-Booking-Token', created.body.accessToken as string)
        .expect(409);
    });
  });
});
