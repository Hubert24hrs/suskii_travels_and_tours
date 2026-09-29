import {
  addDays,
  daysBetween,
  localToUtc,
  money,
  multiplyRatio,
  percentageOf,
  type Money,
} from '@suskii/shared';

import { OfferUnavailableError } from '../supplier.errors';
import {
  HotelSupplier,
  type BoardType,
  type HotelSearchQuery,
  type SupplierHotel,
  type SupplierHotelRate,
} from '../supplier.types';

import { SeededRandom, stableId } from './random';

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
const ROOMS: { name: string; factor: number; minStars: number }[] = [
  { name: 'Standard Room', factor: 1, minStars: 1 },
  { name: 'Deluxe Room', factor: 1.25, minStars: 3 },
  { name: 'Executive Room', factor: 1.55, minStars: 4 },
  { name: 'Family Room', factor: 1.45, minStars: 2 },
  { name: 'Junior Suite', factor: 2.1, minStars: 4 },
];
/** Nightly rate for a double room by star rating: [USD, NGN] whole units. */
const NIGHTLY_BASE: Record<number, [number, number]> = {
  2: [45, 35_000],
  3: [85, 65_000],
  4: [150, 120_000],
  5: [260, 220_000],
};

/**
 * MOCK hotel supplier: a deterministic, fictional set of hotels around each city (stable per
 * city, prices vary by dates), with star ratings, review scores, amenities, room types, board,
 * refundable and non-refundable rates and tax lines. Nigerian hotels price in NGN with 7.5% VAT;
 * elsewhere USD with 10% tax plus a city tax payable at the property.
 */
export class MockHotelSupplier extends HotelSupplier {
  readonly name = 'mock';
  /** Test hook: basis points applied to rates on re-pricing. */
  repriceDriftBps = 0;

  constructor(private readonly now: () => Date = () => new Date()) {
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
      (nigeria ? ngn : usd) * cityRandom.between(0.8, 1.4) * stayRandom.between(0.9, 1.2);
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

    return {
      supplier: this.name,
      supplierHotelId,
      name,
      stars,
      reviewScore,
      reviewCount: cityRandom.int(12, 2400),
      latitude: Math.round(latitude * 1e6) / 1e6,
      longitude: Math.round(longitude * 1e6) / 1e6,
      area: cityRandom.pick(AREAS),
      cityName: city.name,
      countryCode: city.countryCode,
      amenities,
      rates: rates.sort((a, b) => Number(a.price.base.minor - b.price.base.minor)),
    };
  }
}
