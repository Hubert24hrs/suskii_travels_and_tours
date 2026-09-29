import { money } from '@suskii/shared';

import {
  OfferUnavailableError,
  SupplierRequestError,
  SupplierTimeoutError,
  SupplierUnavailableError,
} from '../supplier.errors';
import type { FlightSearchQuery } from '../supplier.types';

import { syncDuffelAirlines } from './duffel-airlines';
import { DuffelFlightSupplier } from './duffel-flight-supplier';
import { DuffelClient } from './duffel.client';

// Shaped after the examples in Duffel's v2 API reference (offer requests and offers).
const place = (iata: string, zone: string, city: string, country: string) => ({
  type: 'airport',
  iata_code: iata,
  name: `${city} Airport`,
  time_zone: zone,
  city_name: city,
  iata_country_code: country,
});

const duffelOffer = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  live_mode: false,
  expires_at: '2026-11-01T10:30:00.000000Z',
  total_amount: '812.45',
  total_currency: 'USD',
  base_amount: '690.00',
  base_currency: 'USD',
  tax_amount: '122.45',
  tax_currency: 'USD',
  owner: {
    iata_code: 'ET',
    name: 'Ethiopian Airlines',
    logo_symbol_url: 'https://example.test/et.svg',
  },
  slices: [
    {
      fare_brand_name: 'Economy Classic',
      duration: 'PT13H55M',
      segments: [
        {
          origin: place('LOS', 'Africa/Lagos', 'Lagos', 'NG'),
          destination: place('ADD', 'Africa/Addis_Ababa', 'Addis Ababa', 'ET'),
          departing_at: '2026-11-20T13:45:00',
          arriving_at: '2026-11-20T21:20:00',
          marketing_carrier: { iata_code: 'ET', name: 'Ethiopian Airlines' },
          marketing_carrier_flight_number: '900',
          operating_carrier: { iata_code: 'ET', name: 'Ethiopian Airlines' },
          aircraft: { name: 'Boeing 787-8' },
          passengers: [
            {
              passenger_id: 'pas_1',
              cabin_class: 'economy',
              baggages: [
                { type: 'checked', quantity: 2 },
                { type: 'carry_on', quantity: 1 },
              ],
            },
          ],
        },
        {
          origin: place('ADD', 'Africa/Addis_Ababa', 'Addis Ababa', 'ET'),
          destination: place('LHR', 'Europe/London', 'London', 'GB'),
          departing_at: '2026-11-20T23:15:00',
          arriving_at: '2026-11-21T05:40:00',
          marketing_carrier: { iata_code: 'ET', name: 'Ethiopian Airlines' },
          marketing_carrier_flight_number: '700',
          operating_carrier: { iata_code: 'ET', name: 'Ethiopian Airlines' },
          aircraft: null,
          passengers: [
            {
              passenger_id: 'pas_1',
              cabin_class: 'economy',
              baggages: [
                { type: 'checked', quantity: 1 },
                { type: 'carry_on', quantity: 1 },
              ],
            },
          ],
        },
      ],
    },
  ],
  conditions: {
    refund_before_departure: { allowed: true, penalty_amount: '150.00', penalty_currency: 'USD' },
    change_before_departure: { allowed: true, penalty_amount: '50.00', penalty_currency: 'USD' },
  },
  payment_requirements: {
    requires_instant_payment: false,
    payment_required_by: '2026-11-03T17:00:00Z',
    price_guarantee_expires_at: null,
  },
  passengers: [{ id: 'pas_1', type: 'adult' }],
  ...overrides,
});

const query: FlightSearchQuery = {
  slices: [{ origin: 'LOS', destination: 'LHR', departureDate: '2026-11-20' }],
  passengers: { adults: 1, children: 1, infants: 1 },
  cabinClass: 'economy',
  maxConnections: 1,
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('unexpected call'));
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }) as typeof fetch;
  return { fn, calls };
}

const supplierWith = (fetchImpl: typeof fetch) =>
  new DuffelFlightSupplier(
    new DuffelClient({
      baseUrl: 'https://api.duffel.test',
      token: 'duffel_test_secret',
      fetch: fetchImpl,
    }),
    10_000,
  );

describe('DuffelFlightSupplier', () => {
  const signal = new AbortController().signal;

  it('sends a v2 offer request and maps offers into the domain shape', async () => {
    const { fn, calls } = fakeFetch(
      json(201, {
        data: {
          id: 'orq_1',
          offers: [duffelOffer('off_1'), { id: 'off_broken', total_amount: 'free' }],
        },
      }),
    );
    const offers = await supplierWith(fn).search(query, signal);

    expect(calls[0]?.url).toBe(
      'https://api.duffel.test/air/offer_requests?return_offers=true&supplier_timeout=8500',
    );
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('Duffel-Version')).toBe('v2');
    expect(headers.get('Authorization')).toBe('Bearer duffel_test_secret');
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      data: {
        slices: [{ origin: 'LOS', destination: 'LHR', departure_date: '2026-11-20' }],
        passengers: [{ type: 'adult' }, { type: 'child' }, { type: 'infant_without_seat' }],
        cabin_class: 'economy',
        max_connections: 1,
      },
    });

    // The malformed offer is skipped, not passed through.
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect(offer).toMatchObject({
      supplier: 'duffel',
      supplierOfferId: 'off_1',
      owner: { code: 'ET', name: 'Ethiopian Airlines' },
      baggage: { carryOn: 1, checked: 1 },
      conditions: { refundable: true, changeable: true },
      expiresAt: '2026-11-01T10:30:00.000Z',
      hold: { available: true, paymentRequiredBy: '2026-11-03T17:00:00.000Z' },
    });
    expect(offer?.price).toEqual({ base: money(69_000n, 'USD'), taxes: money(12_245n, 'USD') });
    expect(offer?.conditions.refundPenalty).toEqual(money(15_000n, 'USD'));

    const slice = offer?.slices[0];
    expect(slice).toMatchObject({ stops: 1, fareBrand: 'Economy Classic', arrivalDayOffset: 1 });
    // 13:45 Lagos (UTC+1) = 12:45Z; 05:40 London (UTC+0 in November) = 05:40Z.
    expect(slice?.departureUtc).toBe('2026-11-20T12:45:00.000Z');
    expect(slice?.arrivalUtc).toBe('2026-11-21T05:40:00.000Z');
    expect(slice?.durationMinutes).toBe(1015);
    expect(slice?.layovers[0]).toMatchObject({
      airport: { code: 'ADD' },
      durationMinutes: 115,
      warnings: [],
    });
    expect(slice?.segments[1]?.aircraft).toBeNull();
  });

  it('re-prices by fetching the offer and maps gone offers to OfferUnavailableError', async () => {
    const original = (
      await supplierWith(
        fakeFetch(json(201, { data: { offers: [duffelOffer('off_1')] } })).fn,
      ).search(query, signal)
    )[0];
    if (!original) throw new Error('no offer');
    const repriced = await supplierWith(
      fakeFetch(
        json(200, {
          data: duffelOffer('off_1', { total_amount: '830.45', base_amount: '708.00' }),
        }),
      ).fn,
    ).reprice(original, signal);
    expect(repriced.price.base).toEqual(money(70_800n, 'USD'));

    const gone = supplierWith(
      fakeFetch(
        json(422, {
          errors: [{ code: 'offer_no_longer_available', title: 'Offer no longer available' }],
        }),
      ).fn,
    );
    await expect(gone.reprice(original, signal)).rejects.toBeInstanceOf(OfferUnavailableError);
  });

  it('maps transport and HTTP failures to supplier errors without leaking the token', async () => {
    const cases: [Response | Error, new (...args: never[]) => Error][] = [
      [json(429, { errors: [{ code: 'rate_limit_exceeded' }] }), SupplierUnavailableError],
      [json(503, { errors: [] }), SupplierUnavailableError],
      [json(400, { errors: [{ code: 'validation_error' }] }), SupplierRequestError],
      [new Response('<html>oops</html>', { status: 502 }), SupplierUnavailableError],
      [new TypeError('fetch failed'), SupplierUnavailableError],
      [Object.assign(new Error('aborted'), { name: 'AbortError' }), SupplierTimeoutError],
    ];
    for (const [response, errorClass] of cases) {
      const failure = await supplierWith(fakeFetch(response).fn)
        .search(query, signal)
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(errorClass);
      expect(String((failure as Error).message)).not.toContain('duffel_test_secret');
    }
    await expect(
      supplierWith(fakeFetch(json(201, { data: {} })).fn).search(query, signal),
    ).rejects.toBeInstanceOf(SupplierUnavailableError);
  });
});

describe('syncDuffelAirlines', () => {
  it('pages through airlines and upserts those with IATA codes', async () => {
    const { fn, calls } = fakeFetch(
      json(200, {
        data: [
          { iata_code: 'P4', name: 'Air Peace', logo_symbol_url: null },
          { iata_code: null, name: 'No Code Air' },
        ],
        meta: { after: 'cursor_2' },
      }),
      json(200, {
        data: [
          {
            iata_code: 'et',
            name: 'Ethiopian Airlines',
            logo_symbol_url: 'https://example.test/et.svg',
          },
        ],
        meta: { after: null },
      }),
    );
    const upsert = jest.fn(() => Promise.resolve({}));
    const count = await syncDuffelAirlines(
      new DuffelClient({ baseUrl: 'https://api.duffel.test', token: 't', fetch: fn }),
      { airline: { upsert } } as never,
    );
    expect(count).toBe(2);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.duffel.test/air/airlines?limit=200',
      'https://api.duffel.test/air/airlines?limit=200&after=cursor_2',
    ]);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { iataCode: 'ET' } }));
  });
});
