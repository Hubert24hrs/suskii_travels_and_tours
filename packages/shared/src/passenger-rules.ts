import { isValidDate } from './time';
import type { TravellerCounts } from './traveller-rules';

/**
 * Passenger rules shared by checkout forms and the API (ADR-015). Zod-free, so browsers can
 * preview normalised names without loading the schemas.
 */

export const PASSENGER_TYPES = ['adult', 'child', 'infant'] as const;
export type PassengerType = (typeof PASSENGER_TYPES)[number];

export const PASSENGER_TITLES = ['mr', 'ms', 'mrs', 'miss', 'dr'] as const;
export type PassengerTitle = (typeof PASSENGER_TITLES)[number];

/** As printed in the passport (airline systems accept M and F). */
export const GENDERS = ['m', 'f'] as const;
export type Gender = (typeof GENDERS)[number];

export const NAME_MAX_LENGTH = 40;
/** Given names plus surname: fits common airline and GDS name fields. */
export const FULL_NAME_MAX_LENGTH = 55;
export const MAX_SAVED_TRAVELLERS = 20;
/** Passports expiring within this many months after the last travel date get a warning. */
export const PASSPORT_WARNING_MONTHS = 6;

/** Machine-readable issue codes; apps map them to localised messages. */
export const PASSENGER_ISSUES = {
  nameNotLatin: 'name_not_latin',
  nameTooLong: 'name_too_long',
  countMismatch: 'passenger_count_mismatch',
  typeMismatch: 'passenger_type_mismatch',
  bornAfterTravel: 'born_after_travel',
  infantsExceedAdults: 'infants_exceed_adults',
  documentRequired: 'passport_required',
  passportExpired: 'passport_expired',
  passportExpiresSoon: 'passport_expires_soon',
  travellerNotFound: 'traveller_not_found',
  /** Visa assistance: every applicant holds the nationality the eligibility was checked for. */
  nationalityMismatch: 'nationality_mismatch',
} as const;

const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: 'SS',
  ẞ: 'SS',
  Æ: 'AE',
  æ: 'AE',
  Œ: 'OE',
  œ: 'OE',
  Ø: 'O',
  ø: 'O',
  Ł: 'L',
  ł: 'L',
  Đ: 'D',
  đ: 'D',
  Ð: 'D',
  ð: 'D',
  Þ: 'TH',
  þ: 'TH',
  ı: 'I',
  Ŋ: 'NG',
  ŋ: 'NG',
};

/**
 * A name as it appears in a passport's machine-readable zone: accents removed, upper case, single
 * spaces, only A-Z plus inner spaces, hyphens and apostrophes. `null` when the input uses another
 * script (the traveller must type the Latin spelling printed in the passport).
 */
export function transliterateName(input: string): string | null {
  const latin = [...input.normalize('NFC')].map((char) => SPECIAL_LETTERS[char] ?? char).join('');
  const result = latin
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘ʼ`´]/g, "'")
    .replace(/[‐‑‒–—]/g, '-')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
  return /^[A-Z](?:[A-Z' -]*[A-Z])?$/.test(result) ? result : null;
}

/** Whole years from `dateOfBirth` to `on` (both YYYY-MM-DD). A 29 February birthday counts from 1 March. */
export function ageOn(dateOfBirth: string, on: string): number {
  const [birthYear = 0, birthMonth = 0, birthDay = 0] = dateOfBirth.split('-').map(Number);
  const [year = 0, month = 0, day = 0] = on.split('-').map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

export function passengerTypeForAge(age: number): PassengerType {
  if (age >= 12) return 'adult';
  if (age >= 2) return 'child';
  return 'infant';
}

/** `date` plus whole calendar months, clamped to the month's last day (31 Aug + 6 = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export interface PassengerFacts {
  type: PassengerType;
  dateOfBirth: string;
  document: { expiryDate: string } | null;
}

export interface ItineraryFacts {
  /** Travellers the offer was priced for. */
  counts: TravellerCounts;
  firstTravelDate: string;
  /** Return flight or last leg (flights), check-out (hotels). */
  lastTravelDate: string;
  /** Crosses a border, so passports are required. */
  international: boolean;
}

export interface PassengerIssue {
  /** Passenger position, or `null` for the whole list. */
  index: number | null;
  path: string[];
  code: (typeof PASSENGER_ISSUES)[keyof typeof PASSENGER_ISSUES];
}

const COUNT_KEY: Record<PassengerType, keyof TravellerCounts> = {
  adult: 'adults',
  child: 'children',
  infant: 'infants',
};

/**
 * Checks passengers against the priced offer and the itinerary: counts per type, age on the last
 * travel date (infants must still be under 2 on the return date), lap infants per adult, and
 * passports (required abroad, valid for the whole trip, a warning within six months of expiry).
 */
export function checkPassengers(
  passengers: readonly PassengerFacts[],
  facts: ItineraryFacts,
): { errors: PassengerIssue[]; warnings: PassengerIssue[] } {
  const errors: PassengerIssue[] = [];
  const warnings: PassengerIssue[] = [];
  const counted: Record<keyof TravellerCounts, number> = { adults: 0, children: 0, infants: 0 };

  passengers.forEach((passenger, index) => {
    counted[COUNT_KEY[passenger.type]] += 1;
    if (!isValidDate(passenger.dateOfBirth)) return;
    if (passenger.dateOfBirth > facts.firstTravelDate) {
      errors.push({ index, path: ['dateOfBirth'], code: PASSENGER_ISSUES.bornAfterTravel });
      return;
    }
    const age = ageOn(passenger.dateOfBirth, facts.lastTravelDate);
    if (passengerTypeForAge(age) !== passenger.type) {
      errors.push({ index, path: ['dateOfBirth'], code: PASSENGER_ISSUES.typeMismatch });
    }

    const expiry = passenger.document?.expiryDate;
    if (!expiry) {
      if (facts.international)
        errors.push({ index, path: ['document'], code: PASSENGER_ISSUES.documentRequired });
      return;
    }
    if (!isValidDate(expiry)) return;
    if (expiry < facts.lastTravelDate) {
      errors.push({
        index,
        path: ['document', 'expiryDate'],
        code: PASSENGER_ISSUES.passportExpired,
      });
    } else if (expiry < addMonths(facts.lastTravelDate, PASSPORT_WARNING_MONTHS)) {
      warnings.push({
        index,
        path: ['document', 'expiryDate'],
        code: PASSENGER_ISSUES.passportExpiresSoon,
      });
    }
  });

  if (
    counted.adults !== facts.counts.adults ||
    counted.children !== facts.counts.children ||
    counted.infants !== facts.counts.infants
  ) {
    errors.push({ index: null, path: [], code: PASSENGER_ISSUES.countMismatch });
  } else if (counted.infants > counted.adults) {
    errors.push({ index: null, path: [], code: PASSENGER_ISSUES.infantsExceedAdults });
  }
  return { errors, warnings };
}
