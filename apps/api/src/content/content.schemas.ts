import { z } from 'zod';

import { emailSchema, localeCodeSchema, moneyWireSchema, phoneSchema } from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

// ---------------------------------------------------------------------------
// Stored CMS content (cms_blocks.content). Validated on read: a malformed block is treated as
// absent and logged, so a CMS mistake can never break the homepage.
// ---------------------------------------------------------------------------

const httpsUrl = z.url({ protocol: /^https$/ });

/** Store links may only point at the official app stores. */
const storeUrl = (hosts: string[]) =>
  httpsUrl.refine((url) => hosts.includes(new URL(url).hostname), 'must be an official store URL');

export const cmsContentSchemas = {
  'home.hero': z.object({
    headline: z.string().trim().min(1).max(120),
    subheadline: z.string().trim().max(300).nullable().optional(),
  }),
  'home.prime': z.object({
    title: z.string().trim().min(1).max(120),
    benefits: z.array(z.string().trim().min(1).max(80)).max(6),
    priceMonthly: moneyWireSchema.nullable(),
    priceYearly: moneyWireSchema.nullable(),
  }),
  'home.why_book': z.object({
    items: z
      .array(
        z.object({
          icon: z.enum(['price', 'installments', 'support', 'secure']),
          title: z.string().trim().min(1).max(80),
          body: z.string().trim().max(200).optional(),
        }),
      )
      .max(8),
  }),
  'site.contact': z.object({
    phone: phoneSchema.nullable(),
    whatsapp: phoneSchema.nullable(),
    email: emailSchema.nullable(),
  }),
  'site.social': z.object({
    links: z
      .array(
        z.object({
          network: z.enum(['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin']),
          url: httpsUrl,
        }),
      )
      .max(8),
  }),
  'site.apps': z.object({
    iosUrl: storeUrl(['apps.apple.com']).nullable(),
    androidUrl: storeUrl(['play.google.com']).nullable(),
  }),
} as const;

export type CmsBlockKey = keyof typeof cmsContentSchemas;
export type CmsContent<K extends CmsBlockKey> = z.infer<(typeof cmsContentSchemas)[K]>;

/**
 * Structured page content (`page.<slug>` blocks): headings and plain paragraphs rendered as React
 * elements, so no HTML ever reaches the page. The admin console edits them as structured sections.
 */
export const pageContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  group: z.enum(['company', 'support', 'legal']),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(120).nullable().optional(),
        paragraphs: z.array(z.string().trim().min(1).max(4000)).min(1).max(50),
      }),
    )
    .min(1)
    .max(40),
});

export const PAGE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

export const contentQuerySchema = z.object({
  locale: localeCodeSchema.default('en-NG'),
});

export const pageParamsSchema = z.object({
  slug: z.string().max(40).regex(PAGE_SLUG_PATTERN),
});

const trustSignalSchema = named(
  'TrustSignal',
  z.object({
    key: z.string(),
    label: z.string(),
    value: z.string().nullable(),
  }),
);

export const siteContentSchema = named(
  'SiteContent',
  z.object({
    contact: z.object({
      phone: z.string().nullable(),
      whatsapp: z.string().nullable(),
      email: z.string().nullable(),
    }),
    social: z.array(z.object({ network: z.string(), url: z.string() })),
    apps: z.object({ iosUrl: z.string().nullable(), androidUrl: z.string().nullable() }),
    pages: z
      .array(z.object({ slug: z.string(), title: z.string(), group: z.string() }))
      .meta({ description: 'Published CMS pages, for footer links.' }),
    trustSignals: z
      .array(trustSignalSchema)
      .meta({ description: 'Verified trust signals only; unverified claims are never returned.' }),
    paymentMethods: z
      .array(z.object({ key: z.string(), label: z.string() }))
      .meta({ description: 'Methods offered by the enabled payment providers.' }),
  }),
);

export const homeContentSchema = named(
  'HomeContent',
  z.object({
    hero: z.object({ headline: z.string(), subheadline: z.string().nullable() }).nullable(),
    prime: z
      .object({
        title: z.string(),
        benefits: z.array(z.string()),
        priceMonthly: moneySchema.nullable(),
        priceYearly: moneySchema.nullable(),
      })
      .nullable(),
    whyBook: z
      .object({
        items: z.array(
          z.object({ icon: z.string(), title: z.string(), body: z.string().nullable() }),
        ),
      })
      .nullable(),
    faqs: z.array(z.object({ id: z.string(), question: z.string(), answer: z.string() })),
  }),
);

export const contentPageSchema = named(
  'ContentPage',
  z.object({
    slug: z.string(),
    title: z.string(),
    group: z.string(),
    sections: z.array(
      z.object({ heading: z.string().nullable(), paragraphs: z.array(z.string()) }),
    ),
    updatedAt: z.iso.datetime(),
  }),
);
