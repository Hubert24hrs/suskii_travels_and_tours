import { addDays, localDate, money, percentageOf } from '@suskii/shared';

import { stableDefaultMarkupId } from '../src/catalog/reference-ids';
import { seedDefaultMarkups } from '../src/pricing/default-markups';
import { PricingService } from '../src/pricing/pricing.service';

import { createTestApp, resetState, type TestContext } from './helpers/test-app';

const today = localDate(new Date(), 'Africa/Lagos');
const inDays = (days: number): string => addDays(today, days);

interface Wire {
  amountMinor: number;
  currency: string;
}
interface Price {
  fare: Wire;
  taxes: Wire;
  total: Wire;
}

/** What a percentage of a wire amount comes to, rounded half up as the engine rounds. */
const percent = (amount: Wire, bps: number): number =>
  Number(percentageOf(money(BigInt(amount.amountMinor), amount.currency), bps, 'half-up').minor);

/**
 * The owner's default markups (ADR-124) as the seed creates them, on prices travellers see. The
 * other suites start with no markup rule (`resetState` empties them), so their figures stay the
 * suppliers' own; this one seeds the defaults the way every release does.
 */
describe('default markups (e2e, ADR-124)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** A domestic flight, priced in naira as the mock supplier prices it: no conversion. */
  const flightPrice = async (): Promise<{ id: string; price: Price }> => {
    const { body } = await ctx
      .http()
      .post('/v1/flights/searches')
      .query({ currency: 'NGN' })
      .send({
        slices: [{ origin: 'LOS', destination: 'ABV', departureDate: inDays(35) }],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offer = (body as { offers: { id: string; price: Price }[] }).offers[0];
    if (!offer) throw new Error('the mock supplier should offer a flight');
    return offer;
  };

  /** A stay in Lagos, priced in naira. */
  const hotelPrice = async (): Promise<{ id: string; price: Price }> => {
    const airport = await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'LOS' } });
    const { body } = await ctx
      .http()
      .post('/v1/hotels/searches')
      .send({
        destination: { type: 'city', cityId: airport.cityId ?? '' },
        checkIn: inDays(30),
        checkOut: inDays(32),
        rooms: [{ adults: 2, childAges: [] }],
      })
      .expect(200);
    const hotel = (body as { hotels: { id: string; cheapestRate: { price: Price } }[] }).hotels[0];
    if (!hotel) throw new Error('the mock supplier should offer a hotel');
    return { id: hotel.id, price: hotel.cheapestRate.price };
  };

  it('adds 2% to a flight fare and 10% to a stay, before taxes, once seeded', async () => {
    const flightBefore = await flightPrice();
    const hotelBefore = await hotelPrice();
    expect(flightBefore.price.fare.currency).toBe('NGN');

    expect(await seedDefaultMarkups(ctx.prisma)).toBe(10);
    ctx.app.get(PricingService).invalidate();

    // The same searches again (the suppliers' answers are cached; only the pricing changed).
    const flightAfter = await flightPrice();
    expect(flightAfter.id).toBe(flightBefore.id);
    expect(flightAfter.price.fare.amountMinor).toBe(
      flightBefore.price.fare.amountMinor + percent(flightBefore.price.fare, 200),
    );
    expect(flightAfter.price.taxes).toEqual(flightBefore.price.taxes);

    const hotelAfter = await hotelPrice();
    expect(hotelAfter.id).toBe(hotelBefore.id);
    expect(hotelAfter.price.fare.amountMinor).toBe(
      hotelBefore.price.fare.amountMinor + percent(hotelBefore.price.fare, 1_000),
    );
    expect(hotelAfter.price.taxes).toEqual(hotelBefore.price.taxes);
  });

  it('keeps what staff set on a default across releases', async () => {
    const before = await flightPrice();
    await seedDefaultMarkups(ctx.prisma);
    const id = stableDefaultMarkupId('flights');
    await ctx.prisma.markupRule.update({ where: { id }, data: { active: false } });

    // The next release seeds again and creates nothing: the switched-off default stays off.
    expect(await seedDefaultMarkups(ctx.prisma)).toBe(0);
    expect(await ctx.prisma.markupRule.findUniqueOrThrow({ where: { id } })).toMatchObject({
      active: false,
    });
    expect(await ctx.prisma.markupRule.count({ where: { vertical: 'flights' } })).toBe(1);
    ctx.app.get(PricingService).invalidate();
    expect((await flightPrice()).price.fare).toEqual(before.price.fare);
  });

  it('gives way to a rule staff add for a route', async () => {
    const before = await flightPrice();
    await seedDefaultMarkups(ctx.prisma);
    await ctx.prisma.markupRule.create({
      data: {
        name: 'Lagos departures',
        vertical: 'flights',
        originCode: 'LOS',
        type: 'percentage',
        value: 500n,
      },
    });
    ctx.app.get(PricingService).invalidate();
    const after = await flightPrice();
    expect(after.price.fare.amountMinor).toBe(
      before.price.fare.amountMinor + percent(before.price.fare, 500),
    );
  });
});
