import { Logger } from '@nestjs/common';

import { add, money, parseMoney, subtract, type Money } from '@suskii/shared';

import type { SupplierPrice } from '../../pricing/pricing-engine';
import { OfferUnavailableError, SupplierUnavailableError } from '../supplier.errors';
import {
  HotelSupplier,
  type BoardType,
  type HotelBookingRequest,
  type HotelBookingResult,
  type HotelSearchQuery,
  type SupplierHotel,
  type SupplierHotelRate,
} from '../supplier.types';

import type { HotelbedsClient } from './hotelbeds.client';
import {
  hotelbedsAvailabilitySchema,
  hotelbedsBookingSchema,
  hotelbedsCheckRateSchema,
  hotelbedsHotelSchema,
  hotelbedsRateSchema,
  type HotelbedsHotel,
  type HotelbedsRate,
  type HotelbedsRoom,
} from './hotelbeds.schemas';

const API = '/hotel-api/1.0';
/** Hotelbeds rates carry no expiry; they are offered as long as a search result lives. */
const RATE_TTL_MS = 30 * 60_000;
/** Free cancellation ends a minute before the first penalty applies. */
const PENALTY_MARGIN_MS = 60_000;
/** Hotelbeds caps `clientReference` at 20 characters. */
const CLIENT_REFERENCE_LENGTH = 20;

/** Hotelbeds board codes (English and Spanish) in our vocabulary; others are not sold. */
const BOARDS: Record<string, BoardType> = {
  RO: 'room_only',
  SC: 'room_only',
  BB: 'breakfast_included',
  CB: 'breakfast_included',
  AB: 'breakfast_included',
  BH: 'breakfast_included',
  DB: 'breakfast_included',
  HB: 'half_board',
  MP: 'half_board',
  FB: 'full_board',
  PC: 'full_board',
  // Our boards stop at full board; all inclusive includes at least that.
  AI: 'full_board',
  TI: 'full_board',
};

const amount = (value: string, currency: string): Money => parseMoney(value, currency, 'half-up');

/** Stars from a category code such as `4EST` or `5LUJ`: the leading digit, else 0. */
export function hotelbedsStars(categoryCode: string | undefined): number {
  const digit = /^([1-5])/.exec(categoryCode ?? '')?.[1];
  return digit ? Number(digit) : 0;
}

/** The booking item id as a Hotelbeds client reference: hex only, at most 20 characters. */
export function hotelbedsClientReference(idempotencyKey: string): string {
  return idempotencyKey.replace(/[^A-Za-z0-9]/g, '').slice(0, CLIENT_REFERENCE_LENGTH);
}

/** Every room has the same adults and child ages: Hotelbeds prices them as one occupancy. */
function uniformRooms(query: HotelSearchQuery): { adults: number; childAges: number[] } | null {
  const [first, ...rest] = query.rooms;
  if (!first) return null;
  const key = (room: { adults: number; childAges: number[] }) =>
    `${room.adults}:${[...room.childAges].sort((a, b) => a - b).join(',')}`;
  return rest.every((room) => key(room) === key(first)) ? first : null;
}

/**
 * Hotelbeds APItude (hotels), ADR-071. Enabled when HOTEL_SUPPLIERS includes `hotelbeds`
 * (HOTELBEDS_API_KEY and HOTELBEDS_API_SECRET required). Hotelbeds sells net rates, so the
 * markup comes from our pricing rules. Only rates paid to Hotelbeds now (`AT_WEB`) are sold:
 * the traveller pays Suskii and Suskii pays Hotelbeds. Search returns every rate, so hotels are
 * complete (no second rates call).
 */
export class HotelbedsHotelSupplier extends HotelSupplier {
  readonly name = 'hotelbeds';
  /** Hotelbeds takes no idempotency key, so an ambiguous booking failure goes to review. */
  readonly idempotentBooking = false;
  private readonly logger = new Logger(HotelbedsHotelSupplier.name);

  constructor(
    private readonly client: HotelbedsClient,
    private readonly radiusKm: number,
  ) {
    super();
  }

  async search(query: HotelSearchQuery, signal: AbortSignal): Promise<SupplierHotel[]> {
    const { latitude, longitude } = query.city;
    // Our cities are not Hotelbeds destination codes: without coordinates, nothing to search.
    if (latitude === null || longitude === null) return [];
    const occupancy = uniformRooms(query);
    // One occupancy covers several rooms only when they are alike (and, to be safe, childless).
    if (!occupancy || (query.rooms.length > 1 && occupancy.childAges.length > 0)) {
      this.logger.debug({ rooms: query.rooms.length }, 'Hotelbeds skipped a mixed-room search');
      return [];
    }
    const response = await this.client.request('POST', `${API}/hotels`, signal, {
      stay: { checkIn: query.checkIn, checkOut: query.checkOut },
      occupancies: [
        {
          rooms: query.rooms.length,
          adults: occupancy.adults,
          children: occupancy.childAges.length,
          ...(occupancy.childAges.length > 0
            ? { paxes: occupancy.childAges.map((age) => ({ type: 'CH', age })) }
            : {}),
        },
      ],
      geolocation: { latitude, longitude, radius: this.radiusKm, unit: 'km' },
      filter: { paymentType: 'AT_WEB' },
    });
    const parsed = hotelbedsAvailabilitySchema.safeParse(response);
    if (!parsed.success) {
      throw new SupplierUnavailableError(this.name, 'Hotelbeds returned an invalid availability');
    }
    const now = Date.now();
    const hotels: SupplierHotel[] = [];
    let invalid = 0;
    for (const raw of parsed.data.hotels?.hotels ?? []) {
      const hotel = hotelbedsHotelSchema.safeParse(raw);
      if (!hotel.success) {
        invalid += 1;
        continue;
      }
      const mapped = this.toHotel(hotel.data, query, now);
      if (mapped) hotels.push(mapped);
    }
    if (invalid > 0) {
      this.logger.warn({ invalid }, 'Skipped Hotelbeds hotels that failed validation');
    }
    return hotels;
  }

  /** Confirms the rate with `checkrates` (required for RECHECK rates, current for the rest). */
  async reprice(
    hotel: SupplierHotel,
    rate: SupplierHotelRate,
    query: HotelSearchQuery,
    signal: AbortSignal,
  ): Promise<SupplierHotelRate> {
    const response = await this.client.request('POST', `${API}/checkrates`, signal, {
      rooms: [{ rateKey: rate.supplierRateId }],
    });
    const parsed = hotelbedsCheckRateSchema.safeParse(response);
    if (!parsed.success) {
      throw new SupplierUnavailableError(this.name, 'Hotelbeds returned an invalid rate check');
    }
    const currency = parsed.data.hotel.currency;
    const now = Date.now();
    for (const room of parsed.data.hotel.rooms ?? []) {
      for (const raw of room.rates ?? []) {
        const checked = hotelbedsRateSchema.safeParse(raw);
        if (!checked.success || !currency) continue;
        const fresh = this.toRate(room.name ?? rate.roomName, checked.data, currency, query, now);
        if (fresh) return fresh;
      }
    }
    this.logger.debug({ hotel: hotel.supplierHotelId }, 'Hotelbeds rate check returned no rate');
    throw new OfferUnavailableError(this.name, 'The rate is no longer available');
  }

  /**
   * Confirms a paid stay. `tolerance: 0` makes Hotelbeds refuse a price that moved since the
   * rate check rather than charge it.
   */
  async book(request: HotelBookingRequest, signal: AbortSignal): Promise<HotelBookingResult> {
    const [lead] = request.guests;
    if (!lead) throw new SupplierUnavailableError(this.name, 'The booking has no lead guest');
    const created = await this.client.request('POST', `${API}/bookings`, signal, {
      holder: { name: lead.givenNames, surname: lead.surname },
      rooms: [
        {
          rateKey: request.rate.supplierRateId,
          paxes: request.guests.map((guest, index) => ({
            roomId: index + 1,
            type: 'AD',
            name: guest.givenNames,
            surname: guest.surname,
          })),
        },
      ],
      clientReference: hotelbedsClientReference(request.idempotencyKey),
      tolerance: 0,
    });
    const booking = hotelbedsBookingSchema.safeParse(created);
    if (!booking.success) {
      throw new SupplierUnavailableError(this.name, 'Hotelbeds returned an invalid booking');
    }
    // Anything but confirmed leaves the outcome unclear: it goes to review, never to a retry.
    if (booking.data.booking.status !== 'CONFIRMED') {
      throw new SupplierUnavailableError(
        this.name,
        `Hotelbeds booking is ${booking.data.booking.status ?? 'unconfirmed'}`,
      );
    }
    return { confirmationNumber: booking.data.booking.reference };
  }

  private toHotel(
    hotel: HotelbedsHotel,
    query: HotelSearchQuery,
    now: number,
  ): SupplierHotel | null {
    if (!hotel.currency) return null;
    const rates = this.roomRates(hotel.rooms ?? [], hotel.currency, query, now);
    const sellable = query.freeCancellationOnly ? rates.filter((rate) => rate.refundable) : rates;
    if (sellable.length === 0) return null;
    return {
      supplier: this.name,
      supplierHotelId: String(hotel.code),
      name: hotel.name,
      stars: hotelbedsStars(hotel.categoryCode),
      reviewScore: null,
      reviewCount: 0,
      latitude: hotel.latitude ? Number(hotel.latitude) : (query.city.latitude ?? 0),
      longitude: hotel.longitude ? Number(hotel.longitude) : (query.city.longitude ?? 0),
      area: hotel.zoneName ?? null,
      cityName: query.city.name,
      countryCode: query.city.countryCode,
      amenities: [],
      rates: sellable,
    };
  }

  private roomRates(
    rooms: HotelbedsRoom[],
    currency: string,
    query: HotelSearchQuery,
    now: number,
  ): SupplierHotelRate[] {
    const rates: SupplierHotelRate[] = [];
    let skipped = 0;
    for (const room of rooms) {
      for (const raw of room.rates ?? []) {
        const parsed = hotelbedsRateSchema.safeParse(raw);
        const rate = parsed.success
          ? this.toRate(room.name ?? room.code, parsed.data, currency, query, now)
          : null;
        if (rate) rates.push(rate);
        else skipped += 1;
      }
    }
    if (skipped > 0) this.logger.debug({ skipped }, 'Left out Hotelbeds rates we cannot sell');
    return rates;
  }

  /** A rate we can sell: paid to Hotelbeds now, for every room searched, with a known board. */
  private toRate(
    roomName: string,
    rate: HotelbedsRate,
    currency: string,
    query: HotelSearchQuery,
    now: number,
  ): SupplierHotelRate | null {
    const board = BOARDS[(rate.boardCode ?? '').toUpperCase()];
    const payNow = rate.paymentType === undefined || rate.paymentType === 'AT_WEB';
    const roomsMatch = rate.rooms === undefined || rate.rooms === query.rooms.length;
    if (!board || !payNow || !roomsMatch) return null;
    const total = amount(rate.net, currency);
    if (total.minor <= 0n) return null;

    let included = money(0, currency);
    let dueLater: Money | null = null;
    for (const tax of rate.taxes?.taxes ?? []) {
      if (tax.included === false) {
        const value = tax.clientAmount ?? tax.amount;
        const unit = tax.clientCurrency ?? tax.currency ?? currency;
        if (!value || (dueLater && dueLater.currency !== unit)) continue;
        dueLater = add(dueLater ?? money(0, unit), amount(value, unit));
      } else if (tax.included === true && tax.amount && (tax.currency ?? currency) === currency) {
        included = add(included, amount(tax.amount, currency));
      }
    }
    const taxes = included.minor <= total.minor ? included : money(0, currency);
    const price: SupplierPrice = { base: subtract(total, taxes), taxes };

    // Free cancellation until the first penalty, when it is still ahead.
    const firstPenalty = (rate.cancellationPolicies ?? [])
      .map((policy) => Date.parse(policy.from))
      .filter((from) => !Number.isNaN(from))
      .reduce<number | null>(
        (earliest, from) => (earliest === null ? from : Math.min(earliest, from)),
        null,
      );
    const freeUntil =
      rate.rateClass !== 'NRF' && firstPenalty !== null && firstPenalty - PENALTY_MARGIN_MS > now
        ? firstPenalty - PENALTY_MARGIN_MS
        : null;

    return {
      supplierRateId: rate.rateKey,
      roomName: rate.boardName ? `${roomName} (${rate.boardName.toLowerCase()})` : roomName,
      board,
      refundable: freeUntil !== null,
      freeCancellationUntil: freeUntil === null ? null : new Date(freeUntil).toISOString(),
      price,
      payAtProperty: dueLater && dueLater.minor > 0n ? dueLater : null,
      expiresAt: new Date(now + RATE_TTL_MS).toISOString(),
    };
  }
}
