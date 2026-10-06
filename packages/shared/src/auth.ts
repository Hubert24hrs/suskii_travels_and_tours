import * as z from 'zod';

/** Credential rules shared by the API and every sign-up / sign-in form. */
export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound protects the password hasher from denial-of-service with huge inputs. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Context-specific words a password may not contain (ASVS 5.0 V6.1.2, V6.2.11): the brand and
 * product names (Suskii Travels, Suskii Prime, Suskii Errands). Compared after lower-casing and
 * undoing common character swaps, so "Susk11Pr1me!" counts too. Lower case, letters only.
 */
export const PASSWORD_CONTEXT_WORDS = ['suskii'] as const;

const LOOKALIKES: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
  '8': 'b',
};

/** Lower case letters only, with look-alike digits and symbols mapped back to letters. */
export function normalisePasswordWords(value: string): string {
  return [...value.toLowerCase()]
    .map((char) => LOOKALIKES[char] ?? char)
    .filter((char) => /\p{L}/u.test(char))
    .join('');
}

/**
 * The context word or account detail a password is built on, or null. `accountWords` are the
 * person's own details (the email's local part, their name); words shorter than four letters are
 * ignored so ordinary passwords are not refused by accident.
 */
export function passwordGuessableBy(
  password: string,
  accountWords: readonly (string | null | undefined)[] = [],
): string | null {
  const normalised = normalisePasswordWords(password);
  const words = [
    ...PASSWORD_CONTEXT_WORDS,
    ...accountWords.map((word) => normalisePasswordWords(word ?? '')),
  ];
  return words.find((word) => word.length >= 4 && normalised.includes(word)) ?? null;
}

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** E.164 phone number, e.g. +2348012345678. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +2348012345678');

export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const displayNameSchema = z.string().trim().min(1).max(100);

/** `cookie` for browsers (httpOnly cookies + CSRF), `token` for mobile apps (secure storage). */
export const authTransportSchema = z.enum(['cookie', 'token']);
export type AuthTransport = z.infer<typeof authTransportSchema>;

/** Registration never signs in directly (account privacy): the client signs in afterwards. */
/** A referral code as typed or shared; validated and normalised by the API (ADR-031). */
export const referralCodeInputSchema = z.string().trim().max(20);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
  referralCode: referralCodeInputSchema.optional(),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // No length rules on login: never reveal policy details for existing accounts.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  transport: authTransportSchema.default('token'),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;
