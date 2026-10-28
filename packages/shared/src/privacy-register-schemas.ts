import { z } from './zod-setup';

import { emailSchema } from './auth';
import {
  BREACH_DATA_CATEGORIES,
  PRIVACY_JURISDICTIONS,
  PRIVACY_REFUSAL_REASONS,
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_REQUEST_KINDS,
} from './privacy-rules';

export const BREACH_TITLE_MAX = 120;
export const BREACH_DETAILS_MAX = 4000;

/** Not later than now (a minute of clock skew allowed): the register records what happened. */
const pastInstant = z.iso
  .datetime()
  .refine((value) => Date.parse(value) <= Date.now() + 60_000, { message: 'in_future' });

/**
 * A request staff record from an email, a call or a letter (ADR-089). The person is an account
 * or an email address to answer; self-service export and deletion are recorded by the API itself.
 */
export const privacyRequestCreateSchema = z
  .object({
    kind: z.enum(PRIVACY_REQUEST_KINDS),
    jurisdiction: z.enum(PRIVACY_JURISDICTIONS),
    channel: z.enum(PRIVACY_REQUEST_CHANNELS).exclude(['self_service']),
    receivedAt: pastInstant,
    userId: z.uuid().nullish(),
    subjectEmail: emailSchema.nullish(),
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.subjectEmail), {
    message: 'account_or_email',
    path: ['subjectEmail'],
  });
export type PrivacyRequestCreateInput = z.infer<typeof privacyRequestCreateSchema>;

export const privacyRequestCloseSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('completed') }),
  z.object({ outcome: z.literal('refused'), reason: z.enum(PRIVACY_REFUSAL_REASONS) }),
]);
export type PrivacyRequestCloseInput = z.infer<typeof privacyRequestCloseSchema>;

/** A breach as staff open it; `details` is encrypted and shown only on the breach itself. */
export const privacyBreachCreateSchema = z.object({
  title: z.string().trim().min(3).max(BREACH_TITLE_MAX),
  details: z.string().trim().min(1).max(BREACH_DETAILS_MAX),
  awareAt: pastInstant,
  highRisk: z.boolean(),
  categories: z.array(z.enum(BREACH_DATA_CATEGORIES)).min(1).max(BREACH_DATA_CATEGORIES.length),
  jurisdictions: z
    .array(z.enum(PRIVACY_JURISDICTIONS))
    .min(1)
    .max(PRIVACY_JURISDICTIONS.length)
    .refine((list) => new Set(list).size === list.length, { message: 'listed_twice' }),
  subjectsAffected: z.int().min(0).nullish(),
});
export type PrivacyBreachCreateInput = z.infer<typeof privacyBreachCreateSchema>;

/** What happened with one regulator: notified (with when and their reference) or not required. */
export const privacyBreachNoticeSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('notified'),
    jurisdiction: z.enum(PRIVACY_JURISDICTIONS),
    regulatorNotifiedAt: pastInstant,
    regulatorReference: z.string().trim().min(1).max(100).nullish(),
    subjectsNotifiedAt: pastInstant.nullish(),
  }),
  z.object({
    decision: z.literal('not_required'),
    jurisdiction: z.enum(PRIVACY_JURISDICTIONS),
  }),
]);
export type PrivacyBreachNoticeInput = z.infer<typeof privacyBreachNoticeSchema>;
