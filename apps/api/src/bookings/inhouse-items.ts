import {
  addonUnits,
  cancellationRefund,
  localDate,
  multiply,
  refundBpsFor,
  perPersonTotal,
  seatsFor,
  zero,
  type AddonDetailField,
  type AddonPricingBasis,
  type AddonProductType,
  type CancellationTier,
  type ItineraryFacts,
  type Money,
  type PerPersonIssue,
  type PerPersonPrices,
  type TravellerCounts,
  type VisaPurpose,
} from '@suskii/shared';

import type { BookingStatus, Vertical } from '../generated/prisma/client';
import type { PricingContext, SupplierPrice } from '../pricing/pricing-engine';
import type { ClientContext } from '../search/client-context';

/**
 * In-house items (ADR-025): packages, tours, visa assistance and add-ons. A quote snapshots the
 * product and the selection; the booking item keeps that snapshot, and the price re-check before
 * payment re-reads the catalog (`InhouseCatalogPricer`).
 */

export const INHOUSE_SUPPLIER = 'suskii';

/** What the traveller asked a quote for, echoed in 410 answers so clients can start again. */
export type InhouseQuoteRequest =
  | { kind: 'package'; departureId: string; travellers: TravellerCounts }
  | { kind: 'tour'; departureId: string; travellers: TravellerCounts }
  | {
      kind: 'visa';
      productId: string;
      purpose: VisaPurpose;
      nationality: string;
      travelDate: string;
      travellers: TravellerCounts;
    }
  | {
      kind: 'addon';
      addonId: string;
      startDate: string;
      endDate: string;
      travellers: TravellerCounts;
      linkToken: string | null;
    };

interface InhouseBase {
  productId: string;
  slug: string;
  title: string;
  /** Demo inventory (`db:seed:demo`), badged "Sample". */
  sample: boolean;
  artKey: string | null;
  travellers: TravellerCounts;
}

export interface PackageItemPayload extends InhouseBase {
  kind: 'package';
  departureId: string;
  cityName: string;
  countryCode: string;
  /** The destination's IANA zone: cancellation deadlines count days there. */
  timeZone: string;
  nights: number;
  startDate: string;
  endDate: string;
  passportRequired: boolean;
  inclusions: string[];
  prices: PerPersonPrices;
  cancellationPolicy: CancellationTier[];
  request: Extract<InhouseQuoteRequest, { kind: 'package' }>;
}

export interface TourItemPayload extends InhouseBase {
  kind: 'tour';
  departureId: string;
  cityName: string;
  countryCode: string;
  timeZone: string;
  /** Wall time at the meeting point. */
  startsAtLocal: string;
  startsAtUtc: string;
  durationMinutes: number;
  meetingPoint: { name: string; address: string; notes: string | null };
  inclusions: string[];
  prices: PerPersonPrices;
  cancellationPolicy: CancellationTier[];
  request: Extract<InhouseQuoteRequest, { kind: 'tour' }>;
}

export interface VisaItemPayload extends InhouseBase {
  kind: 'visa';
  destination: string;
  purpose: VisaPurpose;
  nationality: string;
  travelDate: string;
  processingDaysMin: number;
  processingDaysMax: number;
  governmentFeeNote: string | null;
  /** Service fee per applicant. */
  unitPrice: Money;
  request: Extract<InhouseQuoteRequest, { kind: 'visa' }>;
}

export interface AddonItemPayload extends InhouseBase {
  kind: 'addon';
  type: AddonProductType;
  pricingBasis: AddonPricingBasis;
  unitPrice: Money;
  units: number;
  startDate: string;
  endDate: string;
  /** Where it applies, from the linked trip or the product; null for anywhere. */
  countryCode: string | null;
  cityName: string | null;
  /** The destination's IANA zone when known, else UTC. */
  timeZone: string;
  linkedBookingId: string | null;
  /** The linked trip's reference, shown on the quote and booking (absent on older quotes). */
  linkedReference?: string | null;
  requiredDetails: AddonDetailField[];
  cancellationPolicy: CancellationTier[];
  /** Checkout details (flight number, pickup address), encrypted per booking item. */
  detailsEncrypted?: string;
  request: Extract<InhouseQuoteRequest, { kind: 'addon' }>;
}

export type InhouseItemPayload =
  PackageItemPayload | TourItemPayload | VisaItemPayload | AddonItemPayload;

export type InhouseKind = InhouseItemPayload['kind'];

export const INHOUSE_KINDS: readonly InhouseKind[] = ['package', 'tour', 'visa', 'addon'];

export const INHOUSE_VERTICAL: Readonly<Record<InhouseKind, Vertical>> = {
  package: 'packages',
  tour: 'tours',
  visa: 'visa',
  addon: 'travel_addons',
};

export const travellerTotal = (counts: TravellerCounts): number => seatsFor(counts);

/** The base price (like a supplier's net fare) the pricing engine marks up, or why not. */
export function inhouseBasePrice(
  payload: InhouseItemPayload,
): { price: SupplierPrice } | { issue: PerPersonIssue } {
  let base: Money;
  if (payload.kind === 'package' || payload.kind === 'tour') {
    const result = perPersonTotal(payload.prices, payload.travellers);
    if ('issue' in result) return result;
    base = result.total;
  } else if (payload.kind === 'visa') {
    base = multiply(payload.unitPrice, travellerTotal(payload.travellers));
  } else {
    base = multiply(payload.unitPrice, payload.units);
  }
  return { price: { base, taxes: zero(base.currency) } };
}

/** Units an add-on is charged for, from its basis, travellers and dates. */
export const addonUnitsFor = (
  basis: AddonPricingBasis,
  travellers: TravellerCounts,
  startDate: string,
  endDate: string,
): number => addonUnits(basis, travellerTotal(travellers), startDate, endDate);

export function inhouseCountry(payload: InhouseItemPayload): string | null {
  switch (payload.kind) {
    case 'package':
    case 'tour':
      return payload.countryCode;
    case 'visa':
      return payload.destination;
    case 'addon':
      return payload.countryCode;
  }
}

export function inhousePricingContext(
  payload: InhouseItemPayload,
  client: ClientContext,
  now: Date,
): PricingContext {
  return {
    vertical: INHOUSE_VERTICAL[payload.kind],
    supplier: INHOUSE_SUPPLIER,
    channel: client.channel,
    userTier: client.userTier,
    destinationCountry: inhouseCountry(payload),
    passengers: travellerTotal(payload.travellers),
    now,
  };
}

/** First and last local date of the product (a tour's day, a visa's travel date). */
export function inhouseDates(payload: InhouseItemPayload): { start: string; end: string } {
  switch (payload.kind) {
    case 'package':
    case 'addon':
      return { start: payload.startDate, end: payload.endDate };
    case 'tour':
      return { start: payload.startsAtLocal.slice(0, 10), end: payload.startsAtLocal.slice(0, 10) };
    case 'visa':
      return { start: payload.travelDate, end: payload.travelDate };
  }
}

/**
 * The facts travellers are checked against (ADR-015 rules): passports for packages that need
 * them and for every visa applicant; tours and add-ons only check names, ages and counts.
 */
export function inhouseItineraryFacts(payload: InhouseItemPayload): ItineraryFacts {
  const { start, end } = inhouseDates(payload);
  return {
    counts: payload.travellers,
    firstTravelDate: start,
    lastTravelDate: end,
    international:
      payload.kind === 'visa' || (payload.kind === 'package' && payload.passportRequired),
  };
}

/** The product's first local date and the zone "today" is counted in, for cancellation tiers. */
export function cancellationClock(payload: InhouseItemPayload): {
  startDate: string;
  timeZone: string;
} {
  const { start } = inhouseDates(payload);
  return { startDate: start, timeZone: payload.kind === 'visa' ? 'UTC' : payload.timeZone };
}

/** The cancellation tiers of a product that can be cancelled by its owner (not visa). */
export function cancellationTiers(payload: InhouseItemPayload): CancellationTier[] | null {
  return payload.kind === 'visa' ? null : payload.cancellationPolicy;
}

/** The "supplier offer id" of an in-house item: what was sold, for reporting and support. */
export function inhouseOfferId(payload: InhouseItemPayload): string {
  switch (payload.kind) {
    case 'package':
    case 'tour':
      return `${payload.kind}:${payload.departureId}`;
    case 'visa':
      return `visa:${payload.productId}`;
    case 'addon':
      return `addon:${payload.productId}`;
  }
}

/** Seats a package or tour item takes on its departure. */
export function seatDeparture(
  payload: InhouseItemPayload,
): { kind: 'package' | 'tour'; departureId: string; seats: number } | null {
  if (payload.kind !== 'package' && payload.kind !== 'tour') return null;
  return {
    kind: payload.kind,
    departureId: payload.departureId,
    seats: seatsFor(payload.travellers),
  };
}

export interface CancellationTerms {
  refundBps: number;
  refund: Money;
}

/**
 * What cancelling a confirmed package, tour or add-on now would refund (ADR-028), or null when
 * it cannot be cancelled online (other statuses and products, or the start date has passed).
 */
export function cancellationTerms(
  payload: InhouseItemPayload,
  status: BookingStatus,
  paid: Money,
  now: Date,
): CancellationTerms | null {
  if (status !== 'CONFIRMED') return null;
  const tiers = cancellationTiers(payload);
  if (!tiers) return null;
  const { startDate, timeZone } = cancellationClock(payload);
  const today = localDate(now, timeZone);
  if (today > startDate) return null;
  const refundBps = refundBpsFor(tiers, startDate, today);
  return { refundBps, refund: cancellationRefund(paid, refundBps) };
}
