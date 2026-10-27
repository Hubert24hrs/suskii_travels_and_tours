import type { FlightSegment, FlightSlice } from '../suppliers/supplier.types';

import { changeLines, departed, itinerarySignature, significantChange } from './schedule-changes';

const airport = (code: string, cityName: string, countryCode: string | null = 'NG') => ({
  code,
  name: null,
  cityName,
  countryCode,
  timeZone: 'Africa/Lagos',
});

const slice = (
  departureLocal: string,
  arrivalLocal: string,
  flightNumber = '101',
  destination = airport('ABV', 'Abuja'),
): FlightSlice => {
  const segment = {
    marketingCarrier: { code: 'W3', name: 'Arik Air' },
    operatingCarrier: { code: 'W3', name: 'Arik Air' },
    flightNumber,
    origin: airport('LOS', 'Lagos'),
    destination,
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

  describe('significant changes (ADR-073)', () => {
    const thresholds = { domesticHours: 3, internationalHours: 6 };
    const booked = slice('2026-11-26T08:30', '2026-11-26T09:45');

    it('counts a cancelled flight, another airport and more connections', () => {
      expect(significantChange([booked], [], thresholds)).toBe(true);
      const elsewhere = slice(
        '2026-11-26T08:30',
        '2026-11-26T09:45',
        '101',
        airport('KAN', 'Kano'),
      );
      expect(significantChange([booked], [elsewhere], thresholds)).toBe(true);
      const firstSegment = booked.segments[0];
      if (!firstSegment) throw new Error('fixture has a segment');
      const connecting = {
        ...booked,
        segments: [firstSegment, { ...firstSegment, flightNumber: '202' }],
      };
      expect(significantChange([booked], [connecting], thresholds)).toBe(true);
    });

    it('uses the domestic threshold within one country and the international one otherwise', () => {
      const later = (hours: number, flight = booked): FlightSlice => {
        const shift = (iso: string) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
        return {
          ...flight,
          departureUtc: shift(flight.departureUtc),
          arrivalUtc: shift(flight.arrivalUtc),
        };
      };
      expect(significantChange([booked], [later(2.5)], thresholds)).toBe(false);
      expect(significantChange([booked], [later(3)], thresholds)).toBe(true);
      expect(significantChange([booked], [later(-3)], thresholds)).toBe(true);

      const abroad = slice(
        '2026-11-26T08:30',
        '2026-11-26T14:45',
        '101',
        airport('LHR', 'London', 'GB'),
      );
      expect(significantChange([abroad], [later(5, abroad)], thresholds)).toBe(false);
      expect(significantChange([abroad], [later(6, abroad)], thresholds)).toBe(true);
      // An airport with no known country is not known to be domestic.
      const unknown = slice(
        '2026-11-26T08:30',
        '2026-11-26T09:45',
        '101',
        airport('XXX', 'X', null),
      );
      expect(significantChange([unknown], [later(4, unknown)], thresholds)).toBe(false);
    });

    it('leaves unreadable changes to support', () => {
      expect(significantChange([], [], thresholds)).toBe(false);
      expect(significantChange([], [booked], thresholds)).toBe(false);
    });
  });
});
