import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';
import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';

import {
  createTestApp,
  E2E_INTERNAL_TOKEN,
  resetState,
  type TestContext,
} from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const INTERNAL = { Authorization: `Bearer ${E2E_INTERNAL_TOKEN}` };

let keySequence = 0;
const idempotencyKey = (): string => `e2e-cancel-${Date.now()}-${(keySequence += 1)}`;

interface Money {
  amountMinor: number;
  currency: string;
}

interface Offer {
  id: string;
  conditions: { refundable: boolean };
}

/** Cancelling ticketed flights online under the airline's refund quote (ADR-064). */
describe('flight cancellation (e2e)', () => {
  let ctx: TestContext;
  let mock: MockFlightSupplier;

  beforeAll(async () => {
    ctx = await createTestApp();
    mock = ctx.app.get(MockFlightSupplier);
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    mock.failNextCancellations = 0;
    mock.cancelledOrders.clear();
  });
  // Refunds run in the background after a cancellation; let them finish before the next reset.
  afterEach(async () => {
    await ctx.background.drain();
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** A guest's ticketed domestic flight, paid in full through the mock provider. */
  async function ticketedFlight(refundable: boolean): Promise<{
    id: string;
    token: Record<string, string>;
    paid: Money;
  }> {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offer = (search.body.offers as Offer[]).find(
      (candidate) => candidate.conditions.refundable === refundable,
    );
    if (!offer) throw new Error(`The mock sells no ${refundable ? '' : 'non-'}refundable fare`);
    const quote = await ctx.http().post(`/v1/flights/offers/${offer.id}/quote`).expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId as string,
        contact: { email: 'ada@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Ada',
            surname: 'Okafor',
            dateOfBirth: '1990-04-01',
            nationality: 'NG',
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    const id = created.body.booking.id as string;
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const payment = await ctx
      .http()
      .post(`/v1/bookings/${id}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set(token)
      .expect(201);
    const reference = (payment.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();
    const booking = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(booking.body).toMatchObject({ status: 'CONFIRMED', flightCancellable: true });
    return { id, token, paid: booking.body.paid as Money };
  }

  const quoteCancellation = (id: string, token: Record<string, string>) =>
    ctx.http().post(`/v1/bookings/${id}/cancellation-quote`).set(token);
  const cancel = (id: string, token: Record<string, string>, refund?: Money) =>
    ctx
      .http()
      .post(`/v1/bookings/${id}/cancel`)
      .set(token)
      .send(refund ? { refund } : {});

  it('cancels a refundable flight with the airline, then refunds the quoted share', async () => {
    const { id, token, paid } = await ticketedFlight(true);
    const quote = await quoteCancellation(id, token).expect(200);
    const { refund, kept } = quote.body as { refund: Money; kept: Money };
    // The fare's refund penalty is kept; the rest of what was paid comes back.
    expect(refund.amountMinor).toBeGreaterThan(0);
    expect(refund.amountMinor).toBeLessThan(paid.amountMinor);
    expect(refund.amountMinor + kept.amountMinor).toBe(paid.amountMinor);
    expect(Date.parse(quote.body.expiresAt as string)).toBeGreaterThan(Date.now());

    // Confirming a refund other than the one quoted asks for a new quote; nothing is cancelled.
    const changed = await cancel(id, token, { ...refund, amountMinor: refund.amountMinor + 1 });
    expect(changed.status).toBe(409);
    expect(changed.body.type).toMatch(/cancellation-quote-expired$/);
    expect(mock.cancelledOrders.size).toBe(0);

    const cancelled = await cancel(id, token, refund).expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'REFUND_PENDING',
      flightCancellable: false,
      refunds: [expect.objectContaining({ amount: refund })],
    });
    expect(mock.cancelledOrders.size).toBe(1);
    const fee = await ctx.prisma.ledgerTransaction.findFirst({
      where: { idempotencyKey: `booking:${id}:cancellation-fee` },
    });
    expect(fee).not.toBeNull();
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { action: 'booking.flight_cancelled', targetId: id },
    });
    expect(audit.metadata).toMatchObject({
      supplier: 'mock',
      refundMinor: String(refund.amountMinor),
      feeMinor: String(kept.amountMinor),
    });

    await ctx.background.drain();
    await ctx.http().post('/v1/internal/bookings/refunds-due').set(INTERNAL).expect(200);
    await ctx.background.drain();
    const refunded = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(refunded.body.status).toBe('REFUNDED');
    // Done once: a second cancellation is refused.
    expect((await cancel(id, token, refund)).status).toBe(409);
  });

  it('cancels a fare that refunds nothing, after the traveller has seen that', async () => {
    const { id, token, paid } = await ticketedFlight(false);
    const quote = await quoteCancellation(id, token).expect(200);
    expect(quote.body).toMatchObject({
      refund: { amountMinor: 0, currency: paid.currency },
      kept: paid,
    });
    const cancelled = await cancel(id, token, quote.body.refund as Money).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', refunds: [] });
    expect(mock.cancelledOrders.size).toBe(1);
  });

  it('needs a live quote, and keeps the booking when the airline cannot confirm', async () => {
    const { id, token } = await ticketedFlight(true);
    const none = await cancel(id, token);
    expect(none.status).toBe(409);
    expect(none.body.type).toMatch(/cancellation-quote-expired$/);

    const quote = await quoteCancellation(id, token).expect(200);
    mock.failNextCancellations = 1;
    expect((await cancel(id, token, quote.body.refund as Money)).status).toBe(503);
    const unchanged = await ctx.http().get(`/v1/bookings/${id}`).set(token).expect(200);
    expect(unchanged.body).toMatchObject({ status: 'CONFIRMED', flightCancellable: true });
    expect(mock.cancelledOrders.size).toBe(0);

    // The quote still stands: trying again cancels.
    const retried = await cancel(id, token, quote.body.refund as Money).expect(200);
    expect(retried.body.status).toBe('REFUND_PENDING');
  });

  it('offers nothing online for a flight that is not ticketed', async () => {
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${(search.body.offers as Offer[])[0]?.id ?? ''}/quote`)
      .expect(201);
    const created = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: quote.body.quoteId as string,
        contact: { email: 'ada@example.com', phone: '+2348012345678' },
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Ada',
            surname: 'Okafor',
            dateOfBirth: '1990-04-01',
            nationality: 'NG',
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
      })
      .expect(201);
    expect(created.body.booking.flightCancellable).toBe(false);
    const token = { 'X-Booking-Token': created.body.accessToken as string };
    const refused = await quoteCancellation(created.body.booking.id as string, token);
    expect(refused.status).toBe(409);
    expect(refused.body.type).toMatch(/not-cancellable$/);
  });
});
