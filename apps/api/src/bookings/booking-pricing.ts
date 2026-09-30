import {
  add,
  fromWire,
  multiply,
  sum,
  toWire,
  type FlightSearchRequest,
  type HotelSearchRequest,
  type ItineraryFacts,
  type Money,
} from '@suskii/shared';

import type { Converter } from '../pricing/fx.service';
import type { PricingResult, PromoData, PromoUsage } from '../pricing/pricing-engine';
import { toPriceDto } from '../pricing/pricing.schemas';
import type { Pricer } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';
import { flightPricingContext, servicePrice } from '../search/flight-search.service';
import { hotelPricingContext } from '../search/hotel-search.service';
import type {
  FlightService,
  HotelSearchQuery,
  SupplierFlightOffer,
  SupplierHotel,
  SupplierHotelRate,
} from '../suppliers/supplier.types';

import type { BookingPriceDto } from './bookings.schemas';
import {
  inhouseBasePrice,
  inhousePricingContext,
  INHOUSE_KINDS,
  type InhouseItemPayload,
} from './inhouse-items';

/** What a quote and a booking item store: the offer in our domain shape plus its search. */
export interface FlightItemPayload {
  kind: 'flight';
  offer: SupplierFlightOffer;
  request: FlightSearchRequest;
}

export interface HotelItemPayload {
  kind: 'hotel';
  /** `rates` holds exactly the booked rate. */
  hotel: SupplierHotel;
  request: HotelSearchRequest;
  query: HotelSearchQuery;
}

export type SupplierItemPayload = FlightItemPayload | HotelItemPayload;
export type ItemPayload = SupplierItemPayload | InhouseItemPayload;

export const isInhouse = (payload: ItemPayload): payload is InhouseItemPayload =>
  (INHOUSE_KINDS as readonly string[]).includes(payload.kind);

export interface ExtraSelection {
  serviceId: string;
  /** Passenger position in the booking (supplier order). */
  passengerIndex: number;
  quantity: number;
  /** Stored with the selection so a re-priced offer with new service ids still matches. */
  type?: string;
  weightKg?: number;
}

export type PromoInput = { data: PromoData; usage: PromoUsage } | null;

export function bookedRate(payload: HotelItemPayload): SupplierHotelRate {
  const rate = payload.hotel.rates[0];
  if (!rate) throw new Error('Hotel payload has no rate');
  return rate;
}

/** The travel dates and passenger counts that flight passengers are checked against. */
export function itineraryFacts(payload: FlightItemPayload): ItineraryFacts {
  const { offer } = payload;
  const first = offer.slices[0];
  const last = offer.slices[offer.slices.length - 1];
  const countries = new Set(
    offer.slices.flatMap((slice) =>
      slice.segments.flatMap((segment) => [
        segment.origin.countryCode,
        segment.destination.countryCode,
      ]),
    ),
  );
  const firstDate = first?.departureLocal.slice(0, 10) ?? '';
  return {
    counts: offer.passengers,
    firstTravelDate: firstDate,
    lastTravelDate: last?.departureLocal.slice(0, 10) ?? firstDate,
    // An unknown country counts as international, so a passport is asked for rather than missed.
    international: countries.size > 1 || countries.has(null),
  };
}

/**
 * Finds the service a selection refers to in a (re-priced) offer: same id, or failing that the
 * same kind of extra, since some suppliers issue new service ids when an offer is re-priced.
 */
export function matchService(
  services: readonly FlightService[],
  wanted: { serviceId: string; type?: string; weightKg?: number },
): FlightService | null {
  return (
    services.find((service) => service.id === wanted.serviceId) ??
    (wanted.type !== undefined
      ? (services.find(
          (service) => service.type === wanted.type && service.weightKg === wanted.weightKg,
        ) ?? null)
      : null)
  );
}

/** The item through the pricing engine: supplier price or in-house base price. */
export function priceItem(
  pricer: Pricer,
  payload: ItemPayload,
  client: ClientContext,
  now: Date,
  promo: PromoInput = null,
): PricingResult {
  if (payload.kind === 'flight')
    return pricer(payload.offer.price, flightPricingContext(payload.offer, client, now), promo);
  if (payload.kind === 'hotel')
    return pricer(
      bookedRate(payload).price,
      hotelPricingContext(payload.hotel, payload.request, client, now),
      promo,
    );
  const base = inhouseBasePrice(payload);
  // Quotes are only created for selections that can book; a snapshot that cannot is corrupt.
  if ('issue' in base) throw new Error(`In-house item cannot be priced: ${base.issue}`);
  return pricer(base.price, inhousePricingContext(payload, client, now), promo);
}

export interface PricedBooking {
  price: BookingPriceDto;
  total: Money;
  promo: PricingResult['promo'];
}

/**
 * Prices a booking item for a customer: the fare through the pricing engine (markup, fees, promo)
 * and extras converted at supplier cost (ADR-014), which are never discounted.
 */
export function priceBookingItem(
  pricer: Pricer,
  fx: Converter,
  payload: ItemPayload,
  client: ClientContext,
  extras: readonly ExtraSelection[],
  promo: PromoInput,
  now: Date,
): PricedBooking {
  const result = priceItem(pricer, payload, client, now, promo);
  const { currency } = result.breakdown;
  const services = payload.kind === 'flight' ? payload.offer.services : [];

  const byService = new Map<string, { service: FlightService; quantity: number }>();
  for (const selection of extras) {
    const service = matchService(services, selection);
    if (!service) throw new Error(`Unknown service ${selection.serviceId}`);
    const entry = byService.get(service.id) ?? { service, quantity: 0 };
    entry.quantity += selection.quantity;
    byService.set(service.id, entry);
  }
  const lines = [...byService.values()].map(({ service, quantity }) => {
    const unit = servicePrice(fx, service, currency);
    return { service, quantity, unit, amount: multiply(unit, quantity) };
  });
  const total = add(
    result.breakdown.total,
    sum(
      currency,
      lines.map((line) => line.amount),
    ),
  );
  return {
    price: {
      ...toPriceDto(result.breakdown),
      extras: lines.map((line) => ({
        serviceId: line.service.id,
        type: line.service.type,
        weightKg: line.service.weightKg,
        quantity: line.quantity,
        unitPrice: toWire(line.unit),
        amount: toWire(line.amount),
      })),
      total: toWire(total),
    },
    total,
    promo: result.promo,
  };
}

export const totalOf = (price: BookingPriceDto): Money => fromWire(price.total);
