import { FLIGHT_NUMBER_PATTERN, type CheckoutIssue, type FieldIssues } from '@suskii/shared/lite';

import { marketingAttribution } from '../../lib/ad-attribution';

/**
 * What a booking form shares (ADR-014, ADR-118): the checkout of one part and the details form of
 * a whole trip read the API's issues, the transfer details and the ad attribution the same way.
 */

/** The API's traveller issue codes the forms show; anything else reads as `invalid`. */
const ISSUE_CODES: readonly CheckoutIssue[] = [
  'name_not_latin',
  'name_too_long',
  'passport_required',
  'passport_expired',
  'passport_expires_soon',
  'passenger_type_mismatch',
  'born_after_travel',
  'infants_exceed_adults',
  'passenger_count_mismatch',
  'traveller_not_found',
  'nationality_mismatch',
];
export const asIssue = (code: string): CheckoutIssue =>
  (ISSUE_CODES as readonly string[]).includes(code) ? (code as CheckoutIssue) : 'invalid';

/** API field paths (`passengers.0.document.number`) to form paths (`passengers.0.passportNumber`). */
export function formPath(apiPath: string): string {
  return apiPath
    .replace(/^contact\./, '')
    .replace(/\.document\.number$/, '.passportNumber')
    .replace(/\.document\.expiryDate$/, '.passportExpiry')
    .replace(/\.document\.issuingCountry$/, '.issuingCountry')
    .replace(/\.document$/, '.passportNumber');
}

/** Transfer details an add-on asks for (ADR-027); dates of birth come from the travellers. */
export interface AddonDetailsDraft {
  flightNumber: string;
  arrivalTime: string;
  pickupAddress: string;
}
export const NO_DETAILS: AddonDetailsDraft = {
  flightNumber: '',
  arrivalTime: '',
  pickupAddress: '',
};
export type DetailField = keyof AddonDetailsDraft;
/** An add-on's `requiredDetails` value to the form's field. */
export const DETAIL_FIELDS: Record<string, DetailField> = {
  flight_number: 'flightNumber',
  arrival_time: 'arrivalTime',
  pickup_address: 'pickupAddress',
};

export const normaliseFlightNumber = (value: string): string => value.trim().toUpperCase();

export function checkAddonDetails(
  fields: readonly DetailField[],
  details: AddonDetailsDraft,
): FieldIssues {
  const issues: FieldIssues = {};
  for (const field of fields) {
    const value = details[field].trim();
    if (!value) issues[`addonDetails.${field}`] = 'required';
    else if (field === 'flightNumber' && !FLIGHT_NUMBER_PATTERN.test(normaliseFlightNumber(value)))
      issues[`addonDetails.${field}`] = 'invalid';
    else if (field === 'arrivalTime' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
      issues[`addonDetails.${field}`] = 'invalid';
    else if (field === 'pickupAddress' && value.length < 5)
      issues[`addonDetails.${field}`] = 'invalid';
  }
  return issues;
}

/** The booking's ad attribution, when the visitor allowed marketing (ADR-079). */
export function withMarketing(): {
  marketing?: NonNullable<ReturnType<typeof marketingAttribution>>;
} {
  const marketing = marketingAttribution();
  return marketing ? { marketing } : {};
}
