import type { FlightSegment, FlightSlice } from '../suppliers/supplier.types';

import { changeLines, departed, itinerarySignature } from './schedule-changes';

const airport = (code: string, cityName: string) => ({
  code,
  name: null,
  cityName,
  countryCode: 'NG',
  timeZone: 'Africa/Lagos',
});

const slice = (departureLocal: string, arrivalLocal: string, flightNumber = '101'): FlightSlice => {
  const segment = {
    marketingCarrier: { code: 'W3', name: 'Arik Air' },
    operatingCarrier: { code: 'W3', name: 'Arik Air' },
    flightNumber,
    origin: airport('LOS', 'Lagos'),
    destination: airport('ABV', 'Abuja'),
    departureLocal,
    departureUtc: `${departureLocal}:00.000Z`,
    arrivalLocal,
    arrivalUtc: `${arrivalLocal}:00.000Z`,
  } as FlightSegment;
  return {
    origin: segment.origin,
    destination: segment.destination,
    departureLocal,
    departureUtc: segment.departureUtc,
    arrivalLocal,
    arrivalUtc: segment.arrivalUtc,
    segments: [segment],
    fareBrand: 'Economy Light',
  } as FlightSlice;
};

describe('airline schedule change rules (ADR-065)', () => {
  it('tells itineraries apart by flights, airports and times only', () => {
    const booked = slice('2026-11-26T08:30', '2026-11-26T09:45');
    expect(itinerarySignature([booked])).toBe(
      itinerarySignature([{ ...booked, fareBrand: null, layovers: [] }]),
    );
    expect(itinerarySignature([booked])).not.toBe(
      itinerarySignature([slice('2026-11-26T10:00', '2026-11-26T11:15')]),
    );
    expect(itinerarySignature([booked])).not.toBe(
      itinerarySignature([slice('2026-11-26T08:30', '2026-11-26T09:45', '105')]),
    );
  });

  it('stops checking once the last flight has left', () => {
    const outbound = slice('2026-11-26T08:30', '2026-11-26T09:45');
    const inbound = slice('2026-11-30T18:00', '2026-11-30T19:15');
    expect(departed([outbound, inbound], new Date('2026-11-27T00:00:00Z'))).toBe(false);
    expect(departed([outbound, inbound], new Date('2026-11-30T18:00:00Z'))).toBe(true);
    expect(departed([], new Date())).toBe(true);
  });

  it('writes one line per changed flight, old and new side by side', () => {
    const before = slice('2026-11-26T08:30', '2026-11-26T09:45');
    const after = slice('2026-11-26T10:00', '2026-11-26T11:15', '105');
    expect(changeLines([before], [after])).toEqual([
      'Lagos (LOS) to Abuja (ABV): was W3 101, departing Thu, 26 Nov 2026 08:30 and arriving Thu, 26 Nov 2026 09:45. Now W3 105, departing Thu, 26 Nov 2026 10:00 and arriving Thu, 26 Nov 2026 11:15.',
    ]);
    expect(changeLines([before], [])).toEqual([
      'Lagos (LOS) to Abuja (ABV): was W3 101, departing Thu, 26 Nov 2026 08:30 and arriving Thu, 26 Nov 2026 09:45. This flight is no longer in your booking.',
    ]);
    expect(changeLines([], [])).toEqual([]);
  });
});
