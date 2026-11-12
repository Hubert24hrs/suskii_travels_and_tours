import { z } from 'zod';

import {
  countryCodeSchema,
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  VISA_APPLICATION_STATUSES,
  VISA_DOCUMENT_STATUSES,
  VISA_PURPOSES,
  VISA_REQUIREMENTS,
  slugSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const timestamp = z.iso.datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const VISA_DOCUMENT_URL_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/octet-stream',
] as const;

// ---------------------------------------------------------------------------
// Public: eligibility and products
// ---------------------------------------------------------------------------

export const eligibilityQuerySchema = z
  .object({
    nationality: countryCodeSchema,
    destination: countryCodeSchema,
    purpose: z.enum(VISA_PURPOSES),
    currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
  })
  .refine((query) => query.nationality !== query.destination, {
    message: 'same_nationality_destination',
    path: ['destination'],
  });

export const visaProductCardSchema = named(
  'VisaProductCard',
  z.object({
    id: z.uuid(),
    slug: z.string(),
    title: z.string(),
    summary: z.string(),
    sample: z.boolean(),
    destination: z.string().length(2),
    purposes: z.array(z.enum(VISA_PURPOSES)),
    processingDaysMin: z.number().int(),
    processingDaysMax: z.number().int(),
    price: moneySchema.meta({ description: 'Service fee per applicant, priced for the caller.' }),
    governmentFeeNote: z.string().nullable(),
  }),
);

export const eligibilitySchema = named(
  'VisaEligibility',
  z.object({
    requirement: z
      .enum([...VISA_REQUIREMENTS, 'unknown'])
      .meta({ description: '`unknown`: no rule on file; we confirm by message, never guess.' }),
    maxStayDays: z.number().int().nullable(),
    notes: z.string().nullable(),
    verifiedAt: isoDate.nullable(),
    sample: z.boolean().meta({ description: 'A demo rule: show a "Sample" badge.' }),
    products: z.array(visaProductCardSchema),
    disclaimer: z.string(),
  }),
);

export const visaProductListQuerySchema = z.object({
  destination: countryCodeSchema.optional(),
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
});

export const visaProductListSchema = named(
  'VisaProductList',
  z.object({ products: z.array(visaProductCardSchema) }),
);

export const visaChecklistItemDtoSchema = named(
  'VisaChecklistItem',
  z.object({
    key: z.string(),
    label: z.string(),
    description: z.string(),
    required: z.boolean(),
  }),
);

export const visaProductDetailSchema = named(
  'VisaProductDetail',
  visaProductCardSchema.extend({
    checklist: z.array(visaChecklistItemDtoSchema),
    disclaimer: z.string(),
  }),
);

export const visaSlugParamsSchema = z.object({ slug: slugSchema });

// ---------------------------------------------------------------------------
// Owner: applications and documents
// ---------------------------------------------------------------------------

export const applicationParamsSchema = z.object({
  bookingId: z.uuid(),
  applicationId: z.uuid(),
});
export const uploadParamsSchema = applicationParamsSchema.extend({
  checklistKey: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
});
export const ownerDocumentParamsSchema = applicationParamsSchema.extend({ documentId: z.uuid() });
export const documentIdParamsSchema = z.object({ documentId: z.uuid() });
export const applicationIdParamsSchema = z.object({ applicationId: z.uuid() });

export const visaDocumentSchema = named(
  'VisaDocument',
  z.object({
    id: z.uuid(),
    checklistKey: z.string(),
    status: z.enum(VISA_DOCUMENT_STATUSES),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    fileName: z.string(),
    uploadedAt: timestamp,
  }),
);

export const visaApplicationSchema = named(
  'VisaApplication',
  z.object({
    id: z.uuid(),
    bookingId: z.uuid(),
    applicantPosition: z.number().int(),
    applicantName: z.string(),
    status: z.enum(VISA_APPLICATION_STATUSES),
    destination: z.string().length(2),
    purpose: z.enum(VISA_PURPOSES),
    travelDate: isoDate,
    submittedAt: timestamp.nullable(),
    closedAt: timestamp.nullable(),
    checklist: z.array(
      visaChecklistItemDtoSchema.extend({
        document: visaDocumentSchema
          .nullable()
          .meta({ description: 'The current upload for this item, if any.' }),
      }),
    ),
    messages: z
      .array(
        z.object({
          occurredAt: timestamp,
          status: z.enum(VISA_APPLICATION_STATUSES).nullable(),
          message: z.string().nullable(),
        }),
      )
      .meta({ description: 'Status changes and messages from our visa team, oldest first.' }),
    canUpload: z.boolean(),
    canSubmit: z.boolean().meta({
      description: 'Every required item has a clean document and the status allows submission.',
    }),
    disclaimer: z.string(),
  }),
);
export type VisaApplicationDto = z.infer<typeof visaApplicationSchema>;

export const documentLinkSchema = named(
  'VisaDocumentLink',
  z.object({
    url: z.string().meta({
      description:
        'API-relative path to the document bytes; valid until `expiresAt` for this viewer only.',
    }),
    expiresAt: timestamp,
  }),
);

export const documentContentQuerySchema = z.object({
  expires: z.coerce.number().int().positive(),
  viewer: z.string().regex(/^(c|s)\.[0-9a-f-]{36}$/),
  signature: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
});

// ---------------------------------------------------------------------------
// Visa officers (visa:process)
// ---------------------------------------------------------------------------

export const officerApplicationQuerySchema = z.object({
  status: z.enum(VISA_APPLICATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const officerApplicationSummarySchema = named(
  'OfficerVisaApplicationSummary',
  z.object({
    id: z.uuid(),
    bookingReference: z.string(),
    applicantName: z.string(),
    nationality: z.string().length(2),
    destination: z.string().length(2),
    purpose: z.enum(VISA_PURPOSES),
    travelDate: isoDate,
    status: z.enum(VISA_APPLICATION_STATUSES),
    submittedAt: timestamp.nullable(),
    updatedAt: timestamp,
  }),
);

export const officerApplicationListSchema = named(
  'OfficerVisaApplicationList',
  z.object({ applications: z.array(officerApplicationSummarySchema) }),
);

export const officerApplicationSchema = named(
  'OfficerVisaApplication',
  visaApplicationSchema.omit({ messages: true, canUpload: true, canSubmit: true }).extend({
    bookingReference: z.string(),
    nationality: z.string().length(2),
    passport: z
      .object({ hint: z.string(), issuingCountry: z.string().length(2), expiryDate: isoDate })
      .nullable()
      .meta({ description: 'Masked; the full passport is in the uploaded scan.' }),
    allowedTransitions: z.array(z.enum(VISA_APPLICATION_STATUSES)),
    events: z.array(
      z.object({
        occurredAt: timestamp,
        kind: z.string(),
        fromStatus: z.enum(VISA_APPLICATION_STATUSES).nullable(),
        toStatus: z.enum(VISA_APPLICATION_STATUSES).nullable(),
        message: z.string().nullable(),
        note: z.string().nullable().meta({ description: 'Internal; never shown to the customer.' }),
        actorType: z.string(),
      }),
    ),
    documents: z.array(
      visaDocumentSchema.extend({
        supersededAt: timestamp.nullable(),
        deletedAt: timestamp.nullable(),
      }),
    ),
  }),
);
export type OfficerApplicationDto = z.infer<typeof officerApplicationSchema>;

export const officerTransitionRequestSchema = named(
  'VisaApplicationTransition',
  z.object({
    to: z.enum(VISA_APPLICATION_STATUSES),
    message: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .nullable()
      .default(null)
      .meta({ description: 'Shown to the customer (and emailed).' }),
    note: z.string().trim().min(1).max(2000).nullable().default(null),
  }),
);

export const officerCommentRequestSchema = named(
  'VisaApplicationComment',
  z
    .object({
      message: z.string().trim().min(1).max(2000).nullable().default(null),
      note: z.string().trim().min(1).max(2000).nullable().default(null),
    })
    .refine((value) => value.message !== null || value.note !== null, 'message_or_note'),
);

export const rejectDocumentRequestSchema = named(
  'RejectVisaDocument',
  z.object({ message: z.string().trim().min(3).max(1000) }),
);

export const visaRuleSchema = named(
  'VisaRule',
  z.object({
    id: z.uuid(),
    nationality: z.string().length(2),
    destination: z.string().length(2),
    purpose: z.enum(VISA_PURPOSES),
    requirement: z.enum(VISA_REQUIREMENTS),
    maxStayDays: z.number().int().nullable(),
    notes: z.string().nullable(),
    verifiedAt: isoDate.nullable(),
    sample: z.boolean(),
    updatedAt: timestamp,
  }),
);

export const visaRuleListSchema = named(
  'VisaRuleList',
  z.object({ rules: z.array(visaRuleSchema) }),
);

export const visaRuleQuerySchema = z.object({
  nationality: countryCodeSchema.optional(),
  destination: countryCodeSchema.optional(),
});

export const upsertVisaRuleSchema = named(
  'UpsertVisaRule',
  z
    .object({
      nationality: countryCodeSchema,
      destination: countryCodeSchema,
      purpose: z.enum(VISA_PURPOSES),
      requirement: z.enum(VISA_REQUIREMENTS),
      maxStayDays: z.number().int().min(1).max(3650).nullable().default(null),
      notes: z.string().trim().max(1000).nullable().default(null),
      verifiedAt: isoDate.nullable().default(null),
    })
    .refine((value) => value.nationality !== value.destination, {
      message: 'same_nationality_destination',
      path: ['destination'],
    }),
);

export const ruleIdParamsSchema = z.object({ ruleId: z.uuid() });

// ---------------------------------------------------------------------------
// Internal (worker)
// ---------------------------------------------------------------------------

export const scanRunSchema = named(
  'VisaScanRun',
  z.object({
    scanned: z.number().int(),
    clean: z.number().int(),
    infected: z.number().int(),
    failed: z.number().int(),
  }),
);

export const pruneRunSchema = named('VisaPruneRun', z.object({ deleted: z.number().int() }));
