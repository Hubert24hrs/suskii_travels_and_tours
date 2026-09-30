import type { Schemas } from '@suskii/api-client';
import { BOOKING_TERMS_VERSION } from '@suskii/shared';

type Booking = Schemas['Booking'];
type Slice = Schemas['FlightSlice'];

export const BOOKING_ID = '0192d3a0-7c1e-7b2a-9f00-1234567890ab';

const ngn = (amountMinor: number): Schemas['Money'] => ({ amountMinor, currency: 'NGN' });

const airport = (code: string, cityName: string, countryCode = 'NG'): Schemas['AirportPoint'] => ({
  code,
  name: `${cityName} Airport`,
  cityName,
  countryCode,
  timeZone: 'Africa/Lagos',
});

/** A one-segment slice departing at 07:30 local time on `date`. */
export function slice(from: string, to: string, date: string): Slice {
  const origin = airport(from, from === 'LOS' ? 'Lagos' : from === 'ABV' ? 'Abuja' : from);
  const destination = airport(to, to === 'LOS' ? 'Lagos' : to === 'ABV' ? 'Abuja' : to);
  const times = {
    departureLocal: `${date}T07:30`,
    departureUtc: `${date}T06:30:00.000Z`,
    arrivalLocal: `${date}T08:40`,
    arrivalUtc: `${date}T07:40:00.000Z`,
    durationMinutes: 70,
  };
  return {
    origin,
    destination,
    ...times,
    stops: 0,
    arrivalDayOffset: 0,
    fareBrand: null,
    segments: [
      {
        marketingCarrier: { code: 'ZZ', name: 'Demo Air' },
        operatingCarrier: { code: 'ZZ', name: 'Demo Air' },
        flightNumber: '101',
        origin,
        destination,
        ...times,
        aircraft: null,
        cabinClass: 'economy',
      },
    ],
    layovers: [],
  };
}

/** A confirmed one-way Lagos to Abuja booking; override any field. */
export function booking(patch: Partial<Booking> = {}): Booking {
  const slices = [slice('LOS', 'ABV', '2026-11-02')];
  return {
    id: BOOKING_ID,
    reference: 'SK7Q2M',
    status: 'CONFIRMED',
    vertical: 'flights',
    createdAt: '2026-10-01T09:00:00.000Z',
    paymentDeadline: null,
    confirmedAt: '2026-10-01T09:05:00.000Z',
    contact: { email: 'a***@example.com', phone: '+234*******00' },
    price: {
      currency: 'NGN',
      fare: ngn(7_000_000),
      taxes: ngn(1_500_000),
      fees: [],
      discount: null,
      total: ngn(8_500_000),
      fx: null,
      extras: [],
    },
    pendingPriceChange: null,
    flight: {
      owner: { code: 'ZZ', name: 'Demo Air' },
      slices,
      baggage: { carryOn: 1, checked: 1 },
      conditions: { refundable: false, changeable: true },
      cabinClass: 'economy',
      airlineReference: 'ZZ4K9P',
      request: {
        slices: slices.map((item) => ({
          origin: item.origin.code,
          destination: item.destination.code,
          departureDate: item.departureLocal.slice(0, 10),
        })),
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
        directOnly: false,
      },
    },
    hotel: null,
    passengers: [
      {
        position: 0,
        type: 'adult',
        title: 'mr',
        givenNames: 'ADEBAYO',
        surname: 'OKAFOR',
        dateOfBirth: '1990-04-21',
        roomIndex: null,
        document: null,
        ticketNumber: '0001234567890',
        extraBags: 0,
      },
    ],
    warnings: [],
    payment: null,
    documents: [
      {
        id: '0192d3a0-7c1e-7b2a-9f00-00000000d0c1',
        type: 'e_ticket',
        fileName: 'SK7Q2M-e-ticket.pdf',
        sizeBytes: 48_000,
        createdAt: '2026-10-01T09:06:00.000Z',
      },
    ],
    paid: ngn(8_500_000),
    amountDue: null,
    paymentPlan: null,
    paymentOptions: null,
    refunds: [],
    ...patch,
  };
}

/** The same trip with other slices (round trip, multi-city). */
export function withSlices(slices: Slice[], patch: Partial<Booking> = {}): Booking {
  const base = booking(patch);
  return base.flight ? { ...base, flight: { ...base.flight, slices } } : base;
}

export const QUOTE_ID = '0192d3a0-7c1e-7b2a-9f00-00000000a001';

/** A domestic one-adult flight quote that can only be paid in full through the mock provider. */
export function flightQuote(patch: Partial<Schemas['Quote']> = {}): Schemas['Quote'] {
  const slices = [slice('LOS', 'ABV', '2026-11-02')];
  const { price, flight } = booking();
  const request = flight?.request ?? {
    slices: [],
    passengers: { adults: 1, children: 0, infants: 0 },
    cabinClass: 'economy',
    directOnly: false,
  };
  return {
    quoteId: QUOTE_ID,
    vertical: 'flights',
    currency: 'NGN',
    expiresAt: '2026-10-01T09:30:00.000Z',
    termsVersion: BOOKING_TERMS_VERSION,
    flight: {
      offer: {
        id: 'offer-1',
        supplier: 'mock',
        owner: { code: 'ZZ', name: 'Demo Air' },
        slices,
        baggage: { carryOn: 1, checked: 1 },
        conditions: {
          refundable: false,
          refundPenalty: null,
          changeable: true,
          changePenalty: null,
        },
        cabinClass: 'economy',
        passengers: { adults: 1, children: 0, infants: 0 },
        price: {
          currency: price.currency,
          fare: price.fare,
          taxes: price.taxes,
          fees: price.fees,
          discount: price.discount,
          total: price.total,
          fx: price.fx,
        },
        expiresAt: '2026-10-01T09:30:00.000Z',
        hold: { available: false, paymentRequiredBy: null },
        services: [],
      },
      request,
    },
    hotel: null,
    payment: {
      providers: [{ name: 'mock', methods: ['card'] }],
      hold: null,
      installments: null,
      wallet: null,
    },
    ...patch,
  };
}

export const countries: Schemas['Countries'] = {
  items: [
    { code: 'NG', name: 'Nigeria', continent: 'AF' },
    { code: 'GH', name: 'Ghana', continent: 'AF' },
  ],
};
