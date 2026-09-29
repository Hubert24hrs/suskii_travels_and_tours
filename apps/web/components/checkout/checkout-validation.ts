import {
  checkPassengers,
  FULL_NAME_MAX_LENGTH,
  isValidDate,
  NAME_MAX_LENGTH,
  transliterateName,
  type ItineraryFacts,
  type PassengerType,
} from '@suskii/shared/lite';

/** Issue codes the checkout shows; each maps to `checkout.issues.<code>`. */
export type CheckoutIssue =
  | 'required'
  | 'invalid'
  | 'email'
  | 'phone'
  | 'terms'
  | 'name_not_latin'
  | 'name_too_long'
  | 'passport_required'
  | 'passport_expired'
  | 'passport_expires_soon'
  | 'passenger_type_mismatch'
  | 'born_after_travel'
  | 'infants_exceed_adults'
  | 'passenger_count_mismatch'
  | 'traveller_not_found';

export interface PassengerDraft {
  type: PassengerType;
  title: string;
  gender: string;
  givenNames: string;
  surname: string;
  dateOfBirth: string;
  nationality: string;
  passportNumber: string;
  issuingCountry: string;
  passportExpiry: string;
  bags: number;
}

export interface GuestDraft {
  givenNames: string;
  surname: string;
}

export interface CheckoutDraft {
  passengers: PassengerDraft[];
  guests: GuestDraft[];
  email: string;
  phone: string;
  terms: boolean;
}

/** Field path (`passengers.0.surname`, `email`) to issue. */
export type FieldIssues = Record<string, CheckoutIssue>;

export const emptyPassenger = (type: PassengerType): PassengerDraft => ({
  type,
  title: '',
  gender: '',
  givenNames: '',
  surname: '',
  dateOfBirth: '',
  nationality: '',
  passportNumber: '',
  issuingCountry: '',
  passportExpiry: '',
  bags: 0,
});

export const normalisePassport = (value: string): string =>
  value.replace(/[\s-]/g, '').toUpperCase();
export const normalisePhone = (value: string): string => value.replace(/[\s()-]/g, '');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9]\d{7,14}$/;

function checkName(value: string): CheckoutIssue | 'ok' {
  if (!value.trim()) return 'required';
  const name = transliterateName(value);
  if (!name) return 'name_not_latin';
  return name.length > NAME_MAX_LENGTH ? 'name_too_long' : 'ok';
}

function checkNames(
  person: { givenNames: string; surname: string },
  prefix: string,
  issues: FieldIssues,
): void {
  const given = checkName(person.givenNames);
  const surname = checkName(person.surname);
  if (given !== 'ok') issues[`${prefix}.givenNames`] = given;
  if (surname !== 'ok') issues[`${prefix}.surname`] = surname;
  if (given === 'ok' && surname === 'ok') {
    const length =
      (transliterateName(person.givenNames) ?? '').length +
      (transliterateName(person.surname) ?? '').length;
    if (length > FULL_NAME_MAX_LENGTH) issues[`${prefix}.surname`] = 'name_too_long';
  }
}

/**
 * Client-side checks mirroring the API (ADR-015), so most mistakes are caught before a request.
 * The API re-validates everything; its issues map onto the same field paths.
 */
export function validateCheckout(
  draft: CheckoutDraft,
  facts: ItineraryFacts | null,
): { errors: FieldIssues; warnings: FieldIssues } {
  const errors: FieldIssues = {};
  const warnings: FieldIssues = {};

  draft.passengers.forEach((passenger, index) => {
    const prefix = `passengers.${index}`;
    checkNames(passenger, prefix, errors);
    for (const field of ['title', 'gender', 'nationality'] as const) {
      if (!passenger[field]) errors[`${prefix}.${field}`] = 'required';
    }
    if (!passenger.dateOfBirth) errors[`${prefix}.dateOfBirth`] = 'required';
    else if (!isValidDate(passenger.dateOfBirth)) errors[`${prefix}.dateOfBirth`] = 'invalid';

    const anyPassport =
      passenger.passportNumber || passenger.issuingCountry || passenger.passportExpiry;
    if (anyPassport) {
      if (!passenger.passportNumber) errors[`${prefix}.passportNumber`] = 'required';
      else if (!/^[A-Z0-9]{5,20}$/.test(normalisePassport(passenger.passportNumber)))
        errors[`${prefix}.passportNumber`] = 'invalid';
      if (!passenger.issuingCountry) errors[`${prefix}.issuingCountry`] = 'required';
      if (!passenger.passportExpiry) errors[`${prefix}.passportExpiry`] = 'required';
      else if (!isValidDate(passenger.passportExpiry))
        errors[`${prefix}.passportExpiry`] = 'invalid';
    }
  });

  if (facts && draft.passengers.length > 0) {
    const checked = checkPassengers(
      draft.passengers.map((passenger) => ({
        type: passenger.type,
        dateOfBirth: passenger.dateOfBirth,
        document:
          passenger.passportNumber && isValidDate(passenger.passportExpiry)
            ? { expiryDate: passenger.passportExpiry }
            : null,
      })),
      facts,
    );
    for (const issue of checked.errors) {
      const field =
        issue.path[0] === 'document'
          ? issue.path[1] === 'expiryDate'
            ? 'passportExpiry'
            : 'passportNumber'
          : (issue.path[0] ?? 'passengers');
      const key = issue.index === null ? 'passengers' : `passengers.${issue.index}.${field}`;
      errors[key] ??= issue.code;
    }
    for (const issue of checked.warnings) {
      if (issue.index !== null) warnings[`passengers.${issue.index}.passportExpiry`] = issue.code;
    }
  }

  draft.guests.forEach((guest, index) => checkNames(guest, `guests.${index}`, errors));
  if (!draft.email.trim()) errors.email = 'required';
  else if (!EMAIL.test(draft.email.trim())) errors.email = 'email';
  if (!draft.phone.trim()) errors.phone = 'required';
  else if (!PHONE.test(normalisePhone(draft.phone))) errors.phone = 'phone';
  if (!draft.terms) errors.terms = 'terms';
  return { errors, warnings };
}
