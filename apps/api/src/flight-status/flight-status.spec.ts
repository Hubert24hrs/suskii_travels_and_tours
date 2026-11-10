import type { FlightSegment } from '../suppliers/supplier.types';

import { followedNow, nextStatusCheck, statusQuery, statusWindow } from './flight-status';
import { MockFlightStatusProvider } from './flight-status.provider';

const segment = (departureUtc: string, arrivalUtc: string): FlightSegment => ({
  marketingCarrier: { code: 'P4', name: 'Air Peace' },
  operatingCarrier: { code: 'P4', name: 'Air Peace' },
  flightNumber: '7120',
  origin: {
    code: 'LOS',
    name: 'Murtala Muhammed International Airport',
    cityName: 'Lagos',
    countryCode: 'NG',
    timeZone: 'Africa/Lagos',
  },
  destination: {
    code: 'ABV',
    name: 'Nnamdi Azikiwe International Airport',
    cityName: 'Abuja',
    countryCode: 'NG',
    timeZone: 'Africa/Lagos',
  },
  departureLocal: '2026-12-02T00:30',
  departureUtc,
  arrivalLocal: '2026-12-02T01:45',
  arrivalUtc,
  durationMinutes: 75,
  aircraft: null,
  cabinClass: 'economy',
});

const FLIGHT = segment('2026-12-01T23:30:00.000Z', '2026-12-02T00:45:00.000Z');
const SETTINGS = { windowHours: 24, checkMinutes: 15 };
const at = (iso: string): Date => new Date(iso);

describe('flight status rules (ADR-095)', () => {
  it('asks the provider by airline, number and the local day of departure', () => {
    expect(statusQuery(FLIGHT)).toEqual({
      carrier: 'P4',
      flightNumber: '7120',
      origin: 'LOS',
      destination: 'ABV',
      // 23:30 UTC on the 1st is the 2nd in Lagos.
      departureDate: '2026-12-02',
      scheduledDepartureUtc: '2026-12-01T23:30:00.000Z',
      scheduledArrivalUtc: '2026-12-02T00:45:00.000Z',
    });
  });

  it('follows a flight from a day before it leaves until six hours after it should land', () => {
    const { from, until } = statusWindow(FLIGHT, 24);
    expect(new Date(from).toISOString()).toBe('2026-11-30T23:30:00.000Z');
    expect(new Date(until).toISOString()).toBe('2026-12-02T06:45:00.000Z');
    expect(followedNow(FLIGHT, at('2026-11-30T23:29:00Z'), 24)).toBe(false);
    expect(followedNow(FLIGHT, at('2026-12-01T12:00:00Z'), 24)).toBe(true);
    expect(followedNow(FLIGHT, at('2026-12-02T06:46:00Z'), 24)).toBe(false);
  });

  it('books the next check at the start of the window, then every few minutes, then never', () => {
    const none = new Set<number>();
    expect(nextStatusCheck([FLIGHT], none, at('2026-11-20T00:00:00Z'), SETTINGS)).toEqual(
      at('2026-11-30T23:30:00Z'),
    );
    expect(nextStatusCheck([FLIGHT], none, at('2026-12-01T12:00:00Z'), SETTINGS)).toEqual(
      at('2026-12-01T12:15:00Z'),
    );
    expect(nextStatusCheck([FLIGHT], none, at('2026-12-02T07:00:00Z'), SETTINGS)).toBeNull();
    // A flight that has landed or was cancelled is not asked about again.
    expect(
      nextStatusCheck([FLIGHT], new Set([0]), at('2026-12-01T12:00:00Z'), SETTINGS),
    ).toBeNull();
    // The return flight of a trip is picked up when its own window opens.
    const back = segment('2026-12-10T08:00:00.000Z', '2026-12-10T09:15:00.000Z');
    expect(
      nextStatusCheck([FLIGHT, back], new Set([0]), at('2026-12-02T01:00:00Z'), SETTINGS),
    ).toEqual(at('2026-12-09T08:00:00Z'));
  });
});

describe('MockFlightStatusProvider', () => {
  const signal = new AbortController().signal;
  const query = statusQuery(FLIGHT);

  it('runs a flight on time through its day, with a stable gate', async () => {
    const provider = new MockFlightStatusProvider();
    const states: string[] = [];
    const gates = new Set<string | null>();
    for (const now of [
      '2026-12-01T10:00:00Z',
      '2026-12-01T23:00:00Z',
      '2026-12-01T23:45:00Z',
      '2026-12-02T01:00:00Z',
    ]) {
      provider.now = () => at(now);
      const [report] = await provider.status([query], signal);
      states.push(report?.state ?? 'unknown');
      gates.add(report?.departureGate ?? null);
    }
    expect(states).toEqual(['scheduled', 'boarding', 'departed', 'landed']);
    expect(gates.size).toBe(1);
  });

  it('delays, cancels or fails as told', async () => {
    const provider = new MockFlightStatusProvider(new Map([['LOS-ABV', { delayMinutes: 45 }]]));
    provider.now = () => at('2026-12-01T10:00:00Z');
    const [late] = await provider.status([query], signal);
    expect(late).toMatchObject({
      state: 'delayed',
      estimatedDepartureUtc: '2026-12-02T00:15:00.000Z',
      estimatedArrivalUtc: '2026-12-02T01:30:00.000Z',
    });

    provider.flights.set('P47120', { state: 'cancelled' });
    const [cancelled] = await provider.status([query], signal);
    expect(cancelled).toMatchObject({ state: 'cancelled', estimatedDepartureUtc: null });

    provider.failNext = 1;
    await expect(provider.status([query], signal)).rejects.toMatchObject({
      name: 'FlightStatusError',
      code: 'unavailable',
    });
  });
});
