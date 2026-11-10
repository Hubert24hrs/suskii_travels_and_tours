import { describe, expect, it } from 'vitest';

import {
  tripComponentOf,
  tripPartState,
  tripSearchQuery,
  tripState,
  tripTitle,
  type TripPlan,
} from './trips';
import { TRIP_PLAN_ISSUES, tripPlanSchema } from './trips-schemas';

const PLAN = {
  origin: {
    code: 'LOS',
    name: 'Murtala Muhammed International Airport',
    cityName: 'Lagos',
    countryCode: 'NG',
  },
  destination: {
    code: 'LHR',
    name: 'Heathrow Airport',
    cityName: 'London',
    countryCode: 'GB',
    cityId: '0193a5b0-0000-7000-8000-000000000001',
  },
  departDate: '2027-03-10',
  returnDate: '2027-03-17',
  adults: 2,
  children: 0,
  components: ['flight', 'hotel', 'car', 'transfer', 'insurance'],
};

describe('trips (ADR-099)', () => {
  it('names the part of a trip a booking is, and refuses what a trip does not take', () => {
    expect(tripComponentOf({ kind: 'flight' })).toBe('flight');
    expect(tripComponentOf({ kind: 'hotel' })).toBe('hotel');
    expect(tripComponentOf({ kind: 'rental' })).toBe('car');
    expect(tripComponentOf({ kind: 'addon', addonType: 'airport_transfer' })).toBe('transfer');
    expect(tripComponentOf({ kind: 'addon', addonType: 'insurance' })).toBe('insurance');
    for (const item of [
      { kind: 'addon', addonType: 'esim' },
      { kind: 'addon' },
      { kind: 'tour' },
      { kind: 'visa' },
      { kind: 'bus' },
      { kind: 'ride' },
      { kind: 'membership' },
      { kind: 'package' },
    ]) {
      expect(tripComponentOf(item)).toBeNull();
    }
  });

  it('reads a trip as open, being paid, paid or closed from its parts', () => {
    expect(tripState([])).toBe('empty');
    expect(tripPartState('PRICED')).toBe('to_pay');
    expect(tripPartState('AWAITING_PAYMENT')).toBe('paying');
    expect(tripPartState('TICKETING')).toBe('paid');
    expect(tripPartState('CONFIRMED')).toBe('confirmed');
    for (const status of ['CANCELLED', 'EXPIRED', 'FAILED', 'REFUNDED', 'REFUND_PENDING']) {
      expect(tripPartState(status)).toBe('closed');
    }
    expect(tripState(['to_pay', 'to_pay'])).toBe('open');
    expect(tripState(['paying', 'to_pay'])).toBe('awaiting_payment');
    expect(tripState(['paid', 'confirmed'])).toBe('paid');
    // A part that fell away does not hold the rest back, and a trip of only such parts is closed.
    expect(tripState(['confirmed', 'closed'])).toBe('paid');
    expect(tripState(['closed', 'to_pay'])).toBe('open');
    expect(tripState(['closed', 'closed'])).toBe('closed');
    // One part paid and another still to pay: the trip is still open.
    expect(tripState(['confirmed', 'to_pay'])).toBe('open');
  });

  it('names a trip after its cities, or its airports when a city is unknown', () => {
    expect(tripTitle(PLAN)).toEqual({ from: 'Lagos', to: 'London' });
    expect(tripTitle({ ...PLAN, destination: { ...PLAN.destination, cityName: null } })).toEqual({
      from: 'Lagos',
      to: 'Heathrow Airport',
    });
  });

  it('accepts a plan with every part, and one with a single part', () => {
    expect(tripPlanSchema.parse(PLAN)).toEqual(PLAN);
    expect(tripPlanSchema.parse({ ...PLAN, components: ['hotel'] }).components).toEqual(['hotel']);
    // Children default to none; airport codes are upper-cased.
    const { children: _children, ...rest } = PLAN;
    expect(
      tripPlanSchema.parse({ ...rest, origin: { ...PLAN.origin, code: 'los' } }),
    ).toMatchObject({ children: 0, origin: { code: 'LOS' } });
  });

  it('refuses the same place twice, a return before the day out, a stay too long and a part twice', () => {
    const issues = (input: unknown): string[] => {
      const result = tripPlanSchema.safeParse(input);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(issues({ ...PLAN, destination: { ...PLAN.destination, code: 'LOS' } })).toEqual([
      TRIP_PLAN_ISSUES.samePlace,
    ]);
    expect(issues({ ...PLAN, returnDate: PLAN.departDate })).toEqual([
      TRIP_PLAN_ISSUES.returnBeforeDeparture,
    ]);
    expect(issues({ ...PLAN, returnDate: '2027-04-20' })).toEqual([TRIP_PLAN_ISSUES.tooLong]);
    expect(issues({ ...PLAN, components: ['flight', 'flight'] })).toEqual([
      TRIP_PLAN_ISSUES.duplicateComponent,
    ]);
    expect(issues({ ...PLAN, components: [] })).toHaveLength(1);
    expect(issues({ ...PLAN, adults: 0 })).toHaveLength(1);
    expect(issues({ ...PLAN, components: ['cruise'] })).toHaveLength(1);
  });
  it('prefills the ordinary search of each part from the plan', () => {
    const plan = { ...PLAN, adults: 3, children: 1 } as TripPlan;
    expect(tripSearchQuery(plan, 'flight')).toBe(
      'trip=round_trip&from=LOS&to=LHR&depart=2027-03-10&return=2027-03-17&adults=3&children=1',
    );
    // Two adults to a room; children's ages are asked on the hotel search itself.
    expect(tripSearchQuery(plan, 'hotel')).toBe(
      'dest=0193a5b0-0000-7000-8000-000000000001&checkin=2027-03-10&checkout=2027-03-17&room=2&room=1',
    );
    expect(tripSearchQuery(plan, 'car')).toBe(
      'city=London&pickupAt=2027-03-10T10%3A00&returnAt=2027-03-17T10%3A00',
    );
    expect(tripSearchQuery(plan, 'transfer')).toBe(
      'type=airport_transfer&dest=0193a5b0-0000-7000-8000-000000000001&start=2027-03-10&end=2027-03-17&adults=3&children=1',
    );
    expect(tripSearchQuery({ ...plan, children: 0 }, 'insurance')).toBe(
      'type=insurance&dest=0193a5b0-0000-7000-8000-000000000001&start=2027-03-10&end=2027-03-17&adults=3',
    );
    // Without a catalog city the traveller starts from the search form.
    const noCity = { ...plan, destination: { ...plan.destination, cityId: null, cityName: null } };
    expect(tripSearchQuery(noCity, 'hotel')).toBeNull();
    expect(tripSearchQuery(noCity, 'insurance')).toBeNull();
    expect(tripSearchQuery(noCity, 'car')).toBe(
      'city=Heathrow%20Airport&pickupAt=2027-03-10T10%3A00&returnAt=2027-03-17T10%3A00',
    );
  });
});
