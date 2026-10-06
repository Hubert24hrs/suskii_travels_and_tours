import { COOKIE_POLICY_VERSION, OPTIONAL_COOKIE_CATEGORIES } from '@suskii/shared';
import { z } from 'zod';

import { reauthProofSchema } from '../auth/auth.schemas';
import { named } from '../contract/contract';

import { DELETION_BLOCKERS } from './account-deletion.service';

export const dataExportBodySchema = named('DataExportRequest', reauthProofSchema);

export const deleteAccountBodySchema = named(
  'DeleteAccountRequest',
  reauthProofSchema.extend({
    confirm: z.literal('DELETE').describe('Typed by the user to confirm.'),
  }),
);

export const deletionCheckSchema = named(
  'AccountDeletionCheck',
  z.object({
    allowed: z.boolean(),
    blockers: z.array(z.enum(DELETION_BLOCKERS)),
    retentionYears: z
      .number()
      .int()
      .describe('Bookings, payments and refunds are kept this long, without contact details.'),
  }),
);

export const accountDeletedSchema = named(
  'AccountDeleted',
  z.object({
    deletedAt: z.iso.datetime(),
    retainedBookings: z.number().int().nonnegative(),
    retentionYears: z.number().int(),
  }),
);

const cookieChoicesSchema = z.object(
  Object.fromEntries(
    OPTIONAL_COOKIE_CATEGORIES.map((category) => [category, z.boolean()]),
  ) as Record<(typeof OPTIONAL_COOKIE_CATEGORIES)[number], z.ZodBoolean>,
);

export const cookieConsentBodySchema = named(
  'CookieConsentRequest',
  z.object({
    consentId: z.uuid().describe('Random id the browser keeps in its consent cookie.'),
    policyVersion: z
      .number()
      .int()
      .min(1)
      .max(COOKIE_POLICY_VERSION)
      .describe('Version of the cookie list the visitor saw.'),
    choices: cookieChoicesSchema.describe('Optional categories; strictly necessary are always on.'),
  }),
);

export const cookieConsentRecordedSchema = named(
  'CookieConsentRecorded',
  z.object({
    consentId: z.uuid(),
    policyVersion: z.number().int(),
    choices: cookieChoicesSchema,
    recordedAt: z.iso.datetime(),
  }),
);
