import { z } from 'zod';

import { PRICE_PRODUCTS, PROXY_CLASSES, SCRAPE_VENDORS } from '@suskii/shared';

/**
 * The public facts an observation may carry about what was priced (ADR-102). This list is the
 * whole of it: a field that is not here cannot be stored, whatever a page or a vendor returns.
 * None of them is about a person.
 */
export const PUBLIC_ITEM_FIELDS = [
  // What it is called on the site: a hotel, a fare brand, a car model or class, a tour.
  'title',
  // The business selling it there: a hotel chain, an airline, a rental company.
  'brand',
  'stars',
  'roomType',
  'board',
  'carrier',
  'flightNumber',
  'departure',
  'arrival',
  'stops',
  'cabin',
  'vehicleClass',
  'transmission',
  'seats',
  'duration',
  // The page of the item on the same site, so staff can check the price before confirming it.
  'link',
] as const;
export type PublicItemField = (typeof PUBLIC_ITEM_FIELDS)[number];

/** What a recipe may read besides the public facts: the price and what goes with it. */
export const RECIPE_FIELDS = [...PUBLIC_ITEM_FIELDS, 'price', 'currency', 'availability'] as const;
export type RecipeField = (typeof RECIPE_FIELDS)[number];

const selector = z.string().trim().min(1).max(200);

/** Where a field is on the page: a CSS selector, and an attribute when the text is not it. */
const fieldSelector = z.union([
  selector,
  z.object({ selector, attribute: z.string().regex(/^[a-zA-Z][a-zA-Z0-9:_-]{0,40}$/) }),
]);

const fieldMap = <T extends z.ZodType>(value: T) =>
  z
    .partialRecord(z.enum(RECIPE_FIELDS), value)
    .refine((fields) => fields.title !== undefined && fields.price !== undefined, {
      message: 'a recipe reads at least the title and the price',
    });

const structuredData = z.object({
  method: z.literal('structured_data'),
  /** schema.org types to read (`Hotel`, `Product`, `Flight`, `Car`...). */
  types: z
    .array(z.string().regex(/^[A-Za-z]{2,40}$/))
    .min(1)
    .max(10),
});

const selectors = z.object({
  method: z.literal('selectors'),
  /** The element of one priced item; the fields are looked for inside it. */
  item: selector,
  fields: fieldMap(fieldSelector),
});

const vendorFields = z.object({
  method: z.literal('vendor_fields'),
  /** Per field, the dotted path in each item a vendor returned (`price.amount`). */
  fields: fieldMap(z.string().regex(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,5}$/)),
});

/**
 * How a price is read from one site's page for one product (ADR-102): methods in the order
 * they are tried, under a version that every observation records. A person writes and changes
 * recipes; nothing approves one by itself.
 */
export const recipeSchema = z.object({
  version: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/),
  methods: z
    .array(z.discriminatedUnion('method', [structuredData, selectors, vendorFields]))
    .min(1)
    .max(4),
  /** Whether the site's prices include taxes and fees, when its pages say so; null when not. */
  taxesIncluded: z.boolean().nullable().default(null),
});
export type Recipe = z.infer<typeof recipeSchema>;
export type RecipeMethod = Recipe['methods'][number];

export const recipesSchema = z.partialRecord(z.enum(PRICE_PRODUCTS), recipeSchema);
export type Recipes = z.infer<typeof recipesSchema>;

/**
 * The page address of a question, per product: an https address with placeholders in braces.
 * Only these placeholders exist, each filled from a checked value and URL-encoded.
 */
export const URL_PLACEHOLDERS = [
  'origin',
  'destination',
  'place',
  'placeSlug',
  'from',
  'to',
  'adults',
  'children',
  'rooms',
] as const;
export type UrlPlaceholder = (typeof URL_PLACEHOLDERS)[number];

const template = z
  .string()
  .trim()
  .max(600)
  .regex(/^https:\/\/[^\s{}]+/, 'starts with https:// and a host without placeholders')
  .refine(
    (value) =>
      [...value.matchAll(/\{([^{}]*)\}/g)].every((match) =>
        (URL_PLACEHOLDERS as readonly string[]).includes(match[1] ?? ''),
      ),
    { message: 'unknown placeholder' },
  );

export const urlTemplatesSchema = z.partialRecord(z.enum(PRICE_PRODUCTS), template);
export type UrlTemplates = z.infer<typeof urlTemplatesSchema>;

/** Per vendor, what only that vendor needs. Values are plain settings, never keys. */
export const vendorSettingsSchema = z.partialRecord(
  z.enum(SCRAPE_VENDORS),
  z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/), z.unknown()),
);
export type VendorSettings = z.infer<typeof vendorSettingsSchema>;

export const freshnessSchema = z.partialRecord(
  z.enum(PRICE_PRODUCTS),
  z
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60),
);
export type Freshness = z.infer<typeof freshnessSchema>;

/** Minutes an observation counts as fresh when a policy names none: flights age fastest. */
export const DEFAULT_FRESHNESS_MINUTES = {
  flight: 30,
  hotel: 360,
  car: 720,
  transfer: 1440,
  tour: 1440,
} as const satisfies Record<(typeof PRICE_PRODUCTS)[number], number>;

export const proxyClassSchema = z.enum(PROXY_CLASSES);
