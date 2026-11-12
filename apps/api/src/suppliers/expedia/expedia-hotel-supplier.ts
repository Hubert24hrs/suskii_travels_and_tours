import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';

import { add, equals, money, parseMoney, subtract, type Money } from '@suskii/shared';

import type { SupplierPrice } from '../../pricing/pricing-engine';
import {
  creating,
  OfferUnavailableError,
  SupplierAmbiguousError,
  SupplierRequestError,
  SupplierUnavailableError,
} from '../supplier.errors';
import {
  HotelSupplier,
  type BoardType,
  type HotelBookingRequest,
  type HotelBookingResult,
  type HotelSearchQuery,
  type SupplierHotel,
  type SupplierHotelRate,
} from '../supplier.types';

import type { ExpediaClient } from './expedia.client';
import {
  expediaAvailabilitySchema,
  expediaContentMapSchema,
  expediaContentSchema,
  expediaGeographySchema,
  expediaItinerarySchema,
  expediaPriceCheckSchema,
  expediaPropertySchema,
  expediaRateSchema,
  type ExpediaContent,
  type ExpediaPricing,
  type ExpediaProperty,
  type ExpediaRate,
} from './expedia.schemas';

/** Rapid answers in this language; names and room descriptions are shown as they come. */
const LANGUAGE = 'en-US';
/** Rapid takes at most 250 property ids per availability or content call. */
const BATCH = 250;
/** Rapid books at most 8 rooms at once. */
const MAX_ROOMS = 8;
/** Rates carry no expiry unless their link says so; they live as long as a search result. */
const RATE_TTL_MS = 30 * 60_000;
/** Free cancellation ends a minute before the first penalty applies. */
const PENALTY_MARGIN_MS = 60_000;
/** Property ids per area and content per property change slowly: kept for a day. */
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 20_000;
/** Rapid caps `affiliate_reference_id` at 28 characters. */
const AFFILIATE_REFERENCE_LENGTH = 28;
/** Points of the polygon that approximates the search circle. */
const POLYGON_POINTS = 16;
const KM_PER_DEGREE = 111.32;

/** Price-check answers that let a booking go ahead (`price_changed` is compared by total). */
const BOOKABLE = new Set(['available', 'available_no_change', 'price_changed']);

/** ITU country calling codes of two digits; 1 and 7 are the one-digit ones, the rest have three. */
const TWO_DIGIT_CALLING_CODES = new Set(
  '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(
    ' ',
  ),
);

export interface ExpediaSupplierOptions {
  /** Traveller's point of sale, ISO 3166-1 alpha-2 (`country_code`). */
  pointOfSale: string;
  /** Currency Rapid converts `request_currency` amounts to; Suskii pays in the billable one. */
  requestCurrency: string;
  radiusKm: number;
  maxProperties: number;
  ratesPerProperty: number;
}

/** A small time-bounded cache kept in memory per process. */
class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  get(key: string, now: number): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, now: number): void {
    if (this.entries.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  }
}

/** `adults[-age,age]`, Rapid's occupancy for one room (and the key of its pricing). */
export const expediaOccupancy = (room: { adults: number; childAges: number[] }): string =>
  room.childAges.length > 0 ? `${room.adults}-${room.childAges.join(',')}` : String(room.adults);

/** A closed GeoJSON ring of `POLYGON_POINTS` points `radiusKm` around a point ([lng, lat]). */
export function expediaSearchPolygon(
  latitude: number,
  longitude: number,
  radiusKm: number,
): number[][] {
  const latRadius = radiusKm / KM_PER_DEGREE;
  const lngRadius =
    radiusKm / (KM_PER_DEGREE * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  const ring: number[][] = [];
  for (let index = 0; index < POLYGON_POINTS; index += 1) {
    const angle = (2 * Math.PI * index) / POLYGON_POINTS;
    const round = (value: number) => Math.round(value * 1e6) / 1e6;
    ring.push([
      round(longitude + lngRadius * Math.cos(angle)),
      round(latitude + latRadius * Math.sin(angle)),
    ]);
  }
  const first = ring[0];
  if (first) ring.push([...first]);
  return ring;
}

/** An E.164 number (`+2348012345678`) as Rapid's phone: country calling code and the rest. */
export function expediaPhone(e164: string): { country_code: string; number: string } {
  const digits = e164.replace(/\D/g, '');
  const length = /^[17]/.test(digits) ? 1 : TWO_DIGIT_CALLING_CODES.has(digits.slice(0, 2)) ? 2 : 3;
  return { country_code: digits.slice(0, length), number: digits.slice(length) };
}

/** The booking item id as Rapid's affiliate reference: letters and digits, at most 28. */
export const expediaAffiliateReference = (idempotencyKey: string): string =>
  idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(0, AFFILIATE_REFERENCE_LENGTH);

/** The board a rate includes, from its amenity names; room only when none says otherwise. */
export function expediaBoard(amenities: ExpediaRate['amenities']): BoardType {
  const names = Object.values(amenities ?? {})
    .map((amenity) => amenity.name?.toLowerCase() ?? '')
    .join(' | ');
  if (/all[ -]inclusive|full board/.test(names)) return 'full_board';
  if (names.includes('half board')) return 'half_board';
  if (names.includes('breakfast')) return 'breakfast_included';
  return 'room_only';
}

/** A Rapid decimal amount in minor units; null when it is not a valid amount. */
function amount(value: { value: string; currency: string }): Money | null {
  try {
    return parseMoney(value.value, value.currency, 'half-up');
  } catch {
    return null;
  }
}

/**
 * The stay's price for every searched room from Rapid's per-occupancy pricing: what Expedia
 * bills Suskii (`billable_currency`), taxes and fees as inclusive minus exclusive, and property
 * fees as pay-at-property. Null when a room's occupancy is missing or currencies differ.
 */
export function expediaStayPrice(
  pricing: Record<string, ExpediaPricing> | undefined,
  rooms: HotelSearchQuery['rooms'],
): { price: SupplierPrice; payAtProperty: Money | null } | null {
  let total: Money | null = null;
  let exclusive: Money | null = null;
  let exclusiveKnown = true;
  let fees: Money | null = null;
  for (const room of rooms) {
    const totals = pricing?.[expediaOccupancy(room)]?.totals;
    const inclusive = totals?.inclusive?.billable_currency;
    const roomTotal = inclusive ? amount(inclusive) : null;
    if (!roomTotal) return null;
    if (total && total.currency !== roomTotal.currency) return null;
    total = total ? add(total, roomTotal) : roomTotal;

    const netValue = totals?.exclusive?.billable_currency;
    const net = netValue ? amount(netValue) : null;
    if (net?.currency === roomTotal.currency && exclusiveKnown) {
      exclusive = exclusive ? add(exclusive, net) : net;
    } else {
      exclusiveKnown = false;
    }
    const dueValue =
      totals?.property_fees?.billable_currency ?? totals?.property_fees?.request_currency;
    const due = dueValue ? amount(dueValue) : null;
    if (due && (!fees || fees.currency === due.currency)) {
      fees = fees ? add(fees, due) : due;
    }
  }
  if (!total || total.minor <= 0n) return null;
  const taxes =
    exclusiveKnown && exclusive && exclusive.minor <= total.minor
      ? subtract(total, exclusive)
      : money(0, total.currency);
  return {
    price: { base: subtract(total, taxes), taxes },
    payAtProperty: fees && fees.minor > 0n ? fees : null,
  };
}

/** Free cancellation until a minute before the first penalty, when the rate is refundable. */
export function expediaFreeCancellationUntil(rate: ExpediaRate, now: number): string | null {
  if (rate.refundable !== true) return null;
  const starts = (rate.cancel_penalties ?? [])
    .map((penalty) => Date.parse(penalty.start ?? ''))
    .filter((start) => !Number.isNaN(start));
  if (starts.length === 0) return null;
  const freeUntil = Math.min(...starts) - PENALTY_MARGIN_MS;
  return freeUntil > now ? new Date(freeUntil).toISOString() : null;
}

/**
 * Expedia Rapid (Expedia Partner Solutions) hotels, ADR-086. Enabled when HOTEL_SUPPLIERS
 * includes `expedia`. Search turns the city into property ids (geography), shops their
 * Expedia Collect rates and names them from the content API; each bed group's price-check link
 * is a rate. Booking re-checks the price and books under `affiliate_collect` with the
 * traveller's IP, which Rapid requires on booking calls.
 */
export class ExpediaHotelSupplier extends HotelSupplier {
  readonly name = 'expedia';
  /** Rapid takes no idempotency key: an ambiguous booking failure goes to review. */
  readonly idempotentBooking = false;
  override readonly needsCustomerIp = true;
  private readonly logger = new Logger(ExpediaHotelSupplier.name);
  private readonly areas = new TtlCache<string[]>();
  private readonly contents = new TtlCache<ExpediaContent | null>();

  constructor(
    private readonly client: ExpediaClient,
    private readonly options: ExpediaSupplierOptions,
  ) {
    super();
  }

  async search(query: HotelSearchQuery, signal: AbortSignal): Promise<SupplierHotel[]> {
    const { latitude, longitude } = query.city;
    // Our cities are coordinates, not Rapid regions: without them there is nothing to search.
    if (latitude === null || longitude === null) return [];
    if (query.rooms.length === 0 || query.rooms.length > MAX_ROOMS) return [];
    const sessionId = `search-${randomUUID()}`;
    const ids = await this.propertyIds(latitude, longitude, signal, sessionId);
    if (ids.length === 0) return [];

    const params = new URLSearchParams({
      checkin: query.checkIn,
      checkout: query.checkOut,
      currency: this.options.requestCurrency,
      country_code: this.options.pointOfSale,
      language: LANGUAGE,
      rate_plan_count: String(this.options.ratesPerProperty),
      sales_channel: 'website',
      sales_environment: 'hotel_only',
    });
    for (const room of query.rooms) params.append('occupancy', expediaOccupancy(room));
    for (const id of ids.slice(0, Math.min(this.options.maxProperties, BATCH))) {
      params.append('property_id', id);
    }
    // Only rates Expedia collects can be resold and invoiced to Suskii (affiliate collect).
    params.append('filter', 'expedia_collect');
    if (query.freeCancellationOnly) params.append('filter', 'refundable');
    const raw = await this.client.request({
      method: 'GET',
      path: `/v3/properties/availability?${params.toString()}`,
      signal,
      sessionId,
    });
    const list = expediaAvailabilitySchema.safeParse(raw ?? []);
    if (!list.success) {
      throw new SupplierUnavailableError(this.name, 'Expedia returned an invalid availability');
    }
    const properties: ExpediaProperty[] = [];
    for (const item of list.data) {
      const property = expediaPropertySchema.safeParse(item);
      if (property.success && (property.data.rooms?.length ?? 0) > 0)
        properties.push(property.data);
    }
    if (properties.length === 0) return [];

    const content = await this.content(
      properties.map((property) => property.property_id),
      signal,
      sessionId,
    );
    const now = Date.now();
    const hotels: SupplierHotel[] = [];
    for (const property of properties) {
      const details = content.get(property.property_id);
      if (!details) continue;
      const hotel = this.toHotel(property, details, query, now);
      if (hotel) hotels.push(hotel);
    }
    return hotels;
  }

  /** Re-checks a rate before the quote: a new price is returned, a sold-out rate refused. */
  async reprice(
    hotel: SupplierHotel,
    rate: SupplierHotelRate,
    query: HotelSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierHotelRate> {
    const check = await this.priceCheck(rate, signal, `quote-${randomUUID()}`, null);
    if (!BOOKABLE.has(check.status)) {
      this.logger.debug(
        { hotel: hotel.supplierHotelId, status: check.status },
        'Expedia rate gone',
      );
      throw new OfferUnavailableError(this.name, 'The rate is no longer available');
    }
    const priced = expediaStayPrice(check.occupancy_pricing, query.rooms);
    return {
      ...rate,
      ...(priced ? { price: priced.price, payAtProperty: priced.payAtProperty } : {}),
      expiresAt: new Date(Date.now() + RATE_TTL_MS).toISOString(),
    };
  }

  /**
   * Books a paid stay: a fresh price check first, refused when the total moved since the
   * traveller paid, then the itinerary under `affiliate_collect`.
   */
  async book(request: HotelBookingRequest, signal: AbortSignal): Promise<HotelBookingResult> {
    if (!request.customerIp) {
      throw new SupplierRequestError(this.name, "Expedia needs the traveller's IP to book");
    }
    const [lead] = request.guests;
    if (!lead) throw new SupplierUnavailableError(this.name, 'The booking has no lead guest');
    const sessionId = `booking-${expediaAffiliateReference(request.idempotencyKey)}`;
    const check = await this.priceCheck(request.rate, signal, sessionId, request.customerIp);
    if (!BOOKABLE.has(check.status)) {
      throw new OfferUnavailableError(this.name, 'The rate is no longer available');
    }
    const priced = expediaStayPrice(check.occupancy_pricing, request.query.rooms);
    const paid = add(request.rate.price.base, request.rate.price.taxes);
    if (priced && !equals(add(priced.price.base, priced.price.taxes), paid)) {
      throw new OfferUnavailableError(this.name, 'The price changed since payment');
    }
    const bookLink = check.links?.book?.href;
    if (!bookLink) throw new SupplierUnavailableError(this.name, 'Expedia sent no booking link');

    const guests = request.query.rooms.map((_, index) => request.guests[index] ?? lead);
    // Rapid takes no idempotency key: a failure after sending may have booked (review, no retry).
    const created = await creating(this.name, () =>
      this.client.request({
        method: 'POST',
        path: bookLink,
        signal,
        sessionId,
        customerIp: request.customerIp,
        body: {
          affiliate_reference_id: expediaAffiliateReference(request.idempotencyKey),
          hold: false,
          email: request.contact.email,
          phone: expediaPhone(request.contact.phone),
          rooms: guests.map((guest) => ({
            given_name: guest.givenNames,
            family_name: guest.surname,
            smoking: false,
          })),
          payments: [
            {
              type: 'affiliate_collect',
              billing_contact: {
                given_name: lead.givenNames,
                family_name: lead.surname,
                address: { country_code: this.options.pointOfSale },
              },
            },
          ],
        },
      }),
    );
    const itinerary = expediaItinerarySchema.safeParse(created);
    if (!itinerary.success) {
      // The booking may exist: an unreadable answer is ambiguous and goes to review.
      throw new SupplierAmbiguousError(this.name, 'Expedia returned an invalid itinerary');
    }
    return { confirmationNumber: itinerary.data.itinerary_id };
  }

  private async priceCheck(
    rate: SupplierHotelRate,
    signal: AbortSignal,
    sessionId: string,
    customerIp: string | null,
  ) {
    const raw = await this.client.request({
      method: 'GET',
      path: rate.supplierRateId,
      signal,
      sessionId,
      customerIp,
    });
    const check = expediaPriceCheckSchema.safeParse(raw);
    if (!check.success) {
      throw new SupplierUnavailableError(this.name, 'Expedia returned an invalid price check');
    }
    return check.data;
  }

  /** Property ids within the search radius of a point, cached per rounded point and radius. */
  private async propertyIds(
    latitude: number,
    longitude: number,
    signal: AbortSignal,
    sessionId: string,
  ): Promise<string[]> {
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)},${this.options.radiusKm}`;
    const now = Date.now();
    const cached = this.areas.get(key, now);
    if (cached) return cached;
    const raw = await this.client.request({
      method: 'POST',
      path: '/v3/properties/geography?include=property_ids&supply_source=expedia',
      signal,
      sessionId,
      body: {
        type: 'Polygon',
        coordinates: [expediaSearchPolygon(latitude, longitude, this.options.radiusKm)],
      },
    });
    const parsed = expediaGeographySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new SupplierUnavailableError(this.name, 'Expedia returned an invalid geography');
    }
    const ids = Object.keys(parsed.data);
    this.areas.set(key, ids, now);
    return ids;
  }

  /** Names, ratings and locations, cached per property; missing ones are fetched together. */
  private async content(
    ids: string[],
    signal: AbortSignal,
    sessionId: string,
  ): Promise<Map<string, ExpediaContent>> {
    const now = Date.now();
    const found = new Map<string, ExpediaContent>();
    const missing: string[] = [];
    for (const id of ids) {
      const cached = this.contents.get(id, now);
      if (cached === undefined) missing.push(id);
      else if (cached) found.set(id, cached);
    }
    for (let start = 0; start < missing.length; start += BATCH) {
      const batch = missing.slice(start, start + BATCH);
      const params = new URLSearchParams({ language: LANGUAGE, supply_source: 'expedia' });
      for (const field of ['name', 'address', 'ratings', 'location']) {
        params.append('include', field);
      }
      for (const id of batch) params.append('property_id', id);
      const raw = await this.client.request({
        method: 'GET',
        path: `/v3/properties/content?${params.toString()}`,
        signal,
        sessionId,
      });
      const map = expediaContentMapSchema.safeParse(raw ?? {});
      if (!map.success) {
        throw new SupplierUnavailableError(this.name, 'Expedia returned invalid content');
      }
      for (const id of batch) {
        const content = expediaContentSchema.safeParse(map.data[id]);
        this.contents.set(id, content.success ? content.data : null, now);
        if (content.success) found.set(id, content.data);
      }
    }
    return found;
  }

  private toHotel(
    property: ExpediaProperty,
    content: ExpediaContent,
    query: HotelSearchQuery,
    now: number,
  ): SupplierHotel | null {
    const rates: SupplierHotelRate[] = [];
    for (const room of property.rooms ?? []) {
      for (const raw of room.rates ?? []) {
        const rate = expediaRateSchema.safeParse(raw);
        if (rate.success)
          rates.push(...this.toRates(room.room_name ?? 'Room', rate.data, query, now));
      }
    }
    const sellable = query.freeCancellationOnly ? rates.filter((rate) => rate.refundable) : rates;
    if (sellable.length === 0) return null;
    const coordinates = content.location?.coordinates;
    const stars = Number.parseFloat(content.ratings?.property?.rating ?? '');
    const guest = Number.parseFloat(content.ratings?.guest?.overall ?? '');
    return {
      supplier: this.name,
      supplierHotelId: property.property_id,
      name: content.name,
      stars: Number.isFinite(stars) ? Math.min(5, Math.max(0, Math.floor(stars))) : 0,
      // Rapid rates guests out of 5; our score is out of 10.
      reviewScore: Number.isFinite(guest) ? Math.round(guest * 20) / 10 : null,
      reviewCount: content.ratings?.guest?.count ?? 0,
      latitude: coordinates?.latitude ?? query.city.latitude ?? 0,
      longitude: coordinates?.longitude ?? query.city.longitude ?? 0,
      area: content.address?.line_1 ?? null,
      cityName: content.address?.city ?? query.city.name,
      countryCode: content.address?.country_code ?? query.city.countryCode,
      amenities: [],
      rates: sellable,
    };
  }

  /** One sellable rate per bed group: Expedia is merchant, the price covers every room. */
  private toRates(
    roomName: string,
    rate: ExpediaRate,
    query: HotelSearchQuery,
    now: number,
  ): SupplierHotelRate[] {
    if (rate.merchant_of_record && rate.merchant_of_record !== 'expedia') return [];
    const priced = expediaStayPrice(rate.occupancy_pricing, query.rooms);
    if (!priced) return [];
    const freeUntil = expediaFreeCancellationUntil(rate, now);
    const board = expediaBoard(rate.amenities);
    const rates: SupplierHotelRate[] = [];
    for (const bed of Object.values(rate.bed_groups ?? {})) {
      const link = bed.links?.price_check;
      if (!link) continue;
      const expires = link.expires ? Date.parse(link.expires) : Number.NaN;
      rates.push({
        supplierRateId: link.href,
        roomName: bed.description ? `${roomName} (${bed.description})` : roomName,
        board,
        refundable: freeUntil !== null,
        freeCancellationUntil: freeUntil,
        price: priced.price,
        payAtProperty: priced.payAtProperty,
        expiresAt: new Date(
          Number.isNaN(expires) ? now + RATE_TTL_MS : Math.min(expires, now + RATE_TTL_MS),
        ).toISOString(),
      });
    }
    return rates;
  }
}
