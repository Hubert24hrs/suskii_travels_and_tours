import { z } from 'zod';

import { localeCodeSchema } from '@suskii/shared';

import { cmsContentSchemas, PAGE_SLUG_PATTERN } from '../content/content.schemas';
import { named } from '../contract/contract';

const timestamp = z.iso.datetime();

/** Keys the public site reads: the fixed blocks, plus `page.<slug>` structured pages. */
export const CMS_FIXED_KEYS = Object.keys(cmsContentSchemas) as (keyof typeof cmsContentSchemas)[];
const PAGE_KEY = new RegExp(`^page\\.${PAGE_SLUG_PATTERN.source.slice(1, -1)}$`);

export const isCmsBlockKey = (key: string): boolean =>
  (CMS_FIXED_KEYS as string[]).includes(key) || (PAGE_KEY.test(key) && key.length <= 45);

export const cmsBlockParamsSchema = z.object({
  locale: localeCodeSchema,
  key: z
    .string()
    .max(45)
    .refine(isCmsBlockKey, 'unknown_block')
    .meta({ description: 'A fixed block key (home.hero, site.contact, ...) or page.<slug>.' }),
});

export const cmsBlockListQuerySchema = z.object({ locale: localeCodeSchema.optional() });

export const saveCmsBlockBodySchema = named(
  'SaveCmsBlockRequest',
  z.object({
    content: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Validated against the schema the public site parses for the key.' }),
    published: z.boolean(),
  }),
);

export const adminCmsBlockSchema = named(
  'AdminCmsBlock',
  z.object({
    key: z.string(),
    locale: localeCodeSchema,
    content: z.record(z.string(), z.unknown()),
    published: z.boolean(),
    publishedAt: timestamp.nullable(),
    valid: z
      .boolean()
      .meta({ description: 'False when the stored content would be ignored as malformed.' }),
    updatedAt: timestamp,
  }),
);

export const adminCmsBlockListSchema = named(
  'AdminCmsBlockList',
  z.object({
    blocks: z.array(adminCmsBlockSchema),
    fixedKeys: z.array(z.string()).meta({ description: 'Block keys the public site reads.' }),
  }),
);

const faqFields = z.object({
  locale: localeCodeSchema,
  question: z.string().trim().min(1).max(300),
  answer: z.string().trim().min(1).max(4000),
  sortOrder: z.number().int().min(0).max(10_000),
  published: z.boolean(),
});
export type FaqFields = z.infer<typeof faqFields>;

export const faqInputSchema = named('FaqInput', faqFields);
export const faqPatchSchema = named('FaqPatch', faqFields.partial());
export const adminFaqSchema = named(
  'AdminFaq',
  faqFields.extend({ id: z.uuid(), publishedAt: timestamp.nullable(), updatedAt: timestamp }),
);
export const adminFaqListSchema = named(
  'AdminFaqList',
  z.object({ faqs: z.array(adminFaqSchema) }),
);
export const faqListQuerySchema = z.object({ locale: localeCodeSchema.optional() });

export const trustSignalParamsSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,40}$/),
});

export const adminTrustSignalSchema = named(
  'AdminTrustSignal',
  z.object({
    key: z.string(),
    label: z.string(),
    value: z.string().nullable(),
    sortOrder: z.number().int(),
    verified: z.boolean().meta({ description: 'Only verified signals appear on the public site.' }),
    evidenceUrl: z.string().nullable(),
    verifiedAt: timestamp.nullable(),
    verifiedBy: z.uuid().nullable(),
    updatedAt: timestamp,
  }),
);
export const adminTrustSignalListSchema = named(
  'AdminTrustSignalList',
  z.object({ signals: z.array(adminTrustSignalSchema) }),
);

export const trustSignalPatchSchema = named(
  'TrustSignalPatch',
  z.object({
    label: z.string().trim().min(2).max(80).optional(),
    value: z.string().trim().min(1).max(40).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  }),
);

export const verifyTrustSignalBodySchema = named(
  'VerifyTrustSignalRequest',
  z.object({
    evidenceUrl: z
      .url({ protocol: /^https$/ })
      .max(500)
      .meta({ description: 'Where the proof lives (certificate, registry entry, audit report).' }),
  }),
);

export const unverifyTrustSignalBodySchema = named(
  'UnverifyTrustSignalRequest',
  z.object({ reason: z.string().trim().min(3).max(200) }),
);
