import { randomInt } from 'node:crypto';

import { BOOKING_REFERENCE_ALPHABET, BOOKING_REFERENCE_LENGTH } from '@suskii/shared';

/** A random booking reference such as `K7QX3M` (no look-alike characters). */
export function bookingReference(): string {
  let reference = '';
  for (let index = 0; index < BOOKING_REFERENCE_LENGTH; index += 1) {
    reference += BOOKING_REFERENCE_ALPHABET[randomInt(BOOKING_REFERENCE_ALPHABET.length)];
  }
  return reference;
}

/** `n***@example.com`: enough for the traveller to recognise the address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** `+234*******678`: country code and last three digits. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '***';
  return `${phone.slice(0, 4)}${'*'.repeat(phone.length - 7)}${phone.slice(-3)}`;
}

/** Last three characters of a passport number, for display next to a masked value. */
export function documentHint(number: string): string {
  return number.slice(-3);
}
