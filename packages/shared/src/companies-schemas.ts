import { z } from './zod-setup';

import { emailSchema } from './auth';
import {
  APPROVAL_MODES,
  APPROVAL_REJECT_REASONS,
  COMPANY_MAX_ADVANCE_DAYS,
  COMPANY_NAME_MAX,
  COMPANY_ROLES,
} from './companies';
import { countryCodeSchema } from './country-code';
import { CURRENCY_PATTERN } from './money';
import { CABIN_CLASSES } from './search-limits';

/** Optional short text: trimmed, and empty means none. */
const optionalCode = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === '' ? null : (value ?? null)));

/** A company as its admin describes it (ADR-078). */
export const companyInputSchema = z.object({
  name: z.string().trim().min(2).max(COMPANY_NAME_MAX),
  countryCode: countryCodeSchema,
  registrationNumber: optionalCode(40),
  taxId: optionalCode(40),
  billingEmail: emailSchema,
});
export type CompanyInput = z.infer<typeof companyInputSchema>;

/** The travel policy; a null field does not apply. The cap and its currency come together. */
export const travelPolicySchema = z
  .object({
    hotelNightlyCap: z
      .object({
        amountMinor: z.number().int().positive().refine(Number.isSafeInteger),
        currency: z.string().regex(CURRENCY_PATTERN),
      })
      .nullable(),
    maxCabin: z.enum(CABIN_CLASSES).nullable(),
    minAdvanceDays: z.number().int().min(0).max(COMPANY_MAX_ADVANCE_DAYS).nullable(),
    approvalMode: z.enum(APPROVAL_MODES),
  })
  .strict();
export type TravelPolicyInput = z.infer<typeof travelPolicySchema>;

export const companyInvitationInputSchema = z.object({
  email: emailSchema,
  role: z.enum(COMPANY_ROLES),
});
export type CompanyInvitationInput = z.infer<typeof companyInvitationInputSchema>;

export const approvalRejectSchema = z.object({ reason: z.enum(APPROVAL_REJECT_REASONS) });

/**
 * A top-up of the company wallet (ADR-090): the amount in minor units of a currency the wallet
 * takes; limits per currency come from the API (`topUpLimits` on the wallet).
 */
export const companyTopUpInputSchema = z.object({
  amount: z.object({
    amountMinor: z.number().int().positive().refine(Number.isSafeInteger),
    currency: z.string().regex(CURRENCY_PATTERN),
  }),
});
export type CompanyTopUpInput = z.infer<typeof companyTopUpInputSchema>;
