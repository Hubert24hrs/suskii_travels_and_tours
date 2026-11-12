import { metrics } from '@opentelemetry/api';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import {
  bookingsCreated,
  bookingTransitions,
  paymentWebhooks,
  payments,
  quotes,
  ticketingAttempts,
} from '../src/telemetry/metrics';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/** Collects on demand, like the periodic exporter does once a minute. */
class TestReader extends MetricReader {
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const inDays = (days: number): string => addDays(localDate(new Date(), 'Africa/Lagos'), days);
let keys = 0;
const idempotencyKey = (): string => `e2e-metrics-${Date.now()}-${(keys += 1)}`;

/**
 * ADR-047: a guest booking from quote to ticket moves the funnel and payment counters, and the
 * operational gauges read the database when the exporter collects.
 */
describe('business metrics (e2e)', () => {
  let ctx: TestContext;
  const reader = new TestReader();

  beforeAll(async () => {
    // Before the app starts, so its gauges register with a real provider.
    metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
    ctx = await createTestApp({ RATE_LIMIT_ENABLED: false });
    await resetState(ctx);
  });
  afterAll(async () => {
    await resetState(ctx);
    await ctx.close();
    metrics.disable();
  });

  async function gauges(): Promise<Map<string, DataPoint<number>[]>> {
    const { resourceMetrics } = await reader.collect();
    const found = new Map<string, DataPoint<number>[]>();
    for (const scope of resourceMetrics.scopeMetrics)
      for (const metric of scope.metrics)
        found.set(metric.descriptor.name, metric.dataPoints as DataPoint<number>[]);
    return found;
  }

  it('counts the funnel from quote to ticket and the payment it took', async () => {
    const spies = [
      quotes,
      bookingsCreated,
      bookingTransitions,
      paymentWebhooks,
      payments,
      ticketingAttempts,
    ].map((counter) => jest.spyOn(counter, 'add'));
    const [quote, created, transitions, webhooks, paid, ticketing] = spies;

    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(30) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offer = await ctx
      .http()
      .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
      .expect(201);
    const booking = await ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', idempotencyKey())
      .send({
        quoteId: offer.body.quoteId,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        contact: { email: 'metrics@example.com', phone: '+2348012345678' },
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
      })
      .expect(201);
    const session = await ctx
      .http()
      .post(`/v1/bookings/${booking.body.booking.id as string}/payments`)
      .set('Idempotency-Key', idempotencyKey())
      .set('X-Booking-Token', booking.body.accessToken as string)
      .send({})
      .expect(201);
    const reference = (session.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();

    expect(quote).toHaveBeenCalledWith(1, { vertical: 'flights' });
    expect(created).toHaveBeenCalledWith(1, { vertical: 'flights', channel: 'web' });
    expect(transitions).toHaveBeenCalledWith(1, { event: 'price', to: 'PRICED' });
    expect(webhooks).toHaveBeenCalledWith(1, { provider: 'mock', result: 'processed' });
    expect(paid).toHaveBeenCalledWith(1, { provider: 'mock', outcome: 'paid' });
    expect(ticketing).toHaveBeenCalledWith(1, { outcome: 'confirmed' });
    for (const spy of spies) spy.mockRestore();
  });

  it('reads the operational gauges from the database when the exporter collects', async () => {
    const found = await gauges();
    const inFlight = found.get('suskii.bookings.in_flight') ?? [];
    expect(inFlight.map((point) => point.attributes.status).sort()).toEqual([
      'AWAITING_PAYMENT',
      'HELD',
      'PAID',
      'PARTIALLY_PAID',
      'REFUND_PENDING',
      'TICKETING',
    ]);
    expect(found.get('suskii.ticketing.oldest_age')?.[0]?.value).toBe(0);
    expect(found.get('suskii.refunds.open')).toHaveLength(4);
    expect(found.get('suskii.payment_risk_reviews.open')?.[0]?.value).toBe(0);
    const connections = found.get('suskii.db.connections') ?? [];
    expect(connections.find((point) => point.attributes.state === 'max')?.value).toBeGreaterThan(0);
    expect(connections.some((point) => point.attributes.state === 'active')).toBe(true);
  });
});
