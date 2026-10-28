import { money } from '@suskii/shared';

import {
  OfferUnavailableError,
  SupplierAmbiguousError,
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

  it('books an instant order with the offer passenger ids, infants attached to adults', async () => {
    const original = (
      await supplierWith(
        fakeFetch(json(201, { data: { offers: [duffelOffer('off_1')] } })).fn,
      ).search(query, signal)
    )[0];
    if (!original) throw new Error('no offer');
    const offerPassengers = [
      { id: 'pas_1', type: 'adult' },
      { id: 'pas_2', type: 'child' },
      { id: 'pas_3', type: 'infant_without_seat' },
    ];
    const person = (
      type: 'adult' | 'child' | 'infant',
      givenNames: string,
      withPassport: boolean,
    ) => ({
      type,
      title: type === 'adult' ? ('ms' as const) : ('miss' as const),
      gender: 'f' as const,
      givenNames,
      surname: 'EZE',
      dateOfBirth: type === 'adult' ? '1990-01-01' : type === 'child' ? '2018-01-01' : '2026-01-01',
      nationality: 'NG',
      document: withPassport
        ? { number: 'A1234567', issuingCountry: 'NG', expiryDate: '2031-01-01' }
        : null,
    });
    const request = {
      offer: original,
      passengers: [
        person('adult', 'NGOZI', true),
        person('child', 'ADA', false),
        person('infant', 'OBI', false),
      ],
      contact: { email: 'ngozi@example.com', phone: '+2348012345678' },
      services: [],
      idempotencyKey: 'item-1',
    };
    const { fn, calls } = fakeFetch(
      json(200, { data: duffelOffer('off_1', { passengers: offerPassengers }) }),
      json(201, {
        data: {
          id: 'ord_1',
          booking_reference: 'RZPNX8',
          documents: [
            {
              type: 'electronic_ticket',
              unique_identifier: '0712345678901',
              passenger_ids: ['pas_1'],
            },
            {
              type: 'electronic_ticket',
              unique_identifier: '0712345678902',
              passenger_ids: ['pas_2'],
            },
            {
              type: 'electronic_ticket',
              unique_identifier: '0712345678903',
              passenger_ids: ['pas_3'],
            },
          ],
        },
      }),
    );
    const result = await supplierWith(fn).book(request, signal);
    expect(result).toEqual({
      orderId: 'ord_1',
      supplierReference: 'RZPNX8',
      tickets: [
        { passengerIndex: 0, number: '0712345678901' },
        { passengerIndex: 1, number: '0712345678902' },
        { passengerIndex: 2, number: '0712345678903' },
      ],
    });
    expect(calls[1]?.url).toBe('https://api.duffel.test/air/orders');
    const body = JSON.parse(calls[1]?.init?.body as string) as {
      data: {
        type: string;
        selected_offers: string[];
        passengers: Record<string, unknown>[];
        payments: unknown[];
      };
    };
    expect(body.data.type).toBe('instant');
    expect(body.data.selected_offers).toEqual(['off_1']);
    expect(body.data.payments).toEqual([{ type: 'balance', currency: 'USD', amount: '812.45' }]);
    expect(body.data.passengers[0]).toMatchObject({
      id: 'pas_1',
      given_name: 'NGOZI',
      family_name: 'EZE',
      born_on: '1990-01-01',
      infant_passenger_id: 'pas_3',
      identity_documents: [
        {
          type: 'passport',
          unique_identifier: 'A1234567',
          issuing_country_code: 'NG',
          expires_on: '2031-01-01',
        },
      ],
    });
    expect(body.data.passengers[1]).not.toHaveProperty('identity_documents');

    // Without bags the payment is the fare as Duffel states it, and no services are sent.
    expect(body.data).not.toHaveProperty('services');
    expect(calls[0]?.url).toContain('return_available_services=false');

    // A fare that moved after payment is refused, not charged; so is a bag the offer lacks.
    const moved = supplierWith(
      fakeFetch(
        json(200, {
          data: duffelOffer('off_1', { total_amount: '900.00', passengers: offerPassengers }),
        }),
      ).fn,
    );
    await expect(moved.book(request, signal)).rejects.toBeInstanceOf(SupplierRequestError);
    const noBags = fakeFetch(
      json(200, { data: duffelOffer('off_1', { passengers: offerPassengers }) }),
    );
    await expect(
      supplierWith(noBags.fn).book(
        { ...request, services: [{ serviceId: 'x', passengerIndex: 0, quantity: 1 }] },
        signal,
      ),
    ).rejects.toBeInstanceOf(SupplierRequestError);
    expect(noBags.calls).toHaveLength(1);

    // The order may exist when its call fails: unclear, for review, never another order.
    const freshOffer = () =>
      json(200, { data: duffelOffer('off_1', { passengers: offerPassengers }) });
    const lost = fakeFetch(freshOffer(), json(502, { errors: [] }));
    await expect(supplierWith(lost.fn).book(request, signal)).rejects.toBeInstanceOf(
      SupplierAmbiguousError,
    );
    const unreadable = fakeFetch(freshOffer(), json(201, { data: {} }));
    await expect(supplierWith(unreadable.fn).book(request, signal)).rejects.toBeInstanceOf(
      SupplierAmbiguousError,
    );
    // Nothing was ordered when the offer could not be read: safe to retry.
    const early = fakeFetch(json(503, { errors: [] }));
    await expect(supplierWith(early.fn).book(request, signal)).rejects.toBeInstanceOf(
      SupplierUnavailableError,
    );
  });

  it('maps transport and HTTP failures to supplier errors without leaking the token', async () => {
    const cases: [Response | Error, new (...args: never[]) => Error][] = [
      [json(429, { errors: [{ code: 'rate_limit_exceeded' }] }), SupplierUnavailableError],
      [json(503, { errors: [] }), SupplierUnavailableError],
      [json(400, { errors: [{ code: 'validation_error' }] }), SupplierRequestError],
      [new Response('<html>oops</html>', { status: 502 }), SupplierUnavailableError],
      // Stays not enabled on the account: Duffel answers 403 with a page, not JSON.
      [new Response('<html>Forbidden</html>', { status: 403 }), SupplierRequestError],
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
    await expect(
      supplierWith(fakeFetch(new Response('not json', { status: 201 })).fn).search(query, signal),
    ).rejects.toThrow(/invalid JSON/);
  });
});

describe('DuffelFlightSupplier quotes (one order per offer request, ADR-062)', () => {
  const signal = new AbortController().signal;
  const searchWith = (...offers: unknown[]) => json(201, { data: { id: 'orq_new', offers } });
  const otherAirline = (id: string) =>
    duffelOffer(id, {
      owner: {
        iata_code: 'BA',
        name: 'British Airways',
        logo_symbol_url: 'https://example.test/ba.svg',
      },
    });
  const otherFare = (id: string) => {
    const offer = structuredClone(duffelOffer(id));
    for (const slice of offer.slices) slice.fare_brand_name = 'Economy Flex';
    return offer;
  };
  async function searched() {
    const [offer] = await supplierWith(fakeFetch(searchWith(duffelOffer('off_1'))).fn).search(
      query,
      signal,
    );
    if (!offer) throw new Error('the fixture maps to an offer');
    return offer;
  }

  it('searches again, quotes the same flights and fare, then loads that offer', async () => {
    const original = await searched();
    const { fn, calls } = fakeFetch(
      searchWith(otherAirline('off_ba'), otherFare('off_flex'), duffelOffer('off_2')),
      json(200, { data: duffelOffer('off_2') }),
    );
    const quoted = await supplierWith(fn).quoteOffer(original, query, signal);
    expect(quoted.supplierOfferId).toBe('off_2');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain('/air/offer_requests');
    // Search results carry no extras: the chosen offer is fetched with them.
    expect(calls[1]?.url).toBe(
      'https://api.duffel.test/air/offers/off_2?return_available_services=true',
    );
  });

  it('prefers the same total, then the cheapest of the same flights and fare', async () => {
    const original = await searched();
    const both = await supplierWith(
      fakeFetch(
        searchWith(
          duffelOffer('off_dear', { total_amount: '900.00' }),
          duffelOffer('off_same'),
          duffelOffer('off_cheap', { total_amount: '700.00' }),
        ),
        json(200, { data: duffelOffer('off_same') }),
      ).fn,
    ).quoteOffer(original, query, signal);
    expect(both.supplierOfferId).toBe('off_same');

    const moved = await supplierWith(
      fakeFetch(
        searchWith(
          duffelOffer('off_dear', { total_amount: '900.00' }),
          duffelOffer('off_cheap', { total_amount: '700.00' }),
        ),
        json(200, { data: duffelOffer('off_cheap', { total_amount: '700.00' }) }),
      ).fn,
    ).quoteOffer(original, query, signal);
    // A different total is quoted as is; the quote shows the change to the traveller.
    expect(moved.supplierOfferId).toBe('off_cheap');
  });

  it('answers offer unavailable when the flights or fare are no longer offered', async () => {
    const original = await searched();
    await expect(
      supplierWith(
        fakeFetch(searchWith(otherAirline('off_ba'), otherFare('off_flex'))).fn,
      ).quoteOffer(original, query, signal),
    ).rejects.toBeInstanceOf(OfferUnavailableError);
  });
});

describe('DuffelFlightSupplier checked bags (ADR-063)', () => {
  const signal = new AbortController().signal;
  const offerPassengers = [
    { id: 'pas_1', type: 'adult' },
    { id: 'pas_2', type: 'child' },
    { id: 'pas_3', type: 'infant_without_seat' },
  ];
  const bag = (
    id: string,
    passenger: string,
    segments: string[],
    total: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id,
    type: 'baggage',
    total_amount: total,
    total_currency: 'USD',
    maximum_quantity: 2,
    passenger_ids: [passenger],
    segment_ids: segments,
    metadata: { type: 'checked', maximum_weight_kg: 23 },
    ...overrides,
  });
  /** The fixture's two segments get ids, and the offer the services given. */
  function withServices(id: string, services: unknown[], overrides: Record<string, unknown> = {}) {
    const offer = structuredClone(duffelOffer(id, { passengers: offerPassengers, ...overrides }));
    const [slice] = offer.slices;
    if (!slice) throw new Error('the fixture has a slice');
    slice.segments.forEach((segment, index) => Object.assign(segment, { id: `seg_${index + 1}` }));
    return { ...offer, available_services: services };
  }
  // The adult's bag covers the trip at once; the child's comes per segment (15 + 25 = 40).
  const sold = [
    bag('ase_a1', 'pas_1', ['seg_1', 'seg_2'], '40.00'),
    bag('ase_c1', 'pas_2', ['seg_1'], '15.00', { maximum_quantity: 1 }),
    bag('ase_c2', 'pas_2', ['seg_2'], '25.00'),
  ];
  const ignored = [
    // A heavier bag only the adult can add, a lap infant's bag, a carry-on, another currency,
    // a bag shared by two passengers, an unknown segment, an unknown weight and a malformed one.
    bag('ase_a32', 'pas_1', ['seg_1', 'seg_2'], '60.00', {
      metadata: { type: 'checked', maximum_weight_kg: 32 },
    }),
    bag('ase_i1', 'pas_3', ['seg_1', 'seg_2'], '40.00'),
    bag('ase_cabin', 'pas_1', ['seg_1', 'seg_2'], '10.00', {
      metadata: { type: 'carry_on', maximum_weight_kg: 8 },
    }),
    bag('ase_eur', 'pas_1', ['seg_1', 'seg_2'], '30.00', { total_currency: 'EUR' }),
    bag('ase_two', 'pas_1', ['seg_1', 'seg_2'], '30.00', { passenger_ids: ['pas_1', 'pas_2'] }),
    bag('ase_far', 'pas_1', ['seg_9'], '5.00'),
    bag('ase_nokg', 'pas_1', ['seg_1', 'seg_2'], '5.00', {
      metadata: { type: 'checked', maximum_weight_kg: null },
    }),
    { type: 'baggage', total_amount: '1.00' },
  ];

  async function repriced(services: unknown[]) {
    const [searchedOffer] = await supplierWith(
      fakeFetch(json(201, { data: { offers: [duffelOffer('off_1')] } })).fn,
    ).search(query, signal);
    if (!searchedOffer) throw new Error('the fixture maps to an offer');
    expect(searchedOffer.services).toEqual([]);
    return supplierWith(fakeFetch(json(200, { data: withServices('off_1', services) })).fn).reprice(
      searchedOffer,
      signal,
    );
  }

  it('sells a bag for the whole trip that every passenger with a seat can add', async () => {
    const offer = await repriced([...sold, ...ignored]);
    expect(offer.services).toEqual([
      {
        id: 'off_1.bag23',
        type: 'checked_bag',
        weightKg: 23,
        maxQuantity: 1,
        price: money(4_000n, 'USD'),
      },
    ]);
  });

  it('sells no bag that misses a segment or costs one passenger more', async () => {
    const [adult, childFirst, childSecond] = sold;
    expect((await repriced([adult, childFirst])).services).toEqual([]);
    expect(
      (await repriced([adult, childFirst, { ...childSecond, total_amount: '30.00' }])).services,
    ).toEqual([]);
    // Overlapping services never double-cover a segment: the widest is taken first.
    expect(
      (await repriced([...sold, bag('ase_a1b', 'pas_1', ['seg_1'], '10.00')])).services,
    ).toHaveLength(1);
  });

  it('books the paid bags with the fare and pays for both from the balance', async () => {
    const offer = await repriced(sold);
    const person = (type: 'adult' | 'child' | 'infant', dateOfBirth: string) => ({
      type,
      title: 'ms' as const,
      gender: 'f' as const,
      givenNames: 'ADA',
      surname: 'EZE',
      dateOfBirth,
      nationality: 'NG',
      document: null,
    });
    const request = {
      offer,
      passengers: [
        person('adult', '1990-01-01'),
        person('child', '2018-01-01'),
        person('infant', '2026-01-01'),
      ],
      contact: { email: 'ada@example.com', phone: '+2348012345678' },
      services: [
        { serviceId: 'off_1.bag23', passengerIndex: 0, quantity: 2 },
        { serviceId: 'off_1.bag23', passengerIndex: 1, quantity: 1 },
      ],
      idempotencyKey: 'item-1',
    };
    const { fn, calls } = fakeFetch(
      json(200, { data: withServices('off_1', sold) }),
      json(201, { data: { id: 'ord_1', booking_reference: 'RZPNX8', documents: [] } }),
    );
    await supplierWith(fn).book(request, signal);
    expect(calls[0]?.url).toContain('return_available_services=true');
    const body = JSON.parse(calls[1]?.init?.body as string) as {
      data: { services: unknown[]; payments: unknown[] };
    };
    expect(body.data.services).toEqual([
      { id: 'ase_a1', quantity: 2 },
      { id: 'ase_c1', quantity: 1 },
      { id: 'ase_c2', quantity: 1 },
    ]);
    // 812.45 for the fare, 2 x 40 for the adult's bags and 40 for the child's.
    expect(body.data.payments).toEqual([{ type: 'balance', currency: 'USD', amount: '932.45' }]);

    // A bag that changed price, or more bags than the airline sells, is refused, never ordered.
    for (const [services, selection] of [
      [[sold[0], sold[1], { ...sold[2], total_amount: '26.00' }], request.services],
      [sold, [{ serviceId: 'off_1.bag23', passengerIndex: 1, quantity: 2 }]],
      [sold, [{ serviceId: 'off_1.bag23', passengerIndex: 2, quantity: 1 }]],
    ] as const) {
      const refused = fakeFetch(json(200, { data: withServices('off_1', [...services]) }));
      await expect(
        supplierWith(refused.fn).book({ ...request, services: [...selection] }, signal),
      ).rejects.toBeInstanceOf(SupplierRequestError);
      expect(refused.calls).toHaveLength(1);
    }
  });
});

describe('DuffelFlightSupplier cancellation (ADR-064)', () => {
  const signal = new AbortController().signal;
  const cancellation = (overrides: Record<string, unknown> = {}) => ({
    id: 'ore_1',
    order_id: 'ord_1',
    refund_amount: '180.00',
    refund_currency: 'USD',
    refund_to: 'balance',
    expires_at: '2026-11-01T11:00:00Z',
    confirmed_at: null,
    ...overrides,
  });
  async function request() {
    const [offer] = await supplierWith(
      fakeFetch(json(201, { data: { offers: [duffelOffer('off_1')] } })).fn,
    ).search(query, signal);
    if (!offer) throw new Error('the fixture maps to an offer');
    return { orderId: 'ord_1', offer, supplierTotal: money(81_245n, 'USD') };
  }

  it('quotes a pending cancellation: the refund, where it goes and until when', async () => {
    const { fn, calls } = fakeFetch(json(201, { data: cancellation() }));
    const quote = await supplierWith(fn).cancellationQuote(await request(), signal);
    expect(quote).toEqual({
      quoteId: 'ore_1',
      refund: money(18_000n, 'USD'),
      refundToBalance: true,
      expiresAt: '2026-11-01T11:00:00.000Z',
    });
    expect(calls[0]?.url).toBe('https://api.duffel.test/air/order_cancellations');
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({ data: { order_id: 'ord_1' } });

    // Credits are not money back to our balance; a missing amount refunds nothing.
    const credits = await supplierWith(
      fakeFetch(json(201, { data: cancellation({ refund_to: 'airline_credits' }) })).fn,
    ).cancellationQuote(await request(), signal);
    expect(credits.refundToBalance).toBe(false);
    const nothing = await supplierWith(
      fakeFetch(json(201, { data: cancellation({ refund_amount: null }) })).fn,
    ).cancellationQuote(await request(), signal);
    expect(nothing.refund).toEqual(money(0n, 'USD'));
  });

  it('confirms a cancellation, and treats one already confirmed as done', async () => {
    const confirmed = fakeFetch(json(200, { data: cancellation({ confirmed_at: 'now' }) }));
    await supplierWith(confirmed.fn).confirmCancellation('ore_1', signal);
    expect(confirmed.calls[0]?.url).toBe(
      'https://api.duffel.test/air/order_cancellations/ore_1/actions/confirm',
    );

    // A failed confirmation that Duffel says went through anyway counts as done.
    const done = fakeFetch(
      json(503, { errors: [] }),
      json(200, { data: cancellation({ confirmed_at: '2026-11-01T10:31:00Z' }) }),
    );
    await supplierWith(done.fn).confirmCancellation('ore_1', signal);
    expect(done.calls[1]?.url).toBe('https://api.duffel.test/air/order_cancellations/ore_1');

    // One that did not go through fails as it did.
    const failed = fakeFetch(json(503, { errors: [] }), json(200, { data: cancellation() }));
    await expect(
      supplierWith(failed.fn).confirmCancellation('ore_1', signal),
    ).rejects.toBeInstanceOf(SupplierUnavailableError);
  });

  it('returns the order id with a booking, for cancelling it later', async () => {
    const original = await request();
    const { fn } = fakeFetch(
      json(200, { data: duffelOffer('off_1') }),
      json(201, { data: { id: 'ord_9', booking_reference: 'RZPNX8', documents: [] } }),
    );
    const result = await supplierWith(fn).book(
      {
        offer: original.offer,
        passengers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'ADA',
            surname: 'EZE',
            dateOfBirth: '1990-01-01',
            nationality: 'NG',
            document: null,
          },
        ],
        contact: { email: 'ada@example.com', phone: '+2348012345678' },
        services: [],
        idempotencyKey: 'item-1',
      },
      signal,
    );
    expect(result.orderId).toBe('ord_9');
  });
});

describe('DuffelFlightSupplier airline changes (ADR-065)', () => {
  const signal = new AbortController().signal;
  const [bookedSlice] = duffelOffer('off_1').slices;
  if (!bookedSlice) throw new Error('the fixture has a slice');
  // The airline moves the London leg: it now leaves Addis Ababa at 23:55 and lands at 06:20.
  const movedSlice = {
    ...bookedSlice,
    segments: [
      bookedSlice.segments[0],
      {
        ...bookedSlice.segments[1],
        departing_at: '2026-11-20T23:55:00',
        arriving_at: '2026-11-21T06:20:00',
      },
    ],
  };
  const airlineChange = (overrides: Record<string, unknown> = {}) => ({
    id: 'aic_1',
    order_id: 'ord_1',
    created_at: '2026-11-02T09:00:00.000000Z',
    updated_at: '2026-11-02T09:00:00.000000Z',
    action_taken: null,
    action_taken_at: null,
    available_actions: ['accept', 'cancel', 'change', 'update'],
    added: [movedSlice],
    removed: [bookedSlice],
    travel_agent_ticket: null,
    ...overrides,
  });
  const order = (changes: unknown[], slices: unknown[] = [movedSlice]) => ({
    data: { id: 'ord_1', booking_reference: 'RZPNX8', slices, airline_initiated_changes: changes },
  });
  async function request() {
    const [offer] = await supplierWith(
      fakeFetch(json(201, { data: { offers: [duffelOffer('off_1')] } })).fn,
    ).search(query, signal);
    if (!offer) throw new Error('the fixture maps to an offer');
    return { orderId: 'ord_1', offer };
  }

  it('reads the order for its current flights and each change the airline made', async () => {
    const { fn, calls } = fakeFetch(json(200, order([airlineChange()])));
    const supplier = supplierWith(fn);
    expect(supplier.tracksChanges).toBe(true);
    const result = await supplier.orderChanges(await request(), signal);
    expect(calls[0]?.url).toBe('https://api.duffel.test/air/orders/ord_1');
    expect(result.slices[0]?.segments[1]).toMatchObject({
      flightNumber: '700',
      departureLocal: '2026-11-20T23:55',
      departureUtc: '2026-11-20T20:55:00.000Z',
      arrivalUtc: '2026-11-21T06:20:00.000Z',
    });
    expect(result.changes).toEqual([
      {
        id: 'aic_1',
        createdAt: '2026-11-02T09:00:00.000Z',
        removed: [expect.objectContaining({ arrivalLocal: '2026-11-21T05:40' })],
        added: [expect.objectContaining({ arrivalLocal: '2026-11-21T06:20' })],
        acceptable: true,
        actionTaken: null,
      },
    ]);
  });

  it('reports a change it cannot read, or cannot accept online, as one for support', async () => {
    const { fn } = fakeFetch(
      json(
        200,
        order([
          airlineChange({ id: 'aic_1', added: [{ segments: [] }] }),
          airlineChange({ id: 'aic_2', available_actions: ['update'] }),
          airlineChange({ id: 'aic_3', action_taken: 'accepted', available_actions: [] }),
          { id: 'aic_4' },
        ]),
      ),
    );
    const { changes } = await supplierWith(fn).orderChanges(await request(), signal);
    expect(
      changes.map(({ id, acceptable, actionTaken }) => ({ id, acceptable, actionTaken })),
    ).toEqual([
      { id: 'aic_1', acceptable: false, actionTaken: null },
      { id: 'aic_2', acceptable: false, actionTaken: null },
      { id: 'aic_3', acceptable: false, actionTaken: 'accepted' },
    ]);
    expect(changes[0]).toMatchObject({ removed: [], added: [] });

    // An order whose own flights cannot be read is a failed check, not an empty one.
    const unreadable = fakeFetch(json(200, order([], [{ segments: [] }])));
    await expect(
      supplierWith(unreadable.fn).orderChanges(await request(), signal),
    ).rejects.toBeInstanceOf(SupplierUnavailableError);
  });

  it('accepts a change, and treats one already accepted as done', async () => {
    const accepted = airlineChange({ action_taken: 'accepted', available_actions: [] });
    const ok = fakeFetch(json(200, { data: accepted }), json(200, order([accepted])));
    const result = await supplierWith(ok.fn).acceptAirlineChange(
      { ...(await request()), changeId: 'aic_1' },
      signal,
    );
    expect(ok.calls.map((call) => [call.init?.method, call.url])).toEqual([
      ['POST', 'https://api.duffel.test/air/airline_initiated_changes/aic_1/actions/accept'],
      ['GET', 'https://api.duffel.test/air/orders/ord_1'],
    ]);
    expect(result.changes[0]?.actionTaken).toBe('accepted');

    // A failed call that Duffel says went through anyway counts as done.
    const done = fakeFetch(json(503, { errors: [] }), json(200, order([accepted])));
    await expect(
      supplierWith(done.fn).acceptAirlineChange(
        { ...(await request()), changeId: 'aic_1' },
        signal,
      ),
    ).resolves.toMatchObject({ changes: [{ actionTaken: 'accepted' }] });

    // One that did not go through fails as it did.
    const failed = fakeFetch(json(422, { errors: [] }), json(200, order([airlineChange()])));
    await expect(
      supplierWith(failed.fn).acceptAirlineChange(
        { ...(await request()), changeId: 'aic_1' },
        signal,
      ),
    ).rejects.toBeInstanceOf(SupplierRequestError);
  });
});

describe('DuffelFlightSupplier holds (ADR-018)', () => {
  const signal = new AbortController().signal;
  const holdable = () =>
    duffelOffer('off_h', {
      payment_requirements: {
        requires_instant_payment: false,
        payment_required_by: '2026-11-03T17:00:00Z',
        price_guarantee_expires_at: '2026-11-02T17:00:00Z',
      },
    });
  const heldOrder = (overrides: Record<string, unknown> = {}) => ({
    data: {
      id: 'ord_h',
      booking_reference: 'HLDPNR',
      total_amount: '812.45',
      total_currency: 'USD',
      tax_amount: '122.45',
      tax_currency: 'USD',
      payment_status: {
        awaiting_payment: true,
        payment_required_by: '2026-11-03T17:00:00Z',
        price_guarantee_expires_at: '2026-11-02T17:00:00Z',
      },
      passengers: [{ id: 'pas_1' }],
      documents: [],
      ...overrides,
    },
  });
  const passenger = {
    type: 'adult' as const,
    title: 'ms' as const,
    gender: 'f' as const,
    givenNames: 'NGOZI',
    surname: 'EZE',
    dateOfBirth: '1990-01-01',
    nationality: 'NG',
    document: null,
  };

  async function offer() {
    const found = (
      await supplierWith(fakeFetch(json(201, { data: { offers: [holdable()] } })).fn).search(
        { ...query, passengers: { adults: 1, children: 0, infants: 0 } },
        signal,
      )
    )[0];
    if (!found) throw new Error('no offer');
    return found;
  }

  it('maps the price guarantee and creates a pay_later order', async () => {
    const original = await offer();
    expect(original.hold).toEqual({
      available: true,
      paymentRequiredBy: '2026-11-03T17:00:00.000Z',
      priceGuaranteedUntil: '2026-11-02T17:00:00.000Z',
    });
    const { fn, calls } = fakeFetch(json(200, { data: holdable() }), json(201, heldOrder()));
    const held = await supplierWith(fn).hold(
      {
        offer: original,
        passengers: [passenger],
        contact: { email: 'ngozi@example.com', phone: '+2348012345678' },
        idempotencyKey: 'item-h',
      },
      signal,
    );
    expect(held).toMatchObject({
      orderId: 'ord_h',
      supplierReference: 'HLDPNR',
      paymentRequiredBy: '2026-11-03T17:00:00.000Z',
      priceGuaranteedUntil: '2026-11-02T17:00:00.000Z',
    });
    const body = JSON.parse(calls[1]?.init?.body as string) as { data: Record<string, unknown> };
    expect(body.data.type).toBe('pay_later');
    expect(body.data).not.toHaveProperty('payments');
  });

  it('pays a held order only at the agreed total, then reads its tickets', async () => {
    const original = await offer();
    const { fn, calls } = fakeFetch(
      json(200, heldOrder()),
      json(201, { data: { id: 'pay_1', amount: '812.45', currency: 'USD', type: 'balance' } }),
      json(
        200,
        heldOrder({
          payment_status: { awaiting_payment: false },
          documents: [
            {
              type: 'electronic_ticket',
              unique_identifier: '0719876543210',
              passenger_ids: ['pas_1'],
            },
          ],
        }),
      ),
    );
    const result = await supplierWith(fn).payHeld(
      { orderId: 'ord_h', price: original.price, idempotencyKey: 'item-h' },
      signal,
    );
    expect(result).toEqual({
      orderId: 'ord_h',
      supplierReference: 'HLDPNR',
      tickets: [{ passengerIndex: 0, number: '0719876543210' }],
    });
    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
      'GET https://api.duffel.test/air/orders/ord_h',
      'POST https://api.duffel.test/air/payments',
      'GET https://api.duffel.test/air/orders/ord_h',
    ]);
    expect(JSON.parse(calls[1]?.init?.body as string)).toEqual({
      data: { order_id: 'ord_h', payment: { type: 'balance', amount: '812.45', currency: 'USD' } },
    });

    // The guarantee lapsed and the airline raised the fare: refused, nothing is paid.
    const moved = fakeFetch(json(200, heldOrder({ total_amount: '900.00' })));
    await expect(
      supplierWith(moved.fn).payHeld(
        { orderId: 'ord_h', price: original.price, idempotencyKey: 'item-h' },
        signal,
      ),
    ).rejects.toBeInstanceOf(SupplierRequestError);
    expect(moved.calls).toHaveLength(1);
  });

  it('cancels a held order by creating and confirming a cancellation', async () => {
    const { fn, calls } = fakeFetch(
      json(201, {
        data: {
          id: 'ore_1',
          order_id: 'ord_h',
          refund_amount: '0.00',
          refund_to: 'awaiting_payment',
        },
      }),
      json(200, { data: { id: 'ore_1', confirmed_at: '2026-10-01T10:00:00Z' } }),
    );
    await supplierWith(fn).cancelHold('ord_h', signal);
    expect(calls.map((call) => call.url)).toEqual([
      'https://api.duffel.test/air/order_cancellations',
      'https://api.duffel.test/air/order_cancellations/ore_1/actions/confirm',
    ]);
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
