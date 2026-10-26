import { Logger } from '@nestjs/common';

import { add, compare, equals, money, parseMoney, subtract, type Money } from '@suskii/shared';

import type { SupplierPrice } from '../../pricing/pricing-engine';
import {
  OfferUnavailableError,
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

import type { DuffelClient } from './duffel.client';
import {
  duffelStaysAllRatesSchema,
  duffelStaysBookingSchema,
  duffelStaysQuoteSchema,
  duffelStaysRateSchema,
  duffelStaysSearchResultSchema,
  type DuffelStaysQuote,
  type DuffelStaysRoom,
  type DuffelStaysSearchResult,
} from './duffel-stays.schemas';

/** Kilometres around the city centre (Duffel's location search takes a radius in km). */
const SEARCH_RADIUS_KM = 10;
/** Marks the stand-in rate built from a search result's cheapest price. */
const CHEAPEST = 'cheapest:';

const BOARDS: Record<string, BoardType> = {
  room_only: 'room_only',
  breakfast: 'breakfast_included',
  half_board: 'half_board',
  full_board: 'full_board',
  // Our boards stop at full board; all inclusive includes at least that.
  all_inclusive: 'full_board',
};

/** Duffel amenity types we have copy for, in our own vocabulary. */
const AMENITIES: Record<string, string> = {
  wifi: 'wifi',
  parking: 'parking',
  gym: 'gym',
  pool: 'pool',
  spa: 'spa',
  restaurant: 'restaurant',
  room_service: 'room_service',
  laundry: 'laundry',
  business_centre: 'business_centre',
  '24_hour_front_desk': '24h_front_desk',
};

const amount = (value: string, currency: string): Money => parseMoney(value, currency, 'half-up');

const instant = (value: string): string => new Date(value).toISOString();

const dataOf = (response: unknown): unknown => (response as { data?: unknown } | null)?.data;

/** Base and taxes from a total; taxes count only when in the total's currency and below it. */
function priceOf(total: Money, taxes: Money | null): SupplierPrice {
  const fair =
    taxes?.currency === total.currency && taxes.minor >= 0n && taxes.minor <= total.minor
      ? taxes
      : money(0, total.currency);
  return { base: subtract(total, fair), taxes: fair };
}

/** Taxes and fees together, as far as Duffel states them in the total's currency. */
function taxesOf(
  totalCurrency: string,
  parts: { value: string | null | undefined; currency: string | null | undefined }[],
): Money {
  return parts.reduce(
    (sum, part) =>
      part.value && (part.currency ?? totalCurrency) === totalCurrency
        ? add(sum, amount(part.value, totalCurrency))
        : sum,
    money(0, totalCurrency),
  );
}

function dueAtProperty(value: string | null | undefined, currency: string | null | undefined) {
  if (!value || !currency) return null;
  const due = amount(value, currency);
  return due.minor > 0n ? due : null;
}

/**
 * Duffel Stays (hotels), after the types in Duffel's SDK. Enabled when HOTEL_SUPPLIERS includes
 * `duffel` (DUFFEL_API_TOKEN required). Only rates paid in full now from the Duffel balance are
 * offered, since the traveller pays Suskii and Suskii pays Duffel; pay-at-hotel, deposit and
 * loyalty-only rates are left out. Search returns each hotel's cheapest price, so hotels come
 * back with `ratesComplete: false` and the hotel page loads every rate through `rates()`.
 */
export class DuffelHotelSupplier extends HotelSupplier {
  readonly name = 'duffel';
  /** Duffel Stays takes no idempotency key, so an ambiguous booking failure goes to review. */
  readonly idempotentBooking = false;
  private readonly logger = new Logger(DuffelHotelSupplier.name);

  constructor(private readonly client: DuffelClient) {
    super();
  }

  async search(query: HotelSearchQuery, signal: AbortSignal): Promise<SupplierHotel[]> {
    const { latitude, longitude } = query.city;
    if (latitude === null || longitude === null) {
      throw new SupplierRequestError(this.name, 'The city has no coordinates to search around');
    }
    const response = await this.client.request('POST', '/stays/search', signal, {
      data: {
        rooms: query.rooms.length,
        guests: query.rooms.flatMap((room) => [
          ...Array.from({ length: room.adults }, () => ({ type: 'adult' })),
          ...room.childAges.map((age) => ({ type: 'child', age })),
        ]),
        check_in_date: query.checkIn,
        check_out_date: query.checkOut,
        location: { radius: SEARCH_RADIUS_KM, geographic_coordinates: { latitude, longitude } },
        free_cancellation_only: query.freeCancellationOnly,
      },
    });
    const results = (dataOf(response) as { results?: unknown } | undefined)?.results;
    if (!Array.isArray(results)) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned no results array');
    }
    const now = Date.now();
    const hotels: SupplierHotel[] = [];
    let invalid = 0;
    for (const raw of results) {
      const parsed = duffelStaysSearchResultSchema.safeParse(raw);
      if (parsed.success) hotels.push(this.toHotel(parsed.data, query, now));
      else invalid += 1;
    }
    if (invalid > 0) {
      this.logger.warn(
        { invalid, total: results.length },
        'Skipped Duffel stays that failed validation',
      );
    }
    return hotels;
  }

  /** Every bookable rate of one search result (`fetch_all_rates`). */
  override async rates(
    hotel: SupplierHotel,
    query: HotelSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierHotelRate[]> {
    if (!hotel.supplierResultId) {
      throw new SupplierRequestError(this.name, 'The hotel has no Duffel search result');
    }
    const response = await this.client.request(
      'POST',
      `/stays/search_results/${encodeURIComponent(hotel.supplierResultId)}/actions/fetch_all_rates`,
      signal,
    );
    const parsed = duffelStaysAllRatesSchema.safeParse(dataOf(response));
    if (!parsed.success) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned invalid rates');
    }
    const rates = this.roomRates(parsed.data.accommodation.rooms ?? [], Date.now());
    return query.freeCancellationOnly ? rates.filter((rate) => rate.refundable) : rates;
  }

  /**
   * Confirms a rate with a Duffel quote. The stand-in from search first resolves to the cheapest
   * bookable rate of the hotel, so the quote always names a real rate.
   */
  async reprice(
    hotel: SupplierHotel,
    rate: SupplierHotelRate,
    query: HotelSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierHotelRate> {
    let target = rate;
    if (rate.supplierRateId.startsWith(CHEAPEST)) {
      const rates = await this.rates(hotel, query, signal);
      const cheapest = rates.reduce<SupplierHotelRate | undefined>(
        (best, candidate) =>
          best &&
          compare(
            add(best.price.base, best.price.taxes),
            add(candidate.price.base, candidate.price.taxes),
          ) <= 0
            ? best
            : candidate,
        undefined,
      );
      if (!cheapest) throw new OfferUnavailableError(this.name, 'No bookable rate is left');
      target = cheapest;
    }
    const quote = await this.quote(target.supplierRateId, signal);
    const total = amount(quote.total_amount, quote.total_currency);
    return {
      ...target,
      price: priceOf(total, this.quoteTaxes(quote)),
      payAtProperty: dueAtProperty(
        quote.due_at_accommodation_amount,
        quote.due_at_accommodation_currency,
      ),
    };
  }

  /**
   * Books a paid stay from the Duffel balance. The rate is quoted again first: a total that no
   * longer matches what the traveller paid is refused rather than charged.
   */
  async book(request: HotelBookingRequest, signal: AbortSignal): Promise<HotelBookingResult> {
    if (request.rate.supplierRateId.startsWith(CHEAPEST)) {
      throw new SupplierRequestError(this.name, 'The rate was never confirmed with a quote');
    }
    const quote = await this.quote(request.rate.supplierRateId, signal);
    const total = amount(quote.total_amount, quote.total_currency);
    if (!equals(total, add(request.rate.price.base, request.rate.price.taxes))) {
      throw new SupplierRequestError(this.name, 'The stay price changed after payment');
    }
    const created = await this.client.request('POST', '/stays/bookings', signal, {
      data: {
        quote_id: quote.id,
        guests: request.guests.map((guest) => ({
          given_name: guest.givenNames,
          family_name: guest.surname,
        })),
        email: request.contact.email,
        phone_number: request.contact.phone,
        metadata: { suskii_booking_item: request.idempotencyKey },
      },
    });
    const booking = duffelStaysBookingSchema.safeParse(dataOf(created));
    if (!booking.success) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid booking');
    }
    // Anything but confirmed leaves the outcome unclear: it goes to review, never to a retry.
    if (booking.data.status !== 'confirmed') {
      throw new SupplierUnavailableError(this.name, `Duffel booking is ${booking.data.status}`);
    }
    return { confirmationNumber: booking.data.reference ?? booking.data.id };
  }

  private async quote(rateId: string, signal: AbortSignal): Promise<DuffelStaysQuote> {
    const response = await this.client.request('POST', '/stays/quotes', signal, {
      data: { rate_id: rateId },
    });
    const parsed = duffelStaysQuoteSchema.safeParse(dataOf(response));
    if (!parsed.success) {
      throw new SupplierUnavailableError(this.name, 'Duffel returned an invalid quote');
    }
    return parsed.data;
  }

  private quoteTaxes(quote: DuffelStaysQuote): Money {
    return taxesOf(quote.total_currency, [
      { value: quote.tax_amount, currency: quote.tax_currency },
      { value: quote.fee_amount, currency: quote.fee_currency },
    ]);
  }

  private toHotel(
    result: DuffelStaysSearchResult,
    query: HotelSearchQuery,
    now: number,
  ): SupplierHotel {
    const { accommodation } = result;
    const coordinates = accommodation.location.geographic_coordinates;
    const rates = this.roomRates(accommodation.rooms ?? [], now);
    return {
      supplier: this.name,
      supplierHotelId: accommodation.id,
      supplierResultId: result.id,
      ratesComplete: false,
      name: accommodation.name,
      stars: Math.max(0, Math.min(5, Math.round(accommodation.rating ?? 0))),
      reviewScore: accommodation.review_score ?? null,
      reviewCount: accommodation.review_count ?? 0,
      latitude: coordinates?.latitude ?? query.city.latitude ?? 0,
      longitude: coordinates?.longitude ?? query.city.longitude ?? 0,
      area: null,
      cityName: accommodation.location.address.city_name,
      countryCode: accommodation.location.address.country_code.toUpperCase(),
      amenities: [
        ...new Set(
          (accommodation.amenities ?? [])
            .map((amenity) => AMENITIES[amenity.type])
            .filter((amenity): amenity is string => amenity !== undefined),
        ),
      ],
      rates: rates.length > 0 ? rates : [this.cheapestRate(result, query)],
    };
  }

  /** The hotel's cheapest price as a rate to list; quoting it picks the real rate first. */
  private cheapestRate(
    result: DuffelStaysSearchResult,
    query: HotelSearchQuery,
  ): SupplierHotelRate {
    const total = amount(result.cheapest_rate_total_amount, result.cheapest_rate_currency);
    const base =
      result.cheapest_rate_base_amount &&
      (result.cheapest_rate_base_currency ?? result.cheapest_rate_currency) ===
        result.cheapest_rate_currency
        ? amount(result.cheapest_rate_base_amount, result.cheapest_rate_currency)
        : null;
    return {
      supplierRateId: `${CHEAPEST}${result.id}`,
      roomName: 'Cheapest available room',
      board: 'room_only',
      // A free-cancellation search returns only free-cancellation rates.
      refundable: query.freeCancellationOnly,
      freeCancellationUntil: null,
      price: priceOf(total, base ? subtract(total, base) : null),
      payAtProperty: dueAtProperty(
        result.cheapest_rate_due_at_accommodation_amount,
        result.cheapest_rate_due_at_accommodation_currency,
      ),
      expiresAt: instant(result.expires_at),
    };
  }

  private roomRates(rooms: DuffelStaysRoom[], now: number): SupplierHotelRate[] {
    const rates: SupplierHotelRate[] = [];
    let skipped = 0;
    for (const room of rooms) {
      for (const raw of room.rates) {
        const parsed = duffelStaysRateSchema.safeParse(raw);
        const rate = parsed.success ? this.toRate(room.name, parsed.data, now) : null;
        if (rate) rates.push(rate);
        else skipped += 1;
      }
    }
    if (skipped > 0) this.logger.debug({ skipped }, 'Left out Duffel rates we cannot sell');
    return rates;
  }

  /** A rate we can sell: paid in full now from the Duffel balance, with a board we know. */
  private toRate(
    roomName: string,
    rate: ReturnType<typeof duffelStaysRateSchema.parse>,
    now: number,
  ): SupplierHotelRate | null {
    const board = BOARDS[rate.board_type];
    const payable =
      rate.payment_type === 'pay_now' &&
      (rate.available_payment_methods ?? []).includes('balance') &&
      rate.loyalty_programme_required !== true;
    if (!board || !payable) return null;
    const total = amount(rate.total_amount, rate.total_currency);
    // Free cancellation: a full refund before a deadline still ahead; the latest one counts.
    let freeUntil: number | null = null;
    for (const entry of rate.cancellation_timeline ?? []) {
      const before = Date.parse(entry.before);
      if (entry.currency !== total.currency || Number.isNaN(before) || before <= now) continue;
      if (compare(amount(entry.refund_amount, entry.currency), total) >= 0) {
        freeUntil = Math.max(freeUntil ?? 0, before);
      }
    }
    return {
      supplierRateId: rate.id,
      roomName,
      board,
      refundable: freeUntil !== null,
      freeCancellationUntil: freeUntil === null ? null : new Date(freeUntil).toISOString(),
      price: priceOf(
        total,
        taxesOf(rate.total_currency, [
          { value: rate.tax_amount, currency: rate.tax_currency },
          { value: rate.fee_amount, currency: rate.fee_currency },
        ]),
      ),
      payAtProperty: dueAtProperty(
        rate.due_at_accommodation_amount,
        rate.due_at_accommodation_currency,
      ),
      expiresAt: instant(rate.expires_at),
    };
  }
}
