import * as z from 'zod';

/** Credential rules shared by the API and every sign-up / sign-in form. */
export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound protects the password hasher from denial-of-service with huge inputs. */
export const PASSWORD_MAX_LENGTH = 128;

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
export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema.optional(),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // No length rules on login: never reveal policy details for existing accounts.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  transport: authTransportSchema.default('token'),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;
