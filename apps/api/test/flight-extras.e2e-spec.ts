import { addDays, BOOKING_TERMS_VERSION, localDate } from '@suskii/shared';

import { MockFlightSupplier } from '../src/suppliers/mock/mock-flight-supplier';

import { staffSession } from './helpers/admin';
import { bearer, E2E_TURNSTILE, signUp } from './helpers/flows';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * Flights, feature parity part 1 (docs/phases/feature-parity.md): a price for each day around a
 * search ("Flexible dates"), airports near an airport, a meal request where the fare takes one,
 * and group requests as support conversations.
 */

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);
const one = { adults: 1, children: 0, infants: 0 };
let keySequence = 0;
const idempotencyKey = (): string => `e2e-flight-extras-${Date.now()}-${(keySequence += 1)}`;

interface DatePrices {
  currency: string;
  days: {
    offset: number;
    departureDate: string;
    returnDate: string | null;
    status: string;
    total: { amountMinor: number; currency: string } | null;
  }[];
  cheapestOffset: number | null;
}

describe('flights: flexible dates, nearby airports, meals and groups (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // The after-hours assistant is on and nobody is on shift: group requests must still be left
    // to people (ADR-093).
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      SUPPORT_ASSISTANT_ENABLED: true,
      SUPPORT_HOURS: '',
    });
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('a price for each day around a search', () => {
    const datePrices = (body: Record<string, unknown>, currency = 'NGN') =>
      ctx.http().post('/v1/flights/date-prices').query({ currency }).send(body);

    it('prices three days each side of a one-way search and names the cheapest', async () => {
      const body = {
        slices: [{ origin: 'LOS', destination: 'LHR', departureDate: inDays(40) }],
        passengers: one,
        cabinClass: 'economy',
      };
      const search = await ctx.http().post('/v1/flights/searches').send(body).expect(200);
      const calls = jest.spyOn(ctx.app.get(MockFlightSupplier), 'search');
      const { body: prices } = (await datePrices(body).expect(200)) as { body: DatePrices };

      expect(prices.days.map((day) => day.offset)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
      expect(prices.days.map((day) => day.departureDate)).toEqual(
        [37, 38, 39, 40, 41, 42, 43].map(inDays),
      );
      expect(prices.days.every((day) => day.returnDate === null)).toBe(true);
      expect(prices.days.every((day) => day.status === 'priced' && day.total)).toBe(true);
      // The chosen day costs what the search's cheapest offer costs: one pricing path.
      const cheapest = await ctx
        .http()
        .get(`/v1/flights/searches/${search.body.searchId as string}/offers`)
        .query({ sort: 'cheapest', limit: 1 })
        .expect(200);
      expect(prices.days[3]?.total).toEqual(cheapest.body.offers[0].price.total);
      // The chosen day came from the cache; the six others were searched once each.
      expect(calls).toHaveBeenCalledTimes(6);
      const lowest = Math.min(...prices.days.map((day) => day.total?.amountMinor ?? Infinity));
      const first = prices.days.find((day) => day.total?.amountMinor === lowest);
      expect(prices.cheapestOffset).toBe(first?.offset);

      // Asking again costs the suppliers nothing while the searches are cached.
      await datePrices(body).expect(200);
      expect(calls).toHaveBeenCalledTimes(6);
      calls.mockRestore();
    });

    it('moves both dates of a return trip together and leaves out days already gone', async () => {
      const { body: prices } = (await datePrices({
        slices: [
          { origin: 'LOS', destination: 'ABV', departureDate: inDays(2) },
          { origin: 'ABV', destination: 'LOS', departureDate: inDays(9) },
        ],
        passengers: one,
        cabinClass: 'economy',
      }).expect(200)) as { body: DatePrices };

      expect(prices.days.length).toBeGreaterThanOrEqual(5);
      expect(prices.days.length).toBeLessThan(7);
      for (const day of prices.days) {
        expect(day.departureDate >= today).toBe(true);
        expect(day.returnDate).toBe(addDays(day.departureDate, 7));
      }
    });

    it('answers no days for a multi-city trip, and when the setting turns them off', async () => {
      const multi = await datePrices({
        slices: [
          { origin: 'LOS', destination: 'LHR', departureDate: inDays(40) },
          { origin: 'LHR', destination: 'CDG', departureDate: inDays(45) },
          { origin: 'CDG', destination: 'LOS', departureDate: inDays(50) },
        ],
        passengers: one,
        cabinClass: 'economy',
      }).expect(200);
      expect(multi.body).toMatchObject({ days: [], cheapestOffset: null });

      const off = await createTestApp({ RATE_LIMIT_ENABLED: false, FLEXIBLE_DATES_DAYS: 0 });
      try {
        const none = await off
          .http()
          .post('/v1/flights/date-prices')
          .send({
            slices: [{ origin: 'LOS', destination: 'LHR', departureDate: inDays(40) }],
            passengers: one,
            cabinClass: 'economy',
          })
          .expect(200);
        expect(none.body).toMatchObject({ days: [], cheapestOffset: null });
      } finally {
        await off.close();
      }
    });

    it('refuses an unknown airport like a search does', async () => {
      const refused = await datePrices({
        slices: [{ origin: 'LOS', destination: 'ZZZ', departureDate: inDays(40) }],
        passengers: one,
        cabinClass: 'economy',
      }).expect(400);
      expect(refused.body.type).toBe('urn:suskii:problem:validation-failed');
    });
  });

  describe('airports near an airport', () => {
    it("lists London's other airports nearest first, without small airfields", async () => {
      const { body } = await ctx.http().get('/v1/catalog/airports/lhr/nearby').expect(200);
      expect(body).toMatchObject({ airport: 'LHR', radiusKm: 150 });
      const codes = (body.items as { code: string }[]).map((item) => item.code);
      expect(codes).not.toContain('LHR');
      expect(codes).toEqual(expect.arrayContaining(['LGW', 'LCY']));
      const distances = (body.items as { distanceKm: number }[]).map((item) => item.distanceKm);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
      expect(distances.every((km) => km > 0 && km <= 150)).toBe(true);
      expect(body.items.length).toBeLessThanOrEqual(4);

      const close = await ctx
        .http()
        .get('/v1/catalog/airports/LHR/nearby')
        .query({ radiusKm: 20, limit: 8 })
        .expect(200);
      expect(close.body.items.every((item: { distanceKm: number }) => item.distanceKm <= 20)).toBe(
        true,
      );
    });

    it('answers 404 for an airport we do not know', async () => {
      await ctx.http().get('/v1/catalog/airports/ZZZ/nearby').expect(404);
    });
  });

  describe('meal requests', () => {
    const contact = { email: 'chioma@example.com', phone: '+2348012345678' };
    const adult = (extra: Record<string, unknown> = {}) => ({
      type: 'adult',
      title: 'ms',
      gender: 'f',
      givenNames: 'Chioma',
      surname: 'Okafor',
      dateOfBirth: '1990-04-01',
      nationality: 'NG',
      ...extra,
    });
    const passport = { number: 'B1234567', issuingCountry: 'NG', expiryDate: inDays(3650) };

    async function quote(origin: string, destination: string) {
      const search = await ctx
        .http()
        .post('/v1/flights/searches')
        .send({
          slices: [{ origin, destination, departureDate: inDays(30) }],
          passengers: one,
          cabinClass: 'economy',
        })
        .expect(200);
      const quoted = await ctx
        .http()
        .post(`/v1/flights/offers/${search.body.offers[0].id as string}/quote`)
        .expect(201);
      return quoted.body as { quoteId: string; offer: { mealRequests: boolean } };
    }
    const book = (quoteId: string, passengers: unknown[]) =>
      ctx.http().post('/v1/bookings').set('Idempotency-Key', idempotencyKey()).send({
        quoteId,
        passengers,
        contact,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: E2E_TURNSTILE,
      });

    it('keeps the request on a fare that takes one and hands it to the airline', async () => {
      const international = await quote('LOS', 'LHR');
      expect(international.offer.mealRequests).toBe(true);
      const created = await book(international.quoteId, [
        adult({ document: passport, meal: 'halal' }),
      ]).expect(201);
      expect(created.body.booking.passengers[0]).toMatchObject({
        surname: 'OKAFOR',
        meal: 'halal',
      });

      const stored = await ctx.prisma.bookingPassenger.findFirstOrThrow({
        where: { bookingId: created.body.booking.id as string },
      });
      expect(stored.mealRequest).toBe('halal');
    });

    it('refuses a request the fare cannot pass on, and one for the wrong traveller', async () => {
      const domestic = await quote('LOS', 'ABV');
      expect(domestic.offer.mealRequests).toBe(false);
      const refused = await book(domestic.quoteId, [adult({ meal: 'vegetarian' })]).expect(422);
      expect(refused.body.type).toBe('urn:suskii:problem:passengers-invalid');
      expect(refused.body.issues).toEqual([{ index: 0, path: ['meal'], code: 'meal_unavailable' }]);
      // Without a request the same fare books as before.
      await book(domestic.quoteId, [adult()]).expect(201);

      const international = await quote('LOS', 'LHR');
      await book(international.quoteId, [adult({ document: passport, meal: 'child' })]).expect(400);
    });
  });

  describe('group requests', () => {
    const request = (extra: Record<string, unknown> = {}) => ({
      tripType: 'round_trip',
      origin: 'los',
      destination: 'LHR',
      departureDate: inDays(60),
      returnDate: inDays(67),
      travellers: 25,
      cabinClass: 'economy',
      organisation: 'Acme Choir',
      notes: 'We can leave a day earlier.',
      ...extra,
    });
    const send = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
      ctx.http().post('/v1/flights/group-requests').set(headers).send(body);

    it('starts a support conversation the team finds under group bookings', async () => {
      const session = await signUp(ctx, 'organiser@example.com');
      const started = await send(request(), bearer(session.accessToken)).expect(201);
      expect(started.body.accessToken).toBeNull();
      expect(started.body.conversation).toMatchObject({
        category: 'pre_booking',
        topic: 'group_booking',
        status: 'open',
        booking: null,
      });
      expect(started.body.conversation.messages).toHaveLength(1);
      expect(started.body.conversation.messages[0].text).toBe(
        [
          'Group booking request',
          'Route: Lagos (LOS) to London (LHR)',
          'Trip: Return',
          `Departure: ${inDays(60)}`,
          `Return: ${inDays(67)}`,
          'Travellers: 25',
          'Cabin: Economy',
          'Organisation: Acme Choir',
          'Notes: We can leave a day earlier.',
        ].join('\n'),
      );

      // An ordinary question is not a group request; the inbox filter tells them apart.
      const ordinary = await ctx
        .http()
        .post('/v1/support/conversations')
        .set(bearer(session.accessToken))
        .send({ category: 'general', message: 'Do you sell travel insurance?' })
        .expect(201);

      // Group fares come from an airline's group desk, so a person answers: the after-hours
      // assistant writes in the ordinary conversation and stays out of the request.
      await ctx.background.drain();
      const authors = async (id: string): Promise<string[]> => {
        const view = await ctx
          .http()
          .get(`/v1/support/conversations/${id}`)
          .set(bearer(session.accessToken))
          .expect(200);
        return (view.body.messages as { author: string }[]).map((message) => message.author);
      };
      expect(await authors(started.body.conversation.id)).toEqual(['customer']);
      expect(await authors(ordinary.body.conversation.id)).toEqual(['customer', 'assistant']);
      const agent = await staffSession(ctx, 'agent@suskii.test', ['support']);
      const inbox = await ctx
        .http()
        .get('/v1/admin/support/conversations')
        .query({ topic: 'group_booking' })
        .set(bearer(agent.accessToken))
        .expect(200);
      expect(inbox.body.items).toHaveLength(1);
      expect(inbox.body.items[0]).toMatchObject({
        id: started.body.conversation.id,
        topic: 'group_booking',
      });
      const all = await ctx
        .http()
        .get('/v1/admin/support/conversations')
        .set(bearer(agent.accessToken))
        .expect(200);
      expect(all.body.items).toHaveLength(2);
    });

    it('takes a guest with an email and a bot check, one way without a return', async () => {
      const guest = await send(
        request({
          tripType: 'one_way',
          returnDate: null,
          travellers: 10,
          organisation: '',
          notes: null,
          email: 'guest@example.com',
          turnstileToken: E2E_TURNSTILE,
        }),
      ).expect(201);
      expect(guest.body.accessToken).toEqual(expect.any(String));
      const text = guest.body.conversation.messages[0].text as string;
      expect(text).toContain('Trip: One way');
      expect(text).not.toContain('Return:');
      expect(text).not.toContain('Organisation:');
      expect(text).not.toContain('Notes:');

      await send(request({ email: 'guest@example.com' })).expect(400);
    });

    it('refuses fewer than ten travellers, unknown airports and impossible dates', async () => {
      const session = await signUp(ctx, 'organiser@example.com');
      const auth = bearer(session.accessToken);
      await send(request({ travellers: 9 }), auth).expect(400);
      await send(request({ destination: 'LOS' }), auth).expect(400);
      await send(request({ returnDate: inDays(59) }), auth).expect(400);
      await send(request({ tripType: 'one_way' }), auth).expect(400);
      const unknown = await send(request({ destination: 'ZZZ' }), auth).expect(400);
      expect(unknown.body.errors).toEqual([
        expect.objectContaining({ path: 'destination', code: 'unknown_airport' }),
      ]);
      const past = await send(
        request({ departureDate: inDays(-1), returnDate: inDays(3) }),
        auth,
      ).expect(400);
      expect(past.body.errors).toEqual([
        expect.objectContaining({ path: 'departureDate', code: 'date_in_past' }),
      ]);
      expect(await ctx.prisma.supportConversation.count()).toBe(0);
    });
  });
});
