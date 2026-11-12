import { add, money, multiply, multiplyRatio, type Money } from './money';
import { daysBetween } from './time';

/** Traveller counts (structurally `TravellerCounts`; importing that module would pull in Zod). */
interface Counts {
  adults: number;
  children: number;
  infants: number;
}

/**
 * In-house products (ADR-025 to ADR-028): packages, tours, visa assistance and add-ons, owned and
 * priced by Suskii. Zod-free, so the website's client code can use it through `lite`.
 */

export const CATALOG_STATUSES = ['draft', 'published', 'archived'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const DEPARTURE_STATUSES = ['open', 'closed', 'cancelled'] as const;
export type DepartureStatus = (typeof DEPARTURE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Cancellation policies (ADR-028)
// ---------------------------------------------------------------------------

/** Cancelling at least `daysBefore` days before the start refunds `refundBps` (10000 = all). */
export interface CancellationTier {
  daysBefore: number;
  refundBps: number;
}

export const MAX_CANCELLATION_TIERS = 8;

/** Tiers ordered from the earliest cancellation (most days before) to the latest. */
export const sortTiers = (tiers: readonly CancellationTier[]): CancellationTier[] =>
  [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);

/**
 * Share refunded when cancelling on `today` for a product starting on `startDate` (both
 * YYYY-MM-DD in the product's time zone). The first tier whose `daysBefore` is covered applies;
 * nothing is refunded on or after the start date unless a tier says otherwise.
 */
export function refundBpsFor(
  tiers: readonly CancellationTier[],
  startDate: string,
  today: string,
): number {
  const daysLeft = daysBetween(today, startDate);
  if (daysLeft < 0) return 0;
  return sortTiers(tiers).find((tier) => daysLeft >= tier.daysBefore)?.refundBps ?? 0;
}

/** The refund for a cancellation: `paid` x share, rounded down (never more than was paid). */
export function cancellationRefund(paid: Money, refundBps: number): Money {
  if (refundBps <= 0 || paid.minor <= 0n) return money(0, paid.currency);
  return multiplyRatio(paid, Math.min(refundBps, 10_000), 10_000, 'floor');
}

// ---------------------------------------------------------------------------
// Per-person prices (packages and tours)
// ---------------------------------------------------------------------------

/** Base prices per person; `null` means that traveller type cannot book this departure. */
export interface PerPersonPrices {
  adult: Money;
  child: Money | null;
  infant: Money | null;
}

export const PER_PERSON_ISSUES = {
  childrenNotAllowed: 'children_not_allowed',
  infantsNotAllowed: 'infants_not_allowed',
  noTravellers: 'no_travellers',
} as const;
export type PerPersonIssue = (typeof PER_PERSON_ISSUES)[keyof typeof PER_PERSON_ISSUES];

/** Total base price for the travellers, or the reason they cannot book. */
export function perPersonTotal(
  prices: PerPersonPrices,
  counts: Counts,
): { total: Money } | { issue: PerPersonIssue } {
  if (counts.adults + counts.children + counts.infants === 0) {
    return { issue: PER_PERSON_ISSUES.noTravellers };
  }
  if (counts.children > 0 && !prices.child) return { issue: PER_PERSON_ISSUES.childrenNotAllowed };
  if (counts.infants > 0 && !prices.infant) return { issue: PER_PERSON_ISSUES.infantsNotAllowed };
  let total = multiply(prices.adult, counts.adults);
  if (prices.child) total = add(total, multiply(prices.child, counts.children));
  if (prices.infant) total = add(total, multiply(prices.infant, counts.infants));
  return { total };
}

/** Seats a booking takes: infants on a lap still count for tours and packages (a place each). */
export const seatsFor = (counts: Counts): number =>
  counts.adults + counts.children + counts.infants;

// ---------------------------------------------------------------------------
// Add-ons (ADR-027)
// ---------------------------------------------------------------------------

/** Add-ons sold from the in-house catalog; extra baggage stays a flight ancillary. */
export const ADDON_PRODUCT_TYPES = ['insurance', 'airport_transfer', 'esim', 'lounge'] as const;
export type AddonProductType = (typeof ADDON_PRODUCT_TYPES)[number];

export const ADDON_PRICING_BASES = [
  'per_person',
  'per_booking',
  'per_day',
  'per_person_per_day',
] as const;
export type AddonPricingBasis = (typeof ADDON_PRICING_BASES)[number];

/** Inclusive number of days covered from `startDate` to `endDate` (a same-day trip is 1). */
export const coveredDays = (startDate: string, endDate: string): number =>
  Math.max(1, daysBetween(startDate, endDate) + 1);

/** How many times the unit price applies. */
export function addonUnits(
  basis: AddonPricingBasis,
  travellers: number,
  startDate: string,
  endDate: string,
): number {
  const days = coveredDays(startDate, endDate);
  switch (basis) {
    case 'per_person':
      return travellers;
    case 'per_booking':
      return 1;
    case 'per_day':
      return days;
    case 'per_person_per_day':
      return travellers * days;
  }
}

/** Longest period an add-on can cover (a year of insurance or eSIM data). */
export const MAX_ADDON_DAYS = 366;

/** Details an add-on collects at checkout (a transfer needs the flight; insurance, ages). */
export const ADDON_DETAIL_FIELDS = [
  'flight_number',
  'arrival_time',
  'pickup_address',
  'dates_of_birth',
] as const;
export type AddonDetailField = (typeof ADDON_DETAIL_FIELDS)[number];

// ---------------------------------------------------------------------------
// Visa assistance (ADR-026)
// ---------------------------------------------------------------------------

export const VISA_REQUIREMENTS = [
  'visa_free',
  'visa_on_arrival',
  'e_visa',
  'visa_required',
  'not_available',
] as const;
export type VisaRequirement = (typeof VISA_REQUIREMENTS)[number];

export const VISA_APPLICATION_STATUSES = [
  'awaiting_documents',
  'submitted',
  'in_review',
  'action_required',
  'lodged',
  'approved',
  'refused',
  'withdrawn',
] as const;
export type VisaApplicationStatus = (typeof VISA_APPLICATION_STATUSES)[number];

export const CLOSED_VISA_STATUSES: readonly VisaApplicationStatus[] = [
  'approved',
  'refused',
  'withdrawn',
];

/** Statuses in which the traveller may upload or replace documents. */
export const VISA_UPLOAD_STATUSES: readonly VisaApplicationStatus[] = [
  'awaiting_documents',
  'action_required',
];

/** Moves officers may make (the traveller's submission is `awaiting_documents|action_required -> submitted`). */
export const VISA_OFFICER_TRANSITIONS: Readonly<
  Record<VisaApplicationStatus, readonly VisaApplicationStatus[]>
> = {
  awaiting_documents: ['withdrawn'],
  submitted: ['in_review', 'action_required', 'withdrawn'],
  in_review: ['action_required', 'lodged', 'withdrawn'],
  action_required: ['in_review', 'withdrawn'],
  lodged: ['approved', 'refused', 'withdrawn'],
  approved: [],
  refused: [],
  withdrawn: [],
};

export const VISA_DOCUMENT_STATUSES = [
  'pending_scan',
  'clean',
  'infected',
  'scan_failed',
  'rejected',
] as const;
export type VisaDocumentStatus = (typeof VISA_DOCUMENT_STATUSES)[number];

export const VISA_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type VisaDocumentType = (typeof VISA_DOCUMENT_TYPES)[number];

export const VISA_DOCUMENT_EXTENSIONS: Readonly<Record<VisaDocumentType, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

/**
 * The document type from its first bytes (magic numbers), ignoring the declared type and file
 * name; `null` for anything else.
 */
export function sniffDocumentType(bytes: Uint8Array): VisaDocumentType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  return null;
}

/** A file name safe to show and to use in Content-Disposition (letters, digits, `._-`). */
export function safeFileName(name: string, type: VisaDocumentType): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `${base || 'document'}.${VISA_DOCUMENT_EXTENSIONS[type]}`;
}

// ---------------------------------------------------------------------------
// Vouchers (ADR-028)
// ---------------------------------------------------------------------------

/** No look-alike characters (0/O, 1/I/L), so codes can be read aloud or typed. */
export const VOUCHER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const VOUCHER_CODE_LENGTH = 20;
export const VOUCHER_QR_PREFIX = 'SUSKII-V1:';

const VOUCHER_PATTERN = new RegExp(`^[${VOUCHER_ALPHABET}]{${VOUCHER_CODE_LENGTH}}$`);

/** The voucher code from a scanned QR payload or a typed code (spaces and dashes ignored). */
export function parseVoucherCode(input: string): string | null {
  const raw = input.trim().toUpperCase();
  const code = (
    raw.startsWith(VOUCHER_QR_PREFIX) ? raw.slice(VOUCHER_QR_PREFIX.length) : raw
  ).replace(/[\s-]/g, '');
  return VOUCHER_PATTERN.test(code) ? code : null;
}

/** Groups of four for display: ABCD-EFGH-JKMN-PQRS-TUVW. */
export const formatVoucherCode = (code: string): string => code.match(/.{1,4}/g)?.join('-') ?? code;
