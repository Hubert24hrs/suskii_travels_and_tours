import type { AgentGrant } from '../agent-grants';

import { AgentOptions } from './agent-options';
import {
  addonDays,
  rentalWindow,
  roomsFor,
  shiftWallTime,
  tripFlowFacts,
  type TripFlowFacts,
} from './trip-flow';

const facts = (over: Partial<TripFlowFacts> = {}): TripFlowFacts => ({
  cityId: 'city-london',
  cityName: 'London',
  countryCode: 'GB',
  airport: 'LHR',
  departDate: '2026-12-10',
  arriveAt: '2026-12-10T14:35',
  leaveAt: '2026-12-17T21:50',
  adults: 2,
  children: 0,
  infants: 0,
  ...over,
});

interface SliceIn {
  from: string;
  to: string;
  leaves: string;
  lands: string;
}

/** A quote as far as the trip reads it: its slices and its travellers. */
const quote = (slices: SliceIn[], passengers = { adults: 2, children: 0, infants: 0 }) =>
  ({
    offer: {
      passengers,
      slices: slices.map((slice) => ({
        origin: { code: slice.from, cityName: 'Lagos', countryCode: 'NG' },
        destination: { code: slice.to, cityName: 'London', countryCode: 'GB' },
        departureLocal: slice.leaves,
        arrivalLocal: slice.lands,
      })),
    },
  }) as never;

const OUT = { from: 'LOS', to: 'LHR', leaves: '2026-12-10T07:15:00', lands: '2026-12-10T14:35:00' };
const BACK = {
  from: 'LHR',
  to: 'LOS',
  leaves: '2026-12-17T21:50:00',
  lands: '2026-12-18T05:20:00',
};

describe('a trip planned part by part (ADR-123)', () => {
  it('moves a wall time by hours, over midnight and month ends, with no zone', () => {
    expect(shiftWallTime('2026-12-10T14:35', 1)).toBe('2026-12-10T15:35');
    expect(shiftWallTime('2026-12-10T23:20', 2)).toBe('2026-12-11T01:20');
    expect(shiftWallTime('2026-12-31T23:00:00', 1)).toBe('2027-01-01T00:00');
    expect(shiftWallTime('2027-03-01T01:00', -3)).toBe('2027-02-28T22:00');
  });

  it('collects a car an hour after landing on the hour, and returns it three hours before the flight back', () => {
    expect(rentalWindow(facts())).toEqual({
      pickupAt: '2026-12-10T16:00',
      returnAt: '2026-12-17T18:00',
    });
    // Landing on the hour needs no rounding; a flight back at 00:30 means a return the day before.
    expect(
      rentalWindow(facts({ arriveAt: '2026-12-10T14:00', leaveAt: '2026-12-18T00:30' })),
    ).toEqual({ pickupAt: '2026-12-10T15:00', returnAt: '2026-12-17T21:00' });
    // A stop too short for a car leaves no rental, rather than one that ends before it starts.
    expect(
      rentalWindow(facts({ arriveAt: '2026-12-10T14:35', leaveAt: '2026-12-10T19:50' })),
    ).toBeNull();
  });

  it('puts the adults two to a room, with as many rooms as that takes', () => {
    expect(roomsFor(1)).toEqual([{ adults: 1, childAges: [] }]);
    expect(roomsFor(2)).toEqual([{ adults: 2, childAges: [] }]);
    expect(roomsFor(3).map((room) => room.adults)).toEqual([2, 1]);
    expect(roomsFor(5).map((room) => room.adults)).toEqual([2, 2, 1]);
    // Every adult has a bed whatever the room limit, and nobody is left out.
    for (const adults of [1, 2, 3, 4, 7, 9]) {
      const rooms = roomsFor(adults);
      expect(rooms.reduce((sum, room) => sum + room.adults, 0)).toBe(adults);
      expect(rooms.every((room) => room.adults >= 1)).toBe(true);
    }
  });

  it('reads the trip from a return flight only: where it lands, when, and who travels', () => {
    expect(
      tripFlowFacts(quote([OUT, BACK], { adults: 2, children: 1, infants: 0 }), 'city-london'),
    ).toEqual({
      cityId: 'city-london',
      cityName: 'London',
      countryCode: 'GB',
      airport: 'LHR',
      departDate: '2026-12-10',
      arriveAt: '2026-12-10T14:35',
      leaveAt: '2026-12-17T21:50',
      adults: 2,
      children: 1,
      infants: 0,
    });
    // One way, a flight back from somewhere else, or more than two slices: no trip to plan.
    expect(tripFlowFacts(quote([OUT]), null)).toBeNull();
    expect(tripFlowFacts(quote([OUT, { ...BACK, from: 'LGW' }]), null)).toBeNull();
    expect(tripFlowFacts(quote([OUT, BACK, BACK]), null)).toBeNull();
  });

  it('dates an add-on by what it is for: a transfer on landing, a lounge on leaving, cover for the trip', () => {
    expect(addonDays(facts(), 'airport_transfer')).toEqual({
      startDate: '2026-12-10',
      endDate: '2026-12-10',
    });
    expect(addonDays(facts(), 'lounge')).toEqual({
      startDate: '2026-12-10',
      endDate: '2026-12-10',
    });
    expect(addonDays(facts(), 'insurance')).toEqual({
      startDate: '2026-12-10',
      endDate: '2026-12-17',
    });
    // A flight that lands the next day takes its transfer on the day it lands.
    expect(addonDays(facts({ arriveAt: '2026-12-11T06:10' }), 'airport_transfer')).toEqual({
      startDate: '2026-12-11',
      endDate: '2026-12-11',
    });
  });
});

describe('the options a conversation was shown (ADR-123)', () => {
  const grant = (conversationId: string | null): AgentGrant =>
    ({ runId: 'run-1', conversationId }) as unknown as AgentGrant;

  /** Just enough of Redis for the store: a hash per key and a transaction that writes it. */
  const fakeRedis = (broken = false) => {
    const hashes = new Map<string, Map<string, string>>();
    const ttl = new Map<string, number>();
    const redis = {
      hashes,
      ttl,
      hget: (name: string, field: string) =>
        broken
          ? Promise.reject(new Error('down'))
          : Promise.resolve(hashes.get(name)?.get(field) ?? null),
      multi: () => {
        const steps: (() => void)[] = [];
        const transaction = {
          hset: (name: string, field: string, value: string) => {
            steps.push(() => {
              const hash = hashes.get(name) ?? new Map<string, string>();
              hash.set(field, value);
              hashes.set(name, hash);
            });
            return transaction;
          },
          expire: (name: string, seconds: number) => {
            steps.push(() => ttl.set(name, seconds));
            return transaction;
          },
          exec: () => {
            if (broken) return Promise.reject(new Error('down'));
            for (const step of steps) step();
            return Promise.resolve([]);
          },
        };
        return transaction;
      },
    };
    return redis;
  };

  const store = (redis: ReturnType<typeof fakeRedis>, capture = jest.fn()) =>
    new AgentOptions(redis as never, { capture } as never);

  it('gives back option n of the kind last shown, by number, for as long as a search lasts', async () => {
    const redis = fakeRedis();
    const options = store(redis);
    const chat = grant('conv-1');
    await options.remember(chat, 'hotel', [
      { id: '0193a1b2.h0' },
      { id: '0193a1b2.h1' },
      { id: '0193a1b2.h2' },
    ]);
    await options.remember(chat, 'car', [
      { id: 'car-1', extra: { pickupAt: '2026-12-10T16:00', returnAt: '2026-12-17T18:00' } },
    ]);
    expect(await options.get(chat, 'hotel', 2)).toEqual({ id: '0193a1b2.h1' });
    expect(await options.get(chat, 'car', 1)).toEqual({
      id: 'car-1',
      extra: { pickupAt: '2026-12-10T16:00', returnAt: '2026-12-17T18:00' },
    });
    expect(redis.ttl.get('agent:options:conv-1')).toBe(30 * 60);
    // A newer list of the same kind replaces the older one: "option 1" is what was shown last.
    await options.remember(chat, 'hotel', [{ id: '0193a1b3.h0' }]);
    expect(await options.get(chat, 'hotel', 1)).toEqual({ id: '0193a1b3.h0' });
    expect(await options.get(chat, 'hotel', 2)).toBeNull();
  });

  it('keeps each conversation to itself, and a run without one to the run', async () => {
    const redis = fakeRedis();
    const options = store(redis);
    await options.remember(grant('conv-1'), 'flight', [{ id: 'search-1.0' }]);
    expect(await options.get(grant('conv-2'), 'flight', 1)).toBeNull();
    await options.remember(grant(null), 'flight', [{ id: 'search-2.0' }]);
    expect(redis.hashes.has('agent:options:run:run-1')).toBe(true);
    expect(await options.get(grant(null), 'flight', 1)).toEqual({ id: 'search-2.0' });
  });

  it('answers nothing for a number it never showed, or for what it cannot read', async () => {
    const redis = fakeRedis();
    const options = store(redis);
    const chat = grant('conv-1');
    await options.remember(
      chat,
      'addon',
      Array.from({ length: 12 }, (_, index) => ({ id: `addon-${String(index + 1)}` })),
    );
    // Ten at most are kept: an eleventh option was never one to choose.
    expect(await options.get(chat, 'addon', 10)).toEqual({ id: 'addon-10' });
    expect(await options.get(chat, 'addon', 11)).toBeNull();
    for (const option of [0, -1, 1.5, Number.NaN]) {
      expect(await options.get(chat, 'addon', option)).toBeNull();
    }
    expect(await options.get(chat, 'hotel', 1)).toBeNull();
    // Whatever else is found there is not an option: never an id with spaces, never a number.
    redis.hashes.get('agent:options:conv-1')?.set('car', JSON.stringify([{ id: 'two words' }]));
    expect(await options.get(chat, 'car', 1)).toBeNull();
    redis.hashes
      .get('agent:options:conv-1')
      ?.set('car', JSON.stringify([{ id: 'car-1', extra: { n: 2 } }]));
    expect(await options.get(chat, 'car', 1)).toBeNull();
    redis.hashes.get('agent:options:conv-1')?.set('car', '{not json');
    expect(await options.get(chat, 'car', 1)).toBeNull();
  });

  it('reports a store it cannot write to, and the option is then asked for by id', async () => {
    const capture = jest.fn();
    await store(fakeRedis(true), capture).remember(grant('conv-1'), 'hotel', [{ id: 'a.h0' }]);
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { task: 'agent.options' });
  });
});
