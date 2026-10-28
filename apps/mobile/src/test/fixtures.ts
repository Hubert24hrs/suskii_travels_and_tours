import type { Schemas } from '@suskii/api-client';
import {
  BOOKING_TERMS_VERSION,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
} from '@suskii/shared';

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
      serviceTaxes: [],
      discount: null,
      total: ngn(8_500_000),
      memberSaving: null,
      fx: null,
      extras: [],
      deposit: null,
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
    bus: null,
    ride: null,
    rental: null,
    priceBreakdown: null,
    busTickets: [],
    voucher: null,
    cancellation: null,
    flightCancellable: false,
    scheduleChange: null,
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
    company: null,
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
          serviceTaxes: price.serviceTaxes,
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
    bus: null,
    ride: null,
    rental: null,
    price: null,
    priceBreakdown: null,
    payment: {
      providers: [{ name: 'mock', methods: ['card'] }],
      methods: [{ method: 'card', providers: ['mock'] }],
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
  serviceTaxes: [],
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

/** Two nights in Lagos, with the city tax paid at the hotel. */
export function hotelQuote(): Schemas['Quote'] {
  return {
    ...flightQuote(),
    vertical: 'hotels',
    flight: null,
    hotel: {
      name: 'Marina Suites',
      stars: 4,
      area: 'Victoria Island',
      cityName: 'Lagos',
      countryCode: 'NG',
      amenities: [],
      rate: {
        id: 'rate-1',
        roomName: 'Deluxe double',
        board: 'breakfast_included',
        refundable: true,
        freeCancellationUntil: null,
        price: inhousePrice(12_000_000),
        pricePerNight: ngn(6_000_000),
        payAtProperty: ngn(500_000),
        expiresAt: '2026-10-01T09:30:00.000Z',
      },
      nights: 2,
      request: {
        destination: { type: 'city', cityId: '0192d3a0-7c1e-7b2a-9f00-0000000000c1' },
        checkIn: '2026-11-02',
        checkOut: '2026-11-04',
        rooms: [{ adults: 1, childAges: [] }],
        freeCancellationOnly: false,
      },
    },
  };
}

/** A confirmed sample tour with its voucher, cancellable under the policy. */
export function tourBooking(patch: Partial<Booking> = {}): Booking {
  return booking({
    reference: 'DQPFWY',
    vertical: 'tours',
    flight: null,
    tour: tourItem,
    price: { ...inhousePrice(9_500_000), extras: [], deposit: null },
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

// ---------------------------------------------------------------------------
// Accounts, Suskii Prime, referrals and price alerts (phase 9)
// ---------------------------------------------------------------------------

/** Defaults from the notification matrix: booking and payment email are mandatory. */
export function notificationPreferences(
  patch: Partial<Schemas['NotificationPreferences']> = {},
): Schemas['NotificationPreferences'] {
  const categories = NOTIFICATION_CATEGORIES;
  const channels = NOTIFICATION_CHANNELS;
  return {
    preferences: categories.flatMap((category) =>
      channels.map((channel) => {
        const mandatory = channel === 'email' && (category === 'booking' || category === 'payment');
        return {
          category,
          channel,
          mandatory,
          enabled: mandatory || (channel === 'email' && category !== 'marketing'),
        };
      }),
    ),
    phoneVerified: true,
    marketingConsent: false,
    ...patch,
  };
}

export const PLAN_ID = '0192d3a0-7c1e-7b2a-9f00-00000000b001';
export const primePlan: Schemas['PrimePlan'] = {
  id: PLAN_ID,
  slug: 'suskii-prime-sample',
  name: 'Suskii Prime (sample)',
  summary: 'Member prices, no service fee and priority support for a year.',
  period: 'year',
  price: ngn(2_500_000),
  prices: [ngn(2_500_000)],
  benefits: { memberFares: true, waivedFeeCodes: ['service_fee'], prioritySupport: true },
  sample: true,
};

export const myReferrals: Schemas['MyReferrals'] = {
  code: 'K7Q2MXRA',
  active: true,
  shareUrl: 'https://suskii.example/register?ref=K7Q2MXRA',
  counts: { pending: 2, qualified: 1, rewarded: 0, review: 0, rejected: 0 },
  rewards: { referrer: ngn(200_000), referee: ngn(100_000), minSpend: null },
  referredBy: null,
};

export const ALERT_ID = '0192d3a0-7c1e-7b2a-9f00-00000000b101';
export const priceAlert: Schemas['PriceAlert'] = {
  id: ALERT_ID,
  origin: 'LOS',
  destination: 'DXB',
  departureDate: '2026-12-10',
  departureMonth: null,
  cabinClass: 'economy',
  currency: 'NGN',
  target: null,
  lastPrice: ngn(65_000_000),
  lastCheckedAt: '2026-10-05T06:00:00.000Z',
  lastNotifiedAt: null,
  active: true,
  endsOn: '2026-12-10',
  createdAt: '2026-10-01T09:00:00.000Z',
};

export const MEMBERSHIP_BOOKING_ID = '0192d3a0-7c1e-7b2a-9f00-00000000b201';
/** A Suskii Prime membership booking: no flight, one member, a term once confirmed. */
export function membershipBooking(patch: Partial<Booking> = {}): Booking {
  return booking({
    id: MEMBERSHIP_BOOKING_ID,
    reference: 'SKPR1M',
    vertical: 'prime',
    flight: null,
    passengers: [],
    documents: [],
    membership: {
      product: {
        id: PLAN_ID,
        slug: primePlan.slug,
        title: primePlan.name,
        sample: true,
        artKey: null,
      },
      summary: primePlan.summary,
      period: 'year',
      benefits: primePlan.benefits,
      term: { startsAt: '2026-10-05T10:00:00.000Z', endsAt: '2027-10-05T10:00:00.000Z' },
    },
    ...patch,
  });
}

// Cars (ADR-049 to ADR-053): buses, rides and car rental.

export const carsFeatures: Schemas['CarsFeatures'] = {
  buses: true,
  rides: true,
  rentals: true,
  bundles: false,
  priceBreakdown: false,
  safetySuite: false,
  offlineQr: false,
  departurePlanner: false,
};

export const BUS_TRIP_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c101';
const lagosTerminal = {
  terminalId: '0192d3a0-7c1e-7b2a-9f00-00000000c111',
  name: 'Jibowu Terminal',
  cityName: 'Lagos',
  address: 'Ikorodu Road, Jibowu',
};
const ibadanTerminal = {
  terminalId: '0192d3a0-7c1e-7b2a-9f00-00000000c112',
  name: 'Challenge Terminal',
  cityName: 'Ibadan',
  address: 'Challenge, Ibadan',
};

export const busCities: Schemas['BusCities'] = {
  cities: [
    {
      name: 'Lagos',
      stateName: 'Lagos',
      terminals: [
        { id: lagosTerminal.terminalId, name: lagosTerminal.name, address: lagosTerminal.address },
      ],
    },
    {
      name: 'Ibadan',
      stateName: 'Oyo',
      terminals: [
        {
          id: ibadanTerminal.terminalId,
          name: ibadanTerminal.name,
          address: ibadanTerminal.address,
        },
      ],
    },
  ],
};

export const busTripCard: Schemas['BusSearchResult']['trips'][number] = {
  id: BUS_TRIP_ID,
  operator: {
    id: '0192f0aa-0000-7000-8000-00000000b001',
    name: 'Lagoon Express',
    slug: 'lagoon-express',
  },
  sample: true,
  origin: lagosTerminal,
  destination: ibadanTerminal,
  timeZone: 'Africa/Lagos',
  departsAtLocal: '2026-11-02T07:00',
  departsAt: '2026-11-02T06:00:00.000Z',
  arrivesAt: '2026-11-02T08:30:00.000Z',
  durationMinutes: 150,
  coach: 'Toyota Hiace',
  amenities: ['air_conditioning', 'a_future_amenity'],
  seatsLeft: 12,
  pricePerSeat: ngn(850_000),
};

export function busTrip(patch: Partial<Schemas['BusTripDetail']> = {}): Schemas['BusTripDetail'] {
  return {
    ...busTripCard,
    status: 'scheduled',
    seatMap: {
      rows: [
        [{ seatNumber: '1A', state: 'available' }, null, { seatNumber: '1B', state: 'sold' }],
        [{ seatNumber: '2A', state: 'available' }, null, { seatNumber: '2B', state: 'available' }],
      ],
    },
    cancellationPolicy: [{ daysBefore: 1, refundBps: 8_000 }],
    ...patch,
  };
}

export const BUS_HOLD_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c121';
const busItem: Schemas['BusItem'] = {
  product: product('Lagos to Ibadan', 'sample-lagos-ibadan'),
  operatorName: 'Lagoon Express',
  tripId: BUS_TRIP_ID,
  origin: lagosTerminal,
  destination: ibadanTerminal,
  timeZone: 'Africa/Lagos',
  departsAtLocal: '2026-11-02T07:00',
  departsAt: '2026-11-02T06:00:00.000Z',
  arrivesAt: '2026-11-02T08:30:00.000Z',
  seats: ['1A', '2A'],
  amenities: ['air_conditioning'],
  travellers: { adults: 2, children: 0, infants: 0 },
  cancellationPolicy: [{ daysBefore: 1, refundBps: 8_000 }],
  holdExpiresAt: '2026-10-01T09:10:00.000Z',
};

export function busQuote(): Schemas['Quote'] {
  return {
    ...flightQuote(),
    vertical: 'buses',
    flight: null,
    bus: busItem,
    price: inhousePrice(1_700_000),
  };
}

const ticket = (seatNumber: string, passengerName: string): Schemas['BusTicket'] => ({
  id: `0192d3a0-7c1e-7b2a-9f00-00000000c1${seatNumber === '1A' ? '31' : '32'}`,
  seatNumber,
  passengerName,
  status: 'valid',
  boardedAt: null,
  qrPayload: `SUSKII-T1.${seatNumber}.eyJ0aWNrZXQiOiJzYW1wbGUifQ.c2lnbmF0dXJl`,
  validFrom: '2026-11-02T03:00:00.000Z',
  validUntil: '2026-11-02T12:00:00.000Z',
});

/** A confirmed two-seat bus booking with its boarding passes. */
export function busBooking(patch: Partial<Booking> = {}): Booking {
  return booking({
    reference: 'BUS7Q2',
    vertical: 'buses',
    flight: null,
    bus: busItem,
    busTickets: [ticket('1A', 'Ada Okafor'), ticket('2A', 'Bola Okafor')],
    price: { ...inhousePrice(1_700_000), extras: [], deposit: null },
    paid: ngn(1_700_000),
    documents: [],
    ...patch,
  });
}

export const RIDE_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c201';
const yaba = { label: 'Yaba', lat: 6.5095, lng: 3.3711 };
const victoriaIsland = { label: 'Victoria Island', lat: 6.4281, lng: 3.4219 };

export const ridePlaces: Schemas['RidePlaces'] = {
  places: [
    {
      id: '0192d3a0-7c1e-7b2a-9f00-00000000c211',
      name: 'Yaba',
      kind: 'landmark',
      cityName: 'Lagos',
      lat: yaba.lat,
      lng: yaba.lng,
      sample: true,
    },
    {
      id: '0192d3a0-7c1e-7b2a-9f00-00000000c212',
      name: 'Victoria Island',
      kind: 'landmark',
      cityName: 'Lagos',
      lat: victoriaIsland.lat,
      lng: victoriaIsland.lng,
      sample: true,
    },
  ],
};

const rideItem = (rideId: string | null): Schemas['RideItem'] => ({
  product: product('Ride in Lagos', 'ride-lagos'),
  category: 'standard',
  cityName: 'Lagos',
  pickup: yaba,
  dropoff: victoriaIsland,
  scheduledFor: null,
  distanceMetres: 12_400,
  durationSeconds: 1_800,
  polyline: '',
  estimate: 'routed',
  fare: {
    base: ngn(50_000),
    distance: ngn(200_000),
    time: ngn(50_000),
    surge: ngn(0),
    minimumTopUp: ngn(0),
    bookingFee: ngn(20_000),
    total: ngn(320_000),
  },
  cancellation: { fee: ngn(50_000), freeCancelSeconds: 120, waitGraceSeconds: 300 },
  rideId,
});

export function rideQuote(): Schemas['Quote'] {
  return {
    ...flightQuote(),
    vertical: 'rides',
    flight: null,
    ride: rideItem(null),
    price: inhousePrice(320_000),
  };
}

export function rideBooking(patch: Partial<Booking> = {}): Booking {
  return booking({
    reference: 'RIDE42',
    vertical: 'rides',
    flight: null,
    ride: rideItem(RIDE_ID),
    passengers: [],
    price: { ...inhousePrice(320_000), extras: [], deposit: null },
    paid: ngn(320_000),
    documents: [],
    ...patch,
  });
}

export function ride(patch: Partial<Schemas['Ride']> = {}): Schemas['Ride'] {
  return {
    id: RIDE_ID,
    bookingId: BOOKING_ID,
    status: 'assigned',
    category: 'standard',
    cityName: 'Lagos',
    pickup: yaba,
    dropoff: victoriaIsland,
    scheduledFor: null,
    polyline: '',
    distanceMetres: 12_400,
    durationSeconds: 1_800,
    fare: ngn(320_000),
    pin: '4827',
    driver: {
      firstName: 'Tunde',
      rating: 4.8,
      vehicle: { make: 'Toyota', model: 'Corolla', colour: 'Silver', plate: 'KJA-123-AB' },
    },
    driverPosition: null,
    etaSeconds: 240,
    assignedAt: '2026-10-01T09:00:00.000Z',
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationFee: null,
    rated: false,
    sharing: null,
    ...patch,
  };
}

export const RESERVATION_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c301';

export const rentalVehicle: Schemas['RentalVehicle'] = {
  id: '0192d3a0-7c1e-7b2a-9f00-00000000c311',
  slug: 'sample-toyota-corolla',
  make: 'Toyota',
  model: 'Corolla',
  year: 2021,
  category: 'compact',
  transmission: 'automatic',
  seats: 5,
  features: ['Bluetooth'],
  photoUrls: [],
  artKey: null,
  sample: true,
  cityName: 'Lagos',
  branch: { name: 'Ikeja branch', address: 'Allen Avenue, Ikeja', lat: 6.6018, lng: 3.3515 },
  daily: ngn(3_500_000),
  chauffeurDaily: ngn(1_500_000),
  deposit: ngn(10_000_000),
  delivery: null,
  mileage: { kmPerDay: null, excessKm: null },
  fuelPolicy: 'full_to_full',
  insuranceSummary: 'Comprehensive cover with an excess of NGN 250,000.',
  cancellationPolicy: [{ daysBefore: 2, refundBps: 10_000 }],
  timeZone: 'Africa/Lagos',
};

const rentalItem = (
  reservation: Schemas['RentalItem']['reservation'] = null,
): Schemas['RentalItem'] => ({
  product: product('Toyota Corolla', rentalVehicle.slug),
  vehicle: {
    make: 'Toyota',
    model: 'Corolla',
    year: 2021,
    category: 'compact',
    transmission: 'automatic',
    seats: 5,
    features: ['Bluetooth'],
    photoUrls: [],
  },
  branch: rentalVehicle.branch,
  cityName: 'Lagos',
  timeZone: 'Africa/Lagos',
  pickupAtLocal: '2026-11-05T10:00',
  returnAtLocal: '2026-11-07T10:00',
  days: 2,
  chauffeur: false,
  delivery: null,
  charge: {
    vehicle: ngn(7_000_000),
    chauffeur: ngn(0),
    delivery: ngn(0),
    deposit: ngn(10_000_000),
  },
  mileage: { kmPerDay: null, excessKm: null },
  fuelPolicy: 'full_to_full',
  insuranceSummary: rentalVehicle.insuranceSummary,
  reservation,
});

export function rentalQuote(): Schemas['Quote'] {
  return {
    ...flightQuote(),
    vertical: 'rentals',
    flight: null,
    rental: rentalItem(),
    price: inhousePrice(7_000_000),
  };
}

export function rentalBooking(patch: Partial<Booking> = {}): Booking {
  return booking({
    reference: 'CAR9K2',
    vertical: 'rentals',
    flight: null,
    rental: rentalItem({
      id: RESERVATION_ID,
      status: 'reserved',
      licenceRequired: true,
      licence: null,
      chauffeurAssigned: false,
      checkedOutAt: null,
      checkedInAt: null,
      deposit: null,
    }),
    passengers: [],
    price: { ...inhousePrice(7_000_000), extras: [], deposit: ngn(10_000_000) },
    paid: ngn(17_000_000),
    documents: [],
    ...patch,
  });
}

export function rentalReservation(
  licence: Schemas['RentalReservation']['licence'] = null,
): Schemas['RentalReservation'] {
  return {
    id: RESERVATION_ID,
    bookingId: BOOKING_ID,
    status: 'reserved',
    licenceRequired: true,
    licence,
  };
}

export const DRIVER_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c401';
export const VEHICLE_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c402';

export function driverProfile(
  patch: Partial<Schemas['DriverProfile']> = {},
): Schemas['DriverProfile'] {
  return {
    id: DRIVER_ID,
    status: 'pending',
    statusReason: null,
    givenNames: 'Chinedu',
    surname: 'Okeke',
    cityName: 'Lagos',
    identityCheck: 'verified',
    licenceCheck: 'verified',
    licenceEndsWith: '567',
    licenceExpiresOn: '2031-06-30',
    rating: null,
    ratingCount: 0,
    documents: [],
    vehicles: [],
    payoutAccount: null,
    missing: ['documents', 'vehicle', 'approval'],
    sample: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...patch,
  };
}

export const OFFER_ID = '0192d3a0-7c1e-7b2a-9f00-00000000c411';

export const rideOffer: Schemas['RideOffer'] = {
  id: OFFER_ID,
  rideId: RIDE_ID,
  category: 'standard',
  pickupLabel: 'Yaba',
  pickup: { lat: yaba.lat, lng: yaba.lng },
  dropoffLabel: 'Victoria Island',
  distanceToPickupMetres: 1_200,
  tripDistanceMetres: 12_400,
  earnings: ngn(240_000),
  expiresAt: '2026-10-01T09:00:15.000Z',
};

export function driverRide(patch: Partial<Schemas['DriverRide']> = {}): Schemas['DriverRide'] {
  return {
    id: RIDE_ID,
    status: 'arrived',
    category: 'standard',
    riderFirstName: 'Ada',
    pickup: yaba,
    dropoff: victoriaIsland,
    polyline: '',
    distanceMetres: 12_400,
    earnings: ngn(240_000),
    pinLocked: false,
    assignedAt: '2026-10-01T09:00:00.000Z',
    arrivedAt: '2026-10-01T09:05:00.000Z',
    startedAt: null,
    ...patch,
  };
}

export const driverEarnings: Schemas['DriverEarnings'] = {
  balance: ngn(480_000),
  summary: { timeZone: 'Africa/Lagos', today: ngn(240_000), last7Days: ngn(480_000) },
  rides: [],
  payouts: [],
};
