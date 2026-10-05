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
      memberSaving: null,
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
    package: null,
    tour: null,
    visa: null,
    addon: null,
    membership: null,
    voucher: null,
    cancellation: null,
    addons: [],
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
          memberSaving: null,
          fx: price.fx,
        },
        expiresAt: '2026-10-01T09:30:00.000Z',
        hold: { available: false, paymentRequiredBy: null },
        services: [],
      },
      request,
    },
    hotel: null,
    package: null,
    tour: null,
    visa: null,
    addon: null,
    membership: null,
    price: null,
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

// ---------------------------------------------------------------------------
// In-house products (ADR-025 to ADR-028)
// ---------------------------------------------------------------------------

export const PACKAGE_DEPARTURE_ID = '0192d3a0-7c1e-7b2a-9f00-00000000e001';
export const FULL_DEPARTURE_ID = '0192d3a0-7c1e-7b2a-9f00-00000000e002';
export const APPLICATION_ID = '0192d3a0-7c1e-7b2a-9f00-00000000f001';
export const ADDON_ID = '0192d3a0-7c1e-7b2a-9f00-00000000f101';

const product = (title: string, slug: string) => ({
  id: '0192d3a0-7c1e-7b2a-9f00-00000000c001',
  slug,
  title,
  sample: true,
  artKey: null,
});
const tiers = [
  { daysBefore: 30, refundBps: 10_000 },
  { daysBefore: 7, refundBps: 5_000 },
  { daysBefore: 0, refundBps: 0 },
];
const perPerson = (adult: number, child: number | null) => ({
  adult: ngn(adult),
  child: child === null ? null : ngn(child),
  infant: null,
});

/** A sample Zanzibar package with one open departure and one with a single seat left. */
export const packageDetail: Schemas['PackageDetail'] = {
  ...product('Zanzibar beach break', 'sample-zanzibar-beach-break'),
  summary: '5 nights in Zanzibar.',
  featured: true,
  cityId: '0192d3a0-7c1e-7b2a-9f00-00000000c0c1',
  cityName: 'Zanzibar',
  countryCode: 'TZ',
  nights: 5,
  passportRequired: true,
  highlights: ['Stone Town walk'],
  itinerary: [{ day: 1, title: 'Arrival', body: 'Transfer to the hotel.' }],
  inclusions: ['Return flights'],
  exclusions: ['Visa fees'],
  cancellationPolicy: tiers,
  departures: [
    {
      id: PACKAGE_DEPARTURE_ID,
      startDate: '2026-11-14',
      endDate: '2026-11-19',
      seatsLeft: 20,
      prices: perPerson(125_000_000, 95_000_000),
      bookable: true,
    },
    {
      id: FULL_DEPARTURE_ID,
      startDate: '2026-12-14',
      endDate: '2026-12-19',
      seatsLeft: 1,
      prices: perPerson(125_000_000, 95_000_000),
      bookable: false,
    },
  ],
};

const packageItem: Schemas['PackageItem'] = {
  product: product('Zanzibar beach break', 'sample-zanzibar-beach-break'),
  departureId: PACKAGE_DEPARTURE_ID,
  cityName: 'Zanzibar',
  countryCode: 'TZ',
  nights: 5,
  startDate: '2026-11-14',
  endDate: '2026-11-19',
  passportRequired: true,
  inclusions: ['Return flights'],
  travellers: { adults: 1, children: 0, infants: 0 },
  cancellationPolicy: tiers,
};

const tourItem: Schemas['TourItem'] = {
  product: product('Dubai desert evening', 'sample-dubai-desert-evening'),
  departureId: '0192d3a0-7c1e-7b2a-9f00-00000000e101',
  cityName: 'Dubai',
  countryCode: 'AE',
  timeZone: 'Asia/Dubai',
  startsAtLocal: '2026-11-07T15:30',
  startsAt: '2026-11-07T11:30:00.000Z',
  durationMinutes: 360,
  meetingPoint: { name: 'Marina gate', address: 'Dubai Marina', notes: null },
  inclusions: ['Guide'],
  travellers: { adults: 1, children: 0, infants: 0 },
  cancellationPolicy: [{ daysBefore: 2, refundBps: 10_000 }],
};

const inhousePrice = (amount: number): Schemas['Price'] => ({
  currency: 'NGN',
  fare: ngn(amount),
  taxes: ngn(0),
  fees: [],
  discount: null,
  total: ngn(amount),
  memberSaving: null,
  fx: null,
});

/** A one-adult quote for the sample package (passports required) or tour (none asked). */
export function inhouseQuote(kind: 'package' | 'tour'): Schemas['Quote'] {
  return {
    ...flightQuote(),
    vertical: kind === 'package' ? 'packages' : 'tours',
    flight: null,
    package: kind === 'package' ? packageItem : null,
    tour: kind === 'tour' ? tourItem : null,
    price: inhousePrice(kind === 'package' ? 125_000_000 : 9_500_000),
  };
}

/** A confirmed sample tour with its voucher, cancellable under the policy. */
export function tourBooking(patch: Partial<Booking> = {}): Booking {
  return booking({
    reference: 'DQPFWY',
    vertical: 'tours',
    flight: null,
    tour: tourItem,
    price: { ...inhousePrice(9_500_000), extras: [] },
    paid: ngn(9_500_000),
    voucher: {
      code: 'U3N8-DCNR-NXZS-NXDA-293G',
      qrPayload: 'SUSKII-V1:U3N8DCNRNXZSNXDA293G',
      redeemedAt: null,
    },
    cancellation: { refundBps: 10_000, refund: ngn(9_500_000) },
    documents: [],
    passengers: [
      {
        position: 0,
        type: 'adult',
        title: 'mr',
        givenNames: 'CHINEDU',
        surname: 'OKAFOR',
        dateOfBirth: '1985-02-10',
        roomIndex: null,
        document: null,
        ticketNumber: null,
        extraBags: 0,
      },
    ],
    ...patch,
  });
}

/** A visa application waiting for its two documents (one optional). */
export function visaApplication(
  patch: Partial<Schemas['VisaApplication']> = {},
): Schemas['VisaApplication'] {
  return {
    id: APPLICATION_ID,
    bookingId: BOOKING_ID,
    applicantPosition: 0,
    applicantName: 'ADA OKAFOR',
    status: 'awaiting_documents',
    destination: 'AE',
    purpose: 'tourism',
    travelDate: '2026-11-14',
    submittedAt: null,
    closedAt: null,
    checklist: [
      {
        key: 'passport_bio',
        label: 'Passport bio page',
        description: 'A clear scan of the photo page.',
        required: true,
        document: null,
      },
      {
        key: 'invitation',
        label: 'Invitation letter',
        description: '',
        required: false,
        document: null,
      },
    ],
    messages: [],
    canUpload: true,
    canSubmit: false,
    disclaimer: 'The issuing government decides.',
    ...patch,
  };
}

export const addonCard: Schemas['AddonCard'] = {
  id: ADDON_ID,
  slug: 'sample-travel-insurance',
  title: 'Travel insurance (sample)',
  summary: 'Medical and trip cover.',
  artKey: null,
  sample: true,
  type: 'insurance',
  description: '',
  countryCodes: [],
  pricingBasis: 'per_person_per_day',
  unitPrice: ngn(150_000),
  maxTravellers: 9,
  requiredDetails: ['dates_of_birth'],
  cancellationPolicy: tiers,
};
