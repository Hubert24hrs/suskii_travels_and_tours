import { z } from 'zod';

import {
  BREACH_DATA_CATEGORIES,
  BREACH_NOTICE_DECISIONS,
  PRIVACY_JURISDICTIONS,
  PRIVACY_REFUSAL_REASONS,
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_REQUEST_STATUSES,
  privacyBreachCreateSchema,
  privacyBreachNoticeSchema,
  privacyRequestCloseSchema,
  privacyRequestCreateSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';

const timestamp = z.iso.datetime();

/** A request in the register: the person as an account id or a masked address, never in full. */
export const privacyRequestSchema = named(
  'PrivacyRequest',
  z.object({
    id: z.uuid(),
    kind: z.enum(PRIVACY_REQUEST_KINDS),
    jurisdiction: z.enum(PRIVACY_JURISDICTIONS),
    channel: z.enum(PRIVACY_REQUEST_CHANNELS),
    status: z.enum(PRIVACY_REQUEST_STATUSES),
    userId: z.uuid().nullable(),
    subjectEmail: z.string().nullable().meta({ description: 'Masked, e.g. `a***@example.com`.' }),
    receivedAt: timestamp,
    dueAt: timestamp,
    statutory: z
      .boolean()
      .meta({ description: 'Whether the due time is set by law (false: an internal target).' }),
    source: z.string().meta({ description: 'Where the due time comes from.' }),
    overdue: z.boolean(),
    closedAt: timestamp.nullable(),
    refusalReason: z.enum(PRIVACY_REFUSAL_REASONS).nullable(),
  }),
);

export const privacyRequestQuerySchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const privacyRequestPageSchema = named(
  'PrivacyRequestPage',
  z.object({ items: z.array(privacyRequestSchema), nextCursor: z.uuid().nullable() }),
);

export const privacyRecordParamsSchema = z.object({ id: z.uuid() });

export const breachNoticeSchema = named(
  'PrivacyBreachNotice',
  z.object({
    jurisdiction: z.enum(PRIVACY_JURISDICTIONS),
    regulator: z.string(),
    regulatorDueAt: timestamp,
    statutory: z.boolean(),
    source: z.string(),
    decision: z.enum(BREACH_NOTICE_DECISIONS),
    regulatorNotifiedAt: timestamp.nullable(),
    regulatorReference: z.string().nullable(),
    subjectsNotifiedAt: timestamp.nullable(),
    overdue: z.boolean().meta({ description: 'Still pending after the regulator deadline.' }),
  }),
);

export const privacyBreachSchema = named(
  'PrivacyBreach',
  z.object({
    id: z.uuid(),
    title: z.string(),
    awareAt: timestamp,
    highRisk: z.boolean(),
    categories: z.array(z.enum(BREACH_DATA_CATEGORIES)),
    subjectsAffected: z.int().nullable(),
    status: z.enum(['open', 'closed']),
    closedAt: timestamp.nullable(),
    notices: z.array(breachNoticeSchema),
  }),
);

export const privacyBreachDetailSchema = named(
  'PrivacyBreachDetail',
  privacyBreachSchema.extend({ details: z.string() }),
);

export const privacyBreachQuerySchema = z.object({
  status: z.enum(['open', 'closed']).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const privacyBreachPageSchema = named(
  'PrivacyBreachPage',
  z.object({ items: z.array(privacyBreachSchema), nextCursor: z.uuid().nullable() }),
);

export const adminPrivacyRequestCreateSchema = named(
  'PrivacyRequestCreate',
  privacyRequestCreateSchema,
);
export const adminPrivacyRequestCloseSchema = named(
  'PrivacyRequestClose',
  privacyRequestCloseSchema,
);
export const adminPrivacyBreachCreateSchema = named(
  'PrivacyBreachCreate',
  privacyBreachCreateSchema,
);
export const adminPrivacyBreachNoticeSchema = named(
  'PrivacyBreachNoticeInput',
  privacyBreachNoticeSchema,
);
