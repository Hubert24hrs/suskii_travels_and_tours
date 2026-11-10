import { z } from 'zod';

import {
  AUTOMATED_ACCESS_FINDINGS,
  OBSERVATION_AVAILABILITY,
  OBSERVATION_FLAGS,
  OBSERVATION_STATUSES,
  PRICE_PRODUCTS,
  PROXY_CLASSES,
  SCRAPE_FAILURE_CLASSES,
  SCRAPE_VENDORS,
  SOURCE_POLICY_BASES,
  SOURCE_POLICY_STATUSES,
  isValidTimeZone,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

import { BUDGET_SCOPES } from './price-intel-budget';
import { KILL_SCOPES } from './price-intel-switches';
import {
  PUBLIC_ITEM_FIELDS,
  freshnessSchema,
  recipesSchema,
  urlTemplatesSchema,
  vendorSettingsSchema,
} from './recipes';

const timestamp = z.iso.datetime();
const country = z.string().regex(/^[A-Z]{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// --- A question put to a site ------------------------------------------------------------------

/**
 * What a site is asked: places, dates and head counts. Nothing here is about a person, and
 * every value is checked before it goes into a page address.
 */
export const priceQuerySchema = named(
  'PriceQuery',
  z
    .object({
      /** Airport codes, for flights. */
      origin: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      destination: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      /** A city or an area by name, for hotels, cars and tours. */
      place: z
        .string()
        .trim()
        .regex(/^[\p{L}][\p{L}\p{M} .,'-]{1,59}$/u)
        .optional(),
      from: date,
      to: date.optional(),
      adults: z.number().int().min(1).max(9).default(1),
      children: z.number().int().min(0).max(8).default(0),
      rooms: z.number().int().min(1).max(5).default(1),
    })
    .refine((query) => !query.to || query.to >= query.from, {
      path: ['to'],
      message: 'ends before it starts',
    }),
);
export type PriceQuery = z.infer<typeof priceQuerySchema>;

// --- Sources and their policies ----------------------------------------------------------------

/** What every site states for itself: there is no sensible default for any of these. */
const statedFields = {
  name: z.string().trim().min(2).max(120),
  products: z.array(z.enum(PRICE_PRODUCTS)).min(1).max(PRICE_PRODUCTS.length),
  country,
  currency,
  locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  urlTemplates: urlTemplatesSchema,
  recipes: recipesSchema,
  vendors: z.array(z.enum(SCRAPE_VENDORS)).min(1).max(SCRAPE_VENDORS.length),
  timeZone: z.string().max(64).refine(isValidTimeZone, { message: 'unknown time zone' }),
};

/**
 * What a new site gets when its creator leaves it out: nothing known about its robots file or
 * terms, no proxy, a slow rate, one request at a time. The defaults are applied on creation
 * only. A change must never carry one: it would quietly reset what an approver agreed to.
 */
const ruleFields = {
  vendorSettings: vendorSettingsSchema,
  robots: z.enum(AUTOMATED_ACCESS_FINDINGS),
  terms: z.enum(AUTOMATED_ACCESS_FINDINGS),
  maxProxyClass: z.enum(PROXY_CLASSES),
  requestsPerMinute: z.number().int().min(1).max(600),
  maxConcurrency: z.number().int().min(1).max(20),
  nightStartHour: z.number().int().min(0).max(23),
  nightEndHour: z.number().int().min(0).max(23),
  freshnessMinutes: freshnessSchema,
  active: z.boolean(),
};

export const priceSourceInputSchema = named(
  'PriceSourceInput',
  z.object({
    domain: z.string().trim().min(4).max(253),
    ...statedFields,
    vendorSettings: ruleFields.vendorSettings.default({}),
    robots: ruleFields.robots.default('unknown'),
    terms: ruleFields.terms.default('unknown'),
    maxProxyClass: ruleFields.maxProxyClass.default('none'),
    requestsPerMinute: ruleFields.requestsPerMinute.default(6),
    maxConcurrency: ruleFields.maxConcurrency.default(1),
    nightStartHour: ruleFields.nightStartHour.default(1),
    nightEndHour: ruleFields.nightEndHour.default(5),
    freshnessMinutes: ruleFields.freshnessMinutes.default({}),
    active: ruleFields.active.default(true),
  }),
);
export type PriceSourceInput = z.infer<typeof priceSourceInputSchema>;

/**
 * Everything but the domain (a site's rules never move to another site), and only what was
 * sent: no field has a default here.
 */
export const priceSourcePatchSchema = named(
  'PriceSourcePatch',
  z
    .object({ ...statedFields, ...ruleFields })
    .partial()
    .refine((patch) => Object.keys(patch).length > 0, { message: 'nothing to change' }),
);
export type PriceSourcePatch = z.infer<typeof priceSourcePatchSchema>;

export const sourceApprovalSchema = named(
  'PriceSourceApproval',
  z.object({
    basis: z.enum(SOURCE_POLICY_BASES),
    basisReference: z.string().trim().min(4).max(200).meta({
      description:
        'Where the basis is written down: a contract number, a document title, a file reference. Never a person or a contact detail.',
    }),
  }),
);
export type SourceApproval = z.infer<typeof sourceApprovalSchema>;

export const priceSourceSchema = named(
  'PriceSource',
  z.object({
    id: z.uuid(),
    domain: z.string(),
    name: z.string(),
    products: z.array(z.enum(PRICE_PRODUCTS)),
    country,
    currency,
    locale: z.string(),
    urlTemplates: urlTemplatesSchema,
    recipes: recipesSchema,
    vendorSettings: vendorSettingsSchema,
    active: z.boolean(),
    status: z.enum(SOURCE_POLICY_STATUSES),
    basis: z.enum(SOURCE_POLICY_BASES).nullable(),
    basisReference: z.string().nullable(),
    robots: z.enum(AUTOMATED_ACCESS_FINDINGS),
    terms: z.enum(AUTOMATED_ACCESS_FINDINGS),
    vendors: z.array(z.enum(SCRAPE_VENDORS)),
    maxProxyClass: z.enum(PROXY_CLASSES),
    requestsPerMinute: z.number().int(),
    maxConcurrency: z.number().int(),
    nightStartHour: z.number().int(),
    nightEndHour: z.number().int(),
    timeZone: z.string(),
    freshnessMinutes: freshnessSchema,
    decidedAt: timestamp.nullable(),
    /** Set while its parser is failing: reads start at the recipe's next method. */
    drift: z.object({ since: timestamp, parserVersion: z.string() }).nullable(),
    /** Whether a read would fetch anything right now, and if not, why. */
    readable: z.enum(['yes', 'review_mock_only', 'blocked', 'inactive', 'switched_off']),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export type PriceSourceDto = z.infer<typeof priceSourceSchema>;

export const priceSourceListSchema = named(
  'PriceSourceList',
  z.object({ items: z.array(priceSourceSchema) }),
);

export const sourceIdParamsSchema = z.object({ sourceId: z.uuid() });

// --- Reads and observations --------------------------------------------------------------------

const publicItemSchema = z.partialRecord(
  z.enum(PUBLIC_ITEM_FIELDS),
  z.union([z.string(), z.number()]),
);

export const priceObservationSchema = named(
  'PriceObservation',
  z.object({
    id: z.uuid(),
    sourceId: z.uuid(),
    domain: z.string(),
    product: z.enum(PRICE_PRODUCTS),
    price: moneySchema,
    taxesIncluded: z.boolean().nullable(),
    availability: z.enum(OBSERVATION_AVAILABILITY),
    item: publicItemSchema,
    confidence: z.number().int().min(0).max(100),
    status: z.enum(OBSERVATION_STATUSES),
    flags: z.array(z.enum(OBSERVATION_FLAGS)),
    observedAt: timestamp,
    freshUntil: timestamp,
    stale: z.boolean(),
    /** Always true: a price seen on a site is never one Suskii sells at by itself (ADR-104). */
    indicative: z.literal(true),
  }),
);
export type PriceObservationDto = z.infer<typeof priceObservationSchema>;

export const priceReadInputSchema = named(
  'PriceReadInput',
  z.object({ product: z.enum(PRICE_PRODUCTS), query: priceQuerySchema }),
);
export type PriceReadInput = z.infer<typeof priceReadInputSchema>;

export const READ_STATES = ['fresh', 'read', 'stale', 'exhausted', 'denied'] as const;

export const priceReadResultSchema = named(
  'PriceReadResult',
  z.object({
    state: z.enum(READ_STATES).meta({
      description:
        '`fresh`: answered from observations still fresh. `read`: read now. `stale`: the read failed and older observations are shown as stale. `exhausted`: nothing could be read. `denied`: the policy, a switch or a budget said no.',
    }),
    failure: z.enum(SCRAPE_FAILURE_CLASSES).nullable(),
    /** Why a read was denied or gave up: a short code. */
    reason: z.string().nullable(),
    jobId: z.uuid().nullable(),
    observations: z.array(priceObservationSchema),
  }),
);
export type PriceReadResult = z.infer<typeof priceReadResultSchema>;

export const observationQuerySchema = z.object({
  product: z.enum(PRICE_PRODUCTS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const priceObservationListSchema = named(
  'PriceObservationList',
  z.object({ items: z.array(priceObservationSchema) }),
);

const attemptSchema = z.object({
  vendor: z.enum(SCRAPE_VENDORS),
  proxyClass: z.enum(PROXY_CLASSES),
  outcome: z.string(),
  httpStatus: z.number().int().nullable(),
  rendered: z.boolean(),
  durationMs: z.number().int(),
  costMicroUsd: z.number().int(),
  hasSnapshot: z.boolean(),
});

export const scrapeJobSchema = named(
  'ScrapeJob',
  z.object({
    id: z.uuid(),
    sourceId: z.uuid(),
    domain: z.string(),
    product: z.enum(PRICE_PRODUCTS),
    query: z.record(z.string(), z.unknown()),
    trigger: z.string(),
    status: z.enum(['running', 'succeeded', 'exhausted', 'denied', 'failed']),
    failureClass: z.string().nullable(),
    costMicroUsd: z.number().int(),
    observationCount: z.number().int(),
    startedAt: timestamp,
    finishedAt: timestamp.nullable(),
    attempts: z.array(attemptSchema),
  }),
);

export const jobQuerySchema = z.object({
  sourceId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const scrapeJobListSchema = named(
  'ScrapeJobList',
  z.object({ items: z.array(scrapeJobSchema) }),
);

// --- Switches, budgets and vendor health --------------------------------------------------------

export const killSwitchInputSchema = named(
  'PriceIntelSwitchInput',
  z
    .object({
      scope: z.enum(KILL_SCOPES),
      subject: z.string().trim().min(1).max(253).nullable().default(null),
    })
    .refine((input) => (input.scope === 'global') === (input.subject === null), {
      path: ['subject'],
      message: 'a vendor or a domain needs a subject; the global switch has none',
    }),
);
export type KillSwitchInput = z.infer<typeof killSwitchInputSchema>;

const killSwitchSchema = z.object({
  scope: z.enum(KILL_SCOPES),
  subject: z.string().nullable(),
});

export const killSwitchListSchema = named(
  'PriceIntelSwitchList',
  z.object({ items: z.array(killSwitchSchema) }),
);

const microUsd = z.number().int().min(0).max(1_000_000_000_000);

export const budgetInputSchema = named(
  'PriceIntelBudgetInput',
  z.object({
    scope: z.enum(BUDGET_SCOPES),
    subject: z.string().trim().min(1).max(253),
    dailyCapMicroUsd: microUsd,
    monthlyCapMicroUsd: microUsd,
  }),
);
export type BudgetInput = z.infer<typeof budgetInputSchema>;

export const budgetLineSchema = named(
  'PriceIntelBudget',
  z.object({
    scope: z.enum(BUDGET_SCOPES),
    subject: z.string(),
    dailyCapMicroUsd: z.number().int(),
    monthlyCapMicroUsd: z.number().int(),
    spentTodayMicroUsd: z.number().int(),
    spentThisMonthMicroUsd: z.number().int(),
    set: z.boolean(),
  }),
);

export const priceIntelOverviewSchema = named(
  'PriceIntelOverview',
  z.object({
    enabled: z.boolean(),
    vendors: z.array(
      z.object({
        vendor: z.enum(SCRAPE_VENDORS),
        /** The key works; null when the vendor could not be asked in time. */
        ok: z.boolean().nullable(),
        remaining: z.number().nullable(),
        proxyClasses: z.array(z.enum(PROXY_CLASSES)),
        render: z.boolean(),
      }),
    ),
    switches: z.array(killSwitchSchema),
    budgets: z.array(budgetLineSchema),
    sources: z.object({
      review: z.number().int(),
      approved: z.number().int(),
      blocked: z.number().int(),
    }),
  }),
);
export type PriceIntelOverview = z.infer<typeof priceIntelOverviewSchema>;

export const scrapingRegisterSchema = named(
  'ScrapingRegister',
  z.object({
    generatedAt: timestamp,
    rows: z.array(
      z.object({
        domain: z.string(),
        name: z.string(),
        status: z.enum(SOURCE_POLICY_STATUSES),
        basis: z.enum(SOURCE_POLICY_BASES).nullable(),
        basisReference: z.string().nullable(),
        robots: z.enum(AUTOMATED_ACCESS_FINDINGS),
        terms: z.enum(AUTOMATED_ACCESS_FINDINGS),
        products: z.array(z.enum(PRICE_PRODUCTS)),
        vendors: z.array(z.enum(SCRAPE_VENDORS)),
        maxProxyClass: z.enum(PROXY_CLASSES),
        requestsPerMinute: z.number().int(),
        decidedAt: timestamp.nullable(),
      }),
    ),
  }),
);

export const sweepResultSchema = named(
  'PriceIntelSweep',
  z.object({
    sources: z.number().int().min(0),
    read: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
);
