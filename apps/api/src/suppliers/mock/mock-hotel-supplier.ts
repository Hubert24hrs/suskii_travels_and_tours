import {
  addDays,
  daysBetween,
  localToUtc,
  money,
  multiplyRatio,
  percentageOf,
  type Money,
  type PropertyType,
} from '@suskii/shared';

import { OfferUnavailableError, SupplierUnavailableError } from '../supplier.errors';
import {
  HotelSupplier,
  type BoardType,
  type HotelBookingRequest,
  type HotelBookingResult,
  type HotelSearchQuery,
  type SupplierHotel,
  type SupplierHotelRate,
  type SupplierPhoto,
  type SupplierRoom,
} from '../supplier.types';

import { SeededRandom, stableCode, stableId } from './random';

const OFFER_TTL_MS = 30 * 60_000;

// MOCK fixture vocabulary: every generated hotel name is fictional.
const NAME_CORES = [
  'Grand',
  'Royal',
  'Palm',
  'Harbour',
  'Garden',
  'Summit',
  'Riverside',
  'Crown',
  'Oasis',
  'Heritage',
  'Skyline',
  'Lagoon',
  'Emerald',
  'Marina',
  'Parkview',
  'Meridian',
];
const NAME_KINDS = ['Hotel', 'Suites', 'Resort', 'Inn', 'Residences', 'Lodge', 'Hotel & Spa'];
const AREAS = [
  'City centre',
  'Business district',
  'Waterfront',
  'Airport area',
  'Old town',
  'Beachfront',
];
const AMENITIES = [
  'wifi',
  'air_conditioning',
  'restaurant',
  'bar',
  'pool',
  'gym',
  'spa',
  'parking',
  'airport_shuttle',
  '24h_front_desk',
  'business_centre',
  'backup_power',
  'room_service',
  'laundry',
];
const ROOMS: { name: string; factor: number; minStars: number; room: SupplierRoom }[] = [
  {
    name: 'Standard Room',
    factor: 1,
    minStars: 1,
    room: {
      description: 'A quiet room with a work desk, a wardrobe and a private bathroom.',
      maxGuests: 2,
      sizeSqm: 22,
      beds: [{ type: 'double', count: 1 }],
    },
  },
  {
    name: 'Deluxe Room',
    factor: 1.25,
    minStars: 3,
    room: {
      description: 'A larger room on a higher floor, with a seating corner and a minibar.',
      maxGuests: 2,
      sizeSqm: 28,
      beds: [{ type: 'queen', count: 1 }],
    },
  },
  {
    name: 'Executive Room',
    factor: 1.55,
    minStars: 4,
    room: {
      description: 'A corner room with a city view, a sofa and a rain shower.',
      maxGuests: 2,
      sizeSqm: 34,
      beds: [{ type: 'king', count: 1 }],
    },
  },
  {
    name: 'Family Room',
    factor: 1.45,
    minStars: 2,
    room: {
      description: 'Room for parents and two children, with a bath and extra storage.',
      maxGuests: 4,
      sizeSqm: 40,
      beds: [
        { type: 'double', count: 1 },
        { type: 'single', count: 2 },
      ],
    },
  },
  {
    name: 'Junior Suite',
    factor: 2.1,
    minStars: 4,
    room: {
      description: 'A bedroom and a separate sitting area with a sofa bed and a dining table.',
      maxGuests: 3,
      sizeSqm: 48,
      beds: [
        { type: 'king', count: 1 },
        { type: 'sofa_bed', count: 1 },
      ],
    },
  },
];
/** What kind of place each generated name is. */
const KIND_TYPE: Record<string, PropertyType> = {
  Hotel: 'hotel',
  Suites: 'apartment',
  Resort: 'resort',
  Inn: 'guesthouse',
  Residences: 'apartment',
  Lodge: 'lodge',
  'Hotel & Spa': 'hotel',
};
const AMENITY_WORDS: Record<string, string> = {
  pool: 'an outdoor pool',
  gym: 'a gym',
  spa: 'a spa',
  restaurant: 'a restaurant',
  bar: 'a bar',
  parking: 'free parking',
  airport_shuttle: 'an airport shuttle',
  backup_power: 'backup power',
};
/** Nightly rate for a double room by star rating: [USD, NGN] whole units. */
const NIGHTLY_BASE: Record<number, [number, number]> = {
  2: [45, 35_000],
  3: [85, 65_000],
  4: [150, 120_000],
  5: [260, 220_000],
};

/**
 * Hotel price level by country relative to the USD table (Nigeria prices in naira, so 1). Rough
 * public averages, only to keep sample rates plausible: London should never look like Lagos.
 */
const PRICE_LEVEL: Record<string, number> = {
  GB: 2.3,
  US: 2.2,
  FR: 2.0,
  AE: 1.7,
  QA: 1.6,
  SA: 1.4,
  GH: 1.3,
  TZ: 1.2,
  TR: 1.1,
  KE: 0.9,
  ZA: 0.9,
  RW: 1.0,
  ET: 0.9,
  NG: 1,
};
const DEFAULT_PRICE_LEVEL = 1.3;

/**
 * MOCK hotel supplier: a deterministic, fictional set of hotels around each city (stable per
 * city, prices vary by dates), with star ratings, review scores, amenities, room types, board,
 * refundable and non-refundable rates and tax lines. Nigerian hotels price in NGN with 7.5% VAT;
 * elsewhere USD with 10% tax plus a city tax payable at the property. Each hotel also has a
 * property type, a short description, room details and, when `photoBase` (the website's origin)
 * is set, drawn sample pictures served by the website's `/art/hotels` route (ADR-096).
 */
export class MockHotelSupplier extends HotelSupplier {
  readonly name = 'mock';
  readonly idempotentBooking = true;
  /** Test hook: basis points applied to rates on re-pricing. */
  repriceDriftBps = 0;
  /** Test hook: this many upcoming `book()` calls fail as if the property were unreachable. */
  failNextBookings = 0;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly photoBase: string | null = null,
  ) {
    super();
  }

  search(query: HotelSearchQuery, signal: AbortSignal): Promise<SupplierHotel[]> {
    signal.throwIfAborted();
    const { city } = query;
    if (city.latitude === null || city.longitude === null) return Promise.resolve([]);
    const cityRandom = new SeededRandom(`hotels|${city.id}`);
    const count = cityRandom.int(12, 30);
    const hotels: SupplierHotel[] = [];
    for (let index = 0; index < count; index += 1) {
      const hotel = this.hotel(query, index, cityRandom);
      const rates = hotel.rates.filter((rate) => !query.freeCancellationOnly || rate.refundable);
      if (rates.length > 0) hotels.push({ ...hotel, rates });
    }
    return Promise.resolve(hotels);
  }

  reprice(
    hotel: SupplierHotel,
    rate: SupplierHotelRate,
    query: HotelSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierHotelRate> {
    signal.throwIfAborted();
    const now = this.now().getTime();
    const checkIn = localToUtc(`${query.checkIn}T14:00`, query.city.timeZone ?? 'UTC').getTime();
    if (Date.parse(rate.expiresAt) <= now || checkIn <= now) {
      return Promise.reject(
        new OfferUnavailableError(this.name, `${hotel.name} rate is no longer available`),
      );
    }
    const drift = (amount: Money): Money =>
      multiplyRatio(amount, 10_000 + this.repriceDriftBps, 10_000, 'half-up');
    return Promise.resolve({
      ...rate,
      price: { base: drift(rate.price.base), taxes: drift(rate.price.taxes) },
      expiresAt: new Date(now + OFFER_TTL_MS).toISOString(),
    });
  }

  /** Deterministic confirmation number from the idempotency key: retries never book twice. */
  book(request: HotelBookingRequest, signal: AbortSignal): Promise<HotelBookingResult> {
    signal.throwIfAborted();
    if (this.failNextBookings > 0) {
      this.failNextBookings -= 1;
      return Promise.reject(new SupplierUnavailableError(this.name, 'Mock property is offline'));
    }
    const { query } = request;
    const checkIn = localToUtc(`${query.checkIn}T14:00`, query.city.timeZone ?? 'UTC').getTime();
    if (checkIn <= this.now().getTime()) {
      return Promise.reject(new OfferUnavailableError(this.name, 'Check-in has passed'));
    }
    return Promise.resolve({
      confirmationNumber: `MH${stableCode(`mock-stay|${request.idempotencyKey}`, 8, '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ')}`,
    });
  }

  private hotel(query: HotelSearchQuery, index: number, cityRandom: SeededRandom): SupplierHotel {
    const { city } = query;
    const nigeria = city.countryCode === 'NG';
    const currency = nigeria ? 'NGN' : 'USD';
    const stars = cityRandom.pick([2, 3, 3, 3, 4, 4, 4, 5, 5]);
    const core = cityRandom.pick(NAME_CORES);
    const kind = cityRandom.pick(NAME_KINDS);
    const name = cityRandom.chance(0.4) ? `${city.name} ${core} ${kind}` : `The ${core} ${kind}`;
    const supplierHotelId = stableId('mockhotel', city.id, String(index));
    const amenities = AMENITIES.filter(
      (amenity, position) => position < 3 || cityRandom.chance(0.25 + stars * 0.1),
    );
    const reviewScore =
      Math.round(Math.min(9.7, cityRandom.between(5.8, 7.2) + stars * 0.45) * 10) / 10;

    const nights = daysBetween(query.checkIn, query.checkOut);
    const stayRandom = new SeededRandom(
      `stay|${supplierHotelId}|${query.checkIn}|${query.checkOut}`,
    );
    const [usd, ngn] = NIGHTLY_BASE[stars] ?? [85, 65_000];
    const nightly =
      (nigeria ? ngn : usd) *
      (PRICE_LEVEL[city.countryCode] ?? DEFAULT_PRICE_LEVEL) *
      cityRandom.between(0.8, 1.4) *
      stayRandom.between(0.9, 1.2);
    const freeCancellationUntil = localToUtc(
      `${addDays(query.checkIn, -2)}T23:59`,
      city.timeZone ?? 'UTC',
    );
    const refundableAvailable = freeCancellationUntil.getTime() > this.now().getTime();

    const rates: SupplierHotelRate[] = [];
    for (const room of ROOMS.filter((candidate) => stars >= candidate.minStars)) {
      for (const board of ['room_only', 'breakfast_included'] as BoardType[]) {
        for (const refundable of refundableAvailable ? [true, false] : [false]) {
          const perRoomNight = query.rooms.map((occupancy) => {
            const extraAdults = Math.max(0, occupancy.adults - 2);
            const olderChildren = occupancy.childAges.filter((age) => age >= 6).length;
            return (
              nightly *
              room.factor *
              (1 + 0.2 * extraAdults + 0.15 * olderChildren) *
              (board === 'breakfast_included' ? 1.12 : 1) *
              (refundable ? 1 : 0.88)
            );
          });
          const base = money(
            BigInt(Math.round(perRoomNight.reduce((a, b) => a + b, 0) * nights)) * 100n,
            currency,
          );
          const taxes = percentageOf(base, nigeria ? 750 : 1000, 'half-up');
          const guests = query.rooms.reduce((acc, occupancy) => acc + occupancy.adults, 0);
          rates.push({
            supplierRateId: stableId(
              'mockrate',
              supplierHotelId,
              room.name,
              board,
              String(refundable),
              JSON.stringify(query),
            ),
            roomName: room.name,
            room: room.room,
            board,
            refundable,
            freeCancellationUntil: refundable ? freeCancellationUntil.toISOString() : null,
            price: { base, taxes },
            payAtProperty: nigeria ? null : money(BigInt(2 * guests * nights) * 100n, currency),
            expiresAt: new Date(this.now().getTime() + OFFER_TTL_MS).toISOString(),
          });
        }
      }
    }
    // Place hotels within ~6 km of the city centre.
    const angle = cityRandom.between(0, 2 * Math.PI);
    const radiusKm = cityRandom.between(0.3, 6);
    const latitude = (city.latitude ?? 0) + (radiusKm / 111) * Math.cos(angle);
    const longitude =
      (city.longitude ?? 0) +
      (radiusKm / (111 * Math.cos(((city.latitude ?? 0) * Math.PI) / 180))) * Math.sin(angle);

    // Drawn in the same order as before the content fields existed: prices and names never move.
    const reviewCount = cityRandom.int(12, 2400);
    const area = cityRandom.pick(AREAS);
    const propertyType = KIND_TYPE[kind] ?? 'hotel';
    return {
      supplier: this.name,
      supplierHotelId,
      name,
      stars,
      reviewScore,
      reviewCount,
      latitude: Math.round(latitude * 1e6) / 1e6,
      longitude: Math.round(longitude * 1e6) / 1e6,
      area,
      cityName: city.name,
      countryCode: city.countryCode,
      amenities,
      propertyType,
      description: this.description(name, stars, propertyType, area, city.name, amenities),
      photos: this.photos(supplierHotelId, amenities),
      rates: rates.sort((a, b) => Number(a.price.base.minor - b.price.base.minor)),
    };
  }

  private description(
    name: string,
    stars: number,
    type: PropertyType,
    area: string,
    city: string,
    amenities: readonly string[],
  ): string {
    const has = amenities.flatMap((amenity) => AMENITY_WORDS[amenity] ?? []).slice(0, 4);
    const list =
      has.length > 1 ? `${has.slice(0, -1).join(', ')} and ${has.at(-1) ?? ''}` : (has[0] ?? '');
    return [
      `${name} is a ${stars}-star ${type} in the ${area.toLowerCase()} of ${city}.`,
      list ? `It has ${list}.` : '',
      'Rooms are air-conditioned and have Wi-Fi. This is sample data for testing, not a real property.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** Drawn pictures from the website's art route: an exterior, a room and what the hotel has. */
  private photos(supplierHotelId: string, amenities: readonly string[]): SupplierPhoto[] {
    if (!this.photoBase) return [];
    const seed = stableCode(
      `photos|${supplierHotelId}`,
      10,
      'abcdefghijklmnopqrstuvwxyz0123456789',
    );
    const scenes: [string, string][] = [
      ['exterior', 'The building'],
      ['room', 'A room'],
      ...(amenities.includes('pool') ? ([['pool', 'The pool']] as [string, string][]) : []),
      ...(amenities.includes('restaurant')
        ? ([['dining', 'The restaurant']] as [string, string][])
        : []),
    ];
    return scenes.map(([scene, caption]) => ({
      url: `${this.photoBase}/art/hotels/${seed}-${scene}.svg`,
      caption,
    }));
  }
}
