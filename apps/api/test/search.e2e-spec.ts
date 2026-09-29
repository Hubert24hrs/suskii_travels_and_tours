import { addDays, localDate } from '@suskii/shared';

import { PricingService } from '../src/pricing/pricing.service';
import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';
import { SupplierUnavailableError } from '../src/suppliers/supplier.errors';
import { FlightSupplier, type SupplierFlightOffer } from '../src/suppliers/supplier.types';
import { FLIGHT_SUPPLIERS } from '../src/suppliers/suppliers.module';

import { bearer, signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);

const roundTrip = (outbound = 40, back = 50) => ({
  slices: [
    { origin: 'LOS', destination: 'LHR', departureDate: inDays(outbound) },
    { origin: 'LHR', destination: 'LOS', departureDate: inDays(back) },
  ],
  passengers: { adults: 2, children: 1, infants: 0 },
  cabinClass: 'economy',
});

/** Always fails, like a supplier returning 5xx. */
class BrokenSupplier extends FlightSupplier {
  readonly name = 'broken';
  calls = 0;
  search(): Promise<SupplierFlightOffer[]> {
    this.calls += 1;
    return Promise.reject(new SupplierUnavailableError(this.name, 'HTTP 503'));
  }
  reprice(): Promise<SupplierFlightOffer> {
    return Promise.reject(new SupplierUnavailableError(this.name, 'HTTP 503'));
  }
}

/** Never answers and ignores its abort signal: only our timeout can stop it. */
class HangingSupplier extends FlightSupplier {
  readonly name = 'slow';
  search(): Promise<SupplierFlightOffer[]> {
    return new Promise(() => undefined);
  }
  reprice(): Promise<SupplierFlightOffer> {
    return new Promise(() => undefined);
  }
}

describe('search (e2e): mock suppliers end to end', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    ctx.app.get(MockFlightSupplier).repriceDriftBps = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('flights', () => {
    it('searches, prices in the display currency and returns facets', async () => {
      const response = await ctx.http().post('/v1/flights/searches').send(roundTrip()).expect(200);
      const body = response.body;
      expect(body).toMatchObject({
        status: 'complete',
        currency: 'NGN',
        suppliers: [{ supplier: 'mock', status: 'ok' }],
      });
      expect(body.total).toBeGreaterThan(0);
      expect(body.searchId).toMatch(/^fs_/);
      expect(body.request.slices).toHaveLength(2);

      const [offer] = body.offers;
      expect(offer.supplier).toBe('mock');
      expect(offer.slices).toHaveLength(2);
      expect(offer.slices[0].origin).toMatchObject({ code: 'LOS', timeZone: 'Africa/Lagos' });
      expect(offer.price.currency).toBe('NGN');
      // International mock fares are in USD, so the price shows the conversion used.
      expect(offer.price.fx).toMatchObject({ from: 'USD', to: 'NGN', provider: 'mock' });
      const { fare, taxes, fees, total } = offer.price;
      expect(
        fare.amountMinor +
          taxes.amountMinor +
          fees.reduce(
            (acc: number, fee: { amount: { amountMinor: number } }) => acc + fee.amount.amountMinor,
            0,
          ),
      ).toBe(total.amountMinor);
      expect(JSON.stringify(body)).not.toContain('supplierOfferId');
      expect(JSON.stringify(body)).not.toContain('markup');

      expect(body.facets.airlines.length).toBeGreaterThan(0);
      expect(body.facets.stops.map((s: { stops: number }) => s.stops)).toEqual(
        expect.arrayContaining([0]),
      );
      expect(body.facets.price.min.amountMinor).toBeLessThanOrEqual(
        body.facets.price.max.amountMinor,
      );
    });

    it('serves identical searches from cache without calling the supplier again', async () => {
      const mock = ctx.app.get(MockFlightSupplier);
      const spy = jest.spyOn(mock, 'search');
      const first = await ctx
        .http()
        .post('/v1/flights/searches')
        .send(roundTrip(41, 51))
        .expect(200);
      const second = await ctx
        .http()
        .post('/v1/flights/searches?currency=USD')
        .send(roundTrip(41, 51))
        .expect(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(second.body.searchId).toBe(first.body.searchId);
      expect(second.body.offers[0].price.currency).toBe('USD');
      spy.mockRestore();
      await ctx.background.drain();
      const logs = await ctx.prisma.searchLog.findMany({ orderBy: { occurredAt: 'asc' } });
      expect(logs.map((log) => log.cacheHit)).toEqual([false, true]);
      expect(logs[0]).toMatchObject({
        vertical: 'flights',
        origin: 'LOS',
        destination: 'LHR',
        travellers: 3,
        sliceCount: 2,
      });
    });

    it('sorts, filters and pages the stored offers', async () => {
      const { body } = await ctx
        .http()
        .post('/v1/flights/searches')
        .send(roundTrip(42, 52))
        .expect(200);
      const cheapest = await ctx
        .http()
        .get(`/v1/flights/searches/${body.searchId as string}/offers`)
        .query({ sort: 'cheapest', limit: 5 })
        .expect(200);
      const totals = cheapest.body.offers.map(
        (o: { price: { total: { amountMinor: number } } }) => o.price.total.amountMinor,
      );
      expect(totals).toEqual([...totals].sort((a, b) => a - b));
      expect(cheapest.body.nextCursor).not.toBeNull();

      const next = await ctx
        .http()
        .get(`/v1/flights/searches/${body.searchId as string}/offers`)
        .query({ sort: 'cheapest', limit: 5, cursor: cheapest.body.nextCursor })
        .expect(200);
      expect(next.body.offers[0].price.total.amountMinor).toBeGreaterThanOrEqual(
        totals[totals.length - 1],
      );

      const direct = await ctx
        .http()
        .get(`/v1/flights/searches/${body.searchId as string}/offers`)
        .query({ stops: '0', refundable: 'true' })
        .expect(200);
      for (const offer of direct.body.offers) {
        expect(offer.slices.every((slice: { stops: number }) => slice.stops === 0)).toBe(true);
        expect(offer.conditions.refundable).toBe(true);
      }
      const fastest = await ctx
        .http()
        .get(`/v1/flights/searches/${body.searchId as string}/offers`)
        .query({ sort: 'fastest', limit: 3 })
        .expect(200);
      expect(fastest.body.offers).toHaveLength(3);
      await ctx
        .http()
        .get(`/v1/flights/searches/${body.searchId as string}/offers`)
        .query({ stops: '7' })
        .expect(400);
      await ctx.http().get('/v1/flights/searches/fs_0000000000000000/offers').expect(404);
    });

    it('validates airports and origin-local dates', async () => {
      const unknown = await ctx
        .http()
        .post('/v1/flights/searches')
        .send({
          ...roundTrip(),
          slices: [{ origin: 'LOS', destination: 'QQQ', departureDate: inDays(30) }],
        })
        .expect(400);
      expect(unknown.body.errors).toContainEqual(
        expect.objectContaining({ path: 'slices.0.destination', code: 'unknown_airport' }),
      );
      await ctx
        .http()
        .post('/v1/flights/searches')
        .send({
          ...roundTrip(),
          slices: [{ origin: 'LOS', destination: 'LOS', departureDate: inDays(30) }],
        })
        .expect(400);
      await ctx
        .http()
        .post('/v1/flights/searches')
        .send({ ...roundTrip(), passengers: { adults: 1, children: 0, infants: 2 } })
        .expect(400);
      const past = await ctx
        .http()
        .post('/v1/flights/searches')
        .send({
          ...roundTrip(),
          slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(-2) }],
        })
        .expect(400);
      expect(past.body.type).toBe('urn:suskii:problem:validation-failed');
    });

    it('shows an offer and quotes it, persisting a snapshot to book from', async () => {
      const { body } = await ctx
        .http()
        .post('/v1/flights/searches')
        .send(roundTrip(43, 53))
        .expect(200);
      const offerId = body.offers[0].id as string;
      const detail = await ctx.http().get(`/v1/flights/offers/${offerId}`).expect(200);
      expect(detail.body.id).toBe(offerId);
      expect(detail.body.hold).toHaveProperty('available');

      const quote = await ctx.http().post(`/v1/flights/offers/${offerId}/quote`).expect(201);
      expect(quote.body).toMatchObject({ priceChange: null, offer: { id: offerId } });
      const stored = await ctx.prisma.offer.findUniqueOrThrow({
        where: { id: quote.body.quoteId },
      });
      expect(stored).toMatchObject({
        vertical: 'flights',
        supplier: 'mock',
        currency: 'NGN',
        searchId: body.searchId,
      });
      expect(Number(stored.totalMinor)).toBe(quote.body.offer.price.total.amountMinor);
    });

    it('reports a price change on re-pricing so the customer can consent', async () => {
      const { body } = await ctx
        .http()
        .post('/v1/flights/searches')
        .send(roundTrip(44, 54))
        .expect(200);
      ctx.app.get(MockFlightSupplier).repriceDriftBps = 500; // fares rose 5%
      const quote = await ctx
        .http()
        .post(`/v1/flights/offers/${body.offers[0].id as string}/quote`)
        .expect(201);
      const change = quote.body.priceChange;
      expect(change.current.amountMinor).toBeGreaterThan(change.previous.amountMinor);
      expect(change.difference.amountMinor).toBe(
        change.current.amountMinor - change.previous.amountMinor,
      );
    });

    it('answers 410 with the original request once results expire', async () => {
      const { body } = await ctx
        .http()
        .post('/v1/flights/searches')
        .send(roundTrip(45, 55))
        .expect(200);
      await ctx.redis.del(`search:flights:items:${body.searchId as string}`);
      const list = await ctx
        .http()
        .get(`/v1/flights/searches/${body.searchId as string}/offers`)
        .expect(410);
      expect(list.body.type).toBe('urn:suskii:problem:search-expired');
      expect(list.body.request.slices[0]).toMatchObject({ origin: 'LOS', destination: 'LHR' });
      const offer = await ctx
        .http()
        .get(`/v1/flights/offers/${body.offers[0].id as string}`)
        .expect(410);
      expect(offer.body.type).toBe('urn:suskii:problem:offer-unavailable');
      await ctx
        .http()
        .post(`/v1/flights/offers/${body.offers[0].id as string}/quote`)
        .expect(410);
    });

    it('applies markup and fee rules from the database', async () => {
      const search = () =>
        ctx
          .http()
          .post('/v1/flights/searches')
          .query({ currency: 'USD' })
          .send(roundTrip(46, 56))
          .expect(200);
      const before = (await search()).body.offers[0];
      await ctx.prisma.markupRule.create({
        data: {
          name: 'Test 10% LOS',
          vertical: 'flights',
          originCode: 'LOS',
          type: 'percentage',
          value: 1000n,
        },
      });
      await ctx.prisma.feeRule.create({
        data: {
          code: 'service_fee',
          label: 'Service fee',
          vertical: 'flights',
          type: 'fixed',
          value: 1500n,
          currency: 'USD',
          basis: 'per_passenger',
        },
      });
      ctx.app.get(PricingService).invalidate();
      const after = (await search()).body.offers.find((o: { id: string }) => o.id === before.id);
      expect(after.price.fees).toEqual([
        {
          code: 'service_fee',
          label: 'Service fee',
          amount: { amountMinor: 4500, currency: 'USD' },
        },
      ]);
      expect(after.price.fare.amountMinor).toBeGreaterThan(before.price.fare.amountMinor);
      expect(after.price.taxes).toEqual(before.price.taxes);
    });
  });

  describe('hotels', () => {
    const lagosCity = async (): Promise<string> =>
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } })).cityId ?? '';
    const hotelSearch = (cityId: string, extra: Record<string, unknown> = {}) => ({
      destination: { type: 'city', cityId },
      checkIn: inDays(30),
      checkOut: inDays(33),
      rooms: [{ adults: 2, childAges: [7] }],
      ...extra,
    });

    it('answers 400, not 500, for malformed dates', async () => {
      const cityId = await lagosCity();
      const { body } = await ctx
        .http()
        .post('/v1/hotels/searches')
        .send(hotelSearch(cityId, { checkIn: 'soon', checkOut: '2026-13-45' }))
        .expect(400);
      expect(body.errors.map((issue: { path: string }) => issue.path)).toEqual([
        'checkIn',
        'checkOut',
      ]);
    });

    it('searches a city, filters, shows a hotel and quotes a rate', async () => {
      const cityId = await lagosCity();
      const search = await ctx
        .http()
        .post('/v1/hotels/searches')
        .send(hotelSearch(cityId))
        .expect(200);
      expect(search.body).toMatchObject({ status: 'complete', nights: 3, currency: 'NGN' });
      expect(search.body.total).toBeGreaterThanOrEqual(12);
      const [first] = search.body.hotels;
      expect(first.cheapestRate.price.currency).toBe('NGN');
      expect(first.cheapestRate.pricePerNight.amountMinor * 3).toBeCloseTo(
        first.cheapestRate.price.total.amountMinor,
        -1,
      );

      const filtered = await ctx
        .http()
        .get(`/v1/hotels/searches/${search.body.searchId as string}/hotels`)
        .query({ stars: '4,5', freeCancellation: 'true', sort: 'rating' })
        .expect(200);
      for (const hotel of filtered.body.hotels) {
        expect([4, 5]).toContain(hotel.stars);
        expect(hotel.cheapestRate.refundable).toBe(true);
      }

      const detail = await ctx
        .http()
        .get(`/v1/hotels/results/${first.id as string}`)
        .expect(200);
      expect(detail.body.rates.length).toBeGreaterThan(1);
      const quote = await ctx
        .http()
        .post(`/v1/hotels/rates/${detail.body.rates[0].id as string}/quote`)
        .expect(201);
      expect(quote.body).toMatchObject({ nights: 3, priceChange: null, hotel: { id: first.id } });
    });

    it('rejects unknown cities and impossible stays', async () => {
      const unknown = await ctx
        .http()
        .post('/v1/hotels/searches')
        .send(hotelSearch('0192f0e0-0000-7000-8000-000000000999'))
        .expect(400);
      expect(unknown.body.errors[0]).toMatchObject({ code: 'unknown_city' });
      const cityId = await lagosCity();
      await ctx
        .http()
        .post('/v1/hotels/searches')
        .send(hotelSearch(cityId, { checkOut: inDays(30) }))
        .expect(400);
    });
  });

  describe('promo codes', () => {
    it('applies a valid code to a quote and gives one generic error otherwise', async () => {
      const cityId =
        (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } })).cityId ?? '';
      const search = await ctx
        .http()
        .post('/v1/hotels/searches')
        .send({
          destination: { type: 'city', cityId },
          checkIn: inDays(35),
          checkOut: inDays(37),
          rooms: [{ adults: 1 }],
        })
        .expect(200);
      const detail = await ctx
        .http()
        .get(`/v1/hotels/results/${search.body.hotels[0].id as string}`)
        .expect(200);
      const quote = await ctx
        .http()
        .post(`/v1/hotels/rates/${detail.body.rates[0].id as string}/quote`)
        .expect(201);
      await ctx.prisma.promoCode.createMany({
        data: [
          { code: 'WELCOME10', type: 'percentage', value: 1000n, verticals: ['hotels'] },
          { code: 'FLIGHTSONLY', type: 'percentage', value: 1000n, verticals: ['flights'] },
          {
            code: 'MEMBERS',
            type: 'fixed',
            value: 500_000n,
            currency: 'NGN',
            requiresAccount: true,
          },
        ],
      });

      const valid = await ctx
        .http()
        .post('/v1/pricing/promos/validate')
        .send({ code: 'welcome10', quoteId: quote.body.quoteId })
        .expect(200);
      expect(valid.body.code).toBe('WELCOME10');
      expect(valid.body.price.total.amountMinor).toBe(
        quote.body.rate.price.total.amountMinor - valid.body.discount.amountMinor,
      );

      const reasons = await Promise.all(
        ['NOSUCHCODE', 'FLIGHTSONLY', 'MEMBERS'].map((code) =>
          ctx
            .http()
            .post('/v1/pricing/promos/validate')
            .send({ code, quoteId: quote.body.quoteId }),
        ),
      );
      for (const response of reasons) {
        expect(response.status).toBe(422);
        expect(response.body.type).toBe('urn:suskii:problem:promo-invalid');
      }
      // Signed-in customers get account-only codes.
      const session = await signUp(ctx, 'promo@example.com');
      await ctx
        .http()
        .post('/v1/pricing/promos/validate')
        .set(bearer(session.accessToken))
        .send({ code: 'MEMBERS', quoteId: quote.body.quoteId })
        .expect(200);
      await ctx
        .http()
        .post('/v1/pricing/promos/validate')
        .send({ code: 'WELCOME10', quoteId: '0192f0e0-0000-7000-8000-000000000001' })
        .expect(404);
    });
  });
});

describe('search (e2e): supplier failures', () => {
  let ctx: TestContext;
  const broken = new BrokenSupplier();

  beforeAll(async () => {
    ctx = await createTestApp(
      { SUPPLIER_TIMEOUT_MS: 400, SEARCH_TIMEOUT_MS: 1500 },
      {
        overrides: [
          {
            provide: FLIGHT_SUPPLIERS,
            useFactory: (mock: MockFlightSupplier) => [mock, broken, new HangingSupplier()],
            inject: [MockFlightSupplier],
          },
        ],
      },
    );
  });
  beforeEach(async () => {
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('returns partial results quickly when suppliers fail or hang, and caches them only briefly', async () => {
    const started = Date.now();
    const response = await ctx
      .http()
      .post('/v1/flights/searches')
      .send(roundTrip(60, 70))
      .expect(200);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(response.body.status).toBe('partial');
    const outcomes = Object.fromEntries(
      response.body.suppliers.map((s: { supplier: string; status: string }) => [
        s.supplier,
        s.status,
      ]),
    );
    expect(outcomes).toEqual({ mock: 'ok', broken: 'error', slow: 'timeout' });
    expect(response.body.total).toBeGreaterThan(0);
    const keys = await ctx.redis.keys('search:flights:q:*');
    const ttl = await ctx.redis.ttl(keys[0] ?? '');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('opens the circuit for a failing supplier and stops calling it', async () => {
    broken.calls = 0;
    const statuses: string[] = [];
    // Different dates, so every search reaches the suppliers instead of the cache.
    for (let day = 0; day < 7; day += 1) {
      const response = await ctx
        .http()
        .post('/v1/flights/searches')
        .send(roundTrip(80 + day, 95 + day))
        .expect(200);
      statuses.push(
        response.body.suppliers.find((s: { supplier: string }) => s.supplier === 'broken')
          .status as string,
      );
    }
    expect(statuses.slice(-2)).toEqual(['circuit_open', 'circuit_open']);
    expect(broken.calls).toBeLessThan(7);
  });
});

describe('search (e2e): every supplier down', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp(
      { SUPPLIER_TIMEOUT_MS: 300, SEARCH_TIMEOUT_MS: 1000 },
      {
        overrides: [
          { provide: FLIGHT_SUPPLIERS, useValue: [new BrokenSupplier(), new HangingSupplier()] },
        ],
      },
    );
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('answers 503 with Retry-After instead of an empty result', async () => {
    await resetState(ctx);
    const response = await ctx
      .http()
      .post('/v1/flights/searches')
      .send(roundTrip(61, 71))
      .expect(503);
    expect(response.body.type).toBe('urn:suskii:problem:search-unavailable');
    expect(response.headers['retry-after']).toBe('30');
    expect(await ctx.redis.keys('search:flights:q:*')).toEqual([]);
  });
});
