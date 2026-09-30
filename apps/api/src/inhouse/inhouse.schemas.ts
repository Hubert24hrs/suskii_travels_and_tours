import { z } from 'zod';

import {
  ADDON_PRICING_BASES,
  ADDON_PRODUCT_TYPES,
  addonDetailFieldsSchema,
  bookingReferenceSchema,
  cancellationPolicySchema,
  CATALOG_STATUSES,
  countryCodeSchema,
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  DEPARTURE_STATUSES,
  isValidTimeZone,
  itinerarySchema,
  lastNameSchema,
  MAX_ADDON_DAYS,
  MAX_TRAVELLERS,
  meetingPointSchema,
  moneyWireSchema,
  perPersonPricesSchema,
  slugSchema,
  textListSchema,
  VISA_PURPOSES,
  visaChecklistSchema,
} from '@suskii/shared';

import {
  cancellationTierDtoSchema,
  meetingPointDtoSchema,
  travellerCountsDtoSchema,
} from '../bookings/bookings.schemas';
import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const timestamp = z.iso.datetime();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use local time YYYY-MM-DDTHH:mm');
const booleanParam = z.enum(['true', 'false']).transform((value) => value === 'true');
const count = (min: number, fallback: number) =>
  z.coerce.number().int().min(min).max(MAX_TRAVELLERS).default(fallback);

export const slugParamsSchema = z.object({ slug: slugSchema });
export const idParamsSchema = z.object({ id: z.uuid() });

const currencyQuery = {
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY).meta({ description: 'Display currency.' }),
};
const travellerQuery = {
  adults: count(1, 2),
  children: count(0, 0),
  infants: count(0, 0),
};

/** Traveller counts in a request body: 1-9 in total, one lap infant per adult. */
export const travellerCountsInputSchema = z
  .object({
    adults: z.number().int().min(1).max(MAX_TRAVELLERS),
    children: z.number().int().min(0).max(MAX_TRAVELLERS),
    infants: z.number().int().min(0).max(MAX_TRAVELLERS),
  })
  .refine((counts) => counts.adults + counts.children + counts.infants <= MAX_TRAVELLERS, {
    message: 'too_many_travellers',
  })
  .refine((counts) => counts.infants <= counts.adults, { message: 'infants_exceed_adults' });

const productCard = {
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  artKey: z.string().nullable(),
  sample: z.boolean().meta({ description: 'Demo inventory: show a "Sample" badge.' }),
};

/** A per-person price as the traveller pays it (markup, fees and FX applied). */
export const perPersonPriceSchema = named(
  'PerPersonPrice',
  z.object({
    adult: moneySchema,
    child: moneySchema.nullable().meta({ description: 'Null: children cannot book.' }),
    infant: moneySchema.nullable().meta({ description: 'Null: infants cannot book.' }),
  }),
);

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

export const packageListQuerySchema = z.object({
  ...currencyQuery,
  ...travellerQuery,
  cityId: z.uuid().optional(),
  countryCode: countryCodeSchema.optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .meta({ description: 'Departures starting in this month (YYYY-MM).' }),
  from: isoDate.optional().meta({ description: 'Departures starting on or after this date.' }),
  to: isoDate.optional().meta({ description: 'Departures starting on or before this date.' }),
  budgetMin: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .meta({ description: 'Per adult, minor units of the display currency.' }),
  budgetMax: z.coerce.number().int().min(1).optional(),
  featured: booleanParam.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type PackageListQuery = z.output<typeof packageListQuerySchema>;

export const packageCardSchema = named(
  'PackageCard',
  z.object({
    ...productCard,
    featured: z.boolean(),
    cityName: z.string(),
    countryCode: z.string().length(2),
    nights: z.number().int(),
    fromPrice: moneySchema.meta({
      description: 'Lowest price per adult among matching departures.',
    }),
    nextDeparture: isoDate,
    departures: z.number().int().meta({ description: 'Matching departures with room left.' }),
  }),
);

export const packageListSchema = named(
  'PackageList',
  z.object({ packages: z.array(packageCardSchema) }),
);

export const packageDepartureSchema = named(
  'PackageDeparture',
  z.object({
    id: z.uuid(),
    startDate: isoDate,
    endDate: isoDate,
    seatsLeft: z.number().int(),
    prices: perPersonPriceSchema,
    bookable: z
      .boolean()
      .meta({ description: 'Enough room for the requested travellers, and they may book.' }),
  }),
);

export const packageDetailSchema = named(
  'PackageDetail',
  z.object({
    ...productCard,
    featured: z.boolean(),
    cityId: z.uuid(),
    cityName: z.string(),
    countryCode: z.string().length(2),
    nights: z.number().int(),
    passportRequired: z.boolean(),
    highlights: z.array(z.string()),
    itinerary: z.array(z.object({ day: z.number().int(), title: z.string(), body: z.string() })),
    inclusions: z.array(z.string()),
    exclusions: z.array(z.string()),
    cancellationPolicy: z.array(cancellationTierDtoSchema),
    departures: z.array(packageDepartureSchema),
  }),
);

// ---------------------------------------------------------------------------
// Tours
// ---------------------------------------------------------------------------

export const tourListQuerySchema = z.object({
  ...currencyQuery,
  ...travellerQuery,
  q: z.string().trim().min(2).max(64).optional().meta({ description: 'Tour, city or country.' }),
  cityId: z.uuid().optional(),
  date: isoDate.optional().meta({ description: 'Departures on this local date.' }),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});
export type TourListQuery = z.output<typeof tourListQuerySchema>;

export const tourCardSchema = named(
  'TourCard',
  z.object({
    ...productCard,
    featured: z.boolean(),
    cityName: z.string(),
    countryCode: z.string().length(2),
    durationMinutes: z.number().int(),
    category: z.string().nullable(),
    fromPrice: moneySchema,
    nextDeparture: localDateTime.meta({ description: 'Wall time at the meeting point.' }),
    departures: z.number().int(),
  }),
);

export const tourListSchema = named('TourList', z.object({ tours: z.array(tourCardSchema) }));

export const tourDepartureSchema = named(
  'TourDeparture',
  z.object({
    id: z.uuid(),
    startsAtLocal: localDateTime,
    startsAt: timestamp,
    seatsLeft: z.number().int(),
    prices: perPersonPriceSchema,
    bookable: z.boolean(),
  }),
);

export const tourDetailSchema = named(
  'TourDetail',
  z.object({
    ...productCard,
    featured: z.boolean(),
    cityId: z.uuid(),
    cityName: z.string(),
    countryCode: z.string().length(2),
    timeZone: z.string(),
    durationMinutes: z.number().int(),
    category: z.string().nullable(),
    meetingPoint: meetingPointDtoSchema,
    highlights: z.array(z.string()),
    inclusions: z.array(z.string()),
    exclusions: z.array(z.string()),
    cancellationPolicy: z.array(cancellationTierDtoSchema),
    departures: z.array(tourDepartureSchema),
  }),
);

// ---------------------------------------------------------------------------
// Add-ons (ADR-027)
// ---------------------------------------------------------------------------

export const addonListQuerySchema = z.object({
  ...currencyQuery,
  type: z.enum(ADDON_PRODUCT_TYPES).optional(),
  countryCode: countryCodeSchema.optional().meta({
    description: 'Only add-ons that apply there (or anywhere).',
  }),
  cityId: z.uuid().optional().meta({ description: "Resolved to the city's country." }),
});

export const addonCardSchema = named(
  'AddonCard',
  z.object({
    ...productCard,
    type: z.enum(ADDON_PRODUCT_TYPES),
    description: z.string(),
    countryCodes: z.array(z.string().length(2)).meta({ description: 'Empty: anywhere.' }),
    pricingBasis: z.enum(ADDON_PRICING_BASES),
    unitPrice: moneySchema.meta({ description: 'Per unit of `pricingBasis`.' }),
    maxTravellers: z.number().int(),
    requiredDetails: z.array(z.string()),
    cancellationPolicy: z.array(cancellationTierDtoSchema),
  }),
);

export const addonListSchema = named('AddonList', z.object({ addons: z.array(addonCardSchema) }));

export const addonLinkRequestSchema = named(
  'AddonLinkRequest',
  z.union([
    z.object({
      bookingId: z.uuid().meta({
        description: 'From the booking page (session or `X-Booking-Token`).',
      }),
    }),
    z.object({ reference: bookingReferenceSchema, lastName: lastNameSchema }),
  ]),
);
export type AddonLinkRequest = z.output<typeof addonLinkRequestSchema>;

export const addonLinkSchema = named(
  'AddonLink',
  z.object({
    linkToken: z.string().meta({ description: 'Send as `linkToken` in an add-on quote.' }),
    expiresAt: timestamp,
    trip: z.object({
      reference: z.string(),
      countryCode: z.string().length(2).nullable(),
      cityName: z.string().nullable(),
      startDate: isoDate,
      endDate: isoDate,
      travellers: travellerCountsDtoSchema,
    }),
  }),
);

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export const inhouseQuoteRequestSchema = named(
  'InhouseQuoteRequest',
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('package'),
      departureId: z.uuid(),
      travellers: travellerCountsInputSchema,
      currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    }),
    z.object({
      kind: z.literal('tour'),
      departureId: z.uuid(),
      travellers: travellerCountsInputSchema,
      currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    }),
    z.object({
      kind: z.literal('visa'),
      productId: z.uuid(),
      purpose: z.enum(VISA_PURPOSES),
      nationality: countryCodeSchema,
      travelDate: isoDate,
      travellers: travellerCountsInputSchema,
      currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    }),
    z.object({
      kind: z.literal('addon'),
      addonId: z.uuid(),
      startDate: isoDate,
      endDate: isoDate,
      travellers: travellerCountsInputSchema,
      linkToken: z
        .string()
        .max(300)
        .nullable()
        .default(null)
        .meta({ description: 'From `addon-links`, to attach the add-on to a booking.' }),
      cityId: z
        .uuid()
        .nullable()
        .default(null)
        .meta({ description: 'Standalone add-ons: the destination city.' }),
      currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
    }),
  ]),
);
export type InhouseQuoteInput = z.output<typeof inhouseQuoteRequestSchema>;

export const INHOUSE_QUOTE_ISSUES = {
  childrenNotAllowed: 'children_not_allowed',
  infantsNotAllowed: 'infants_not_allowed',
  tooManyTravellers: 'too_many_travellers',
  purposeNotOffered: 'purpose_not_offered',
  sameNationalityDestination: 'same_nationality_destination',
  datesInvalid: 'dates_invalid',
  notAvailableThere: 'not_available_there',
} as const;

// ---------------------------------------------------------------------------
// Vouchers (ADR-028)
// ---------------------------------------------------------------------------

export const redeemVoucherRequestSchema = named(
  'RedeemVoucherRequest',
  z.object({
    code: z.string().trim().min(10).max(80).meta({
      description: 'Typed code (dashes and spaces ignored) or the scanned QR payload.',
    }),
  }),
);

export const redeemedVoucherSchema = named(
  'RedeemedVoucher',
  z.object({
    bookingReference: z.string(),
    kind: z.enum(['package', 'tour', 'addon']),
    title: z.string(),
    startsOn: z.string().meta({ description: 'Local date (tours: local date and time).' }),
    travellers: z.number().int(),
    redeemedAt: timestamp,
  }),
);

// ---------------------------------------------------------------------------
// Admin: catalog management (catalog:manage)
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const artKeyValue = z.string().regex(/^[a-z0-9-]{1,60}$/, 'Use an art key such as city-lagos');
const artKey = artKeyValue.nullable().default(null);
const positiveMoney = moneyWireSchema.refine((value) => value.amountMinor > 0, 'must_be_positive');
const timeZoneSchema = z.string().refine(isValidTimeZone, 'Unknown IANA time zone');

export const catalogStatusSchema = z.enum(CATALOG_STATUSES);
export const departureStatusSchema = z.enum(DEPARTURE_STATUSES);

const packageFields = {
  slug: slugSchema,
  title: text(120),
  summary: text(400),
  cityId: z.uuid(),
  nights: z.number().int().min(0).max(60),
  passportRequired: z.boolean().default(true),
  artKey,
  featured: z.boolean().default(false),
  highlights: textListSchema.default([]),
  itinerary: itinerarySchema.default([]),
  inclusions: textListSchema.default([]),
  exclusions: textListSchema.default([]),
  cancellationPolicy: cancellationPolicySchema,
};
export const createPackageSchema = named('CreatePackage', z.object(packageFields));
export const updatePackageSchema = named(
  'UpdatePackage',
  z
    .object({
      title: packageFields.title,
      summary: packageFields.summary,
      nights: packageFields.nights,
      passportRequired: z.boolean(),
      artKey: artKeyValue.nullable(),
      featured: z.boolean(),
      highlights: textListSchema,
      itinerary: itinerarySchema,
      inclusions: textListSchema,
      exclusions: textListSchema,
      cancellationPolicy: cancellationPolicySchema,
      status: catalogStatusSchema,
    })
    .partial(),
);

export const createPackageDepartureSchema = named(
  'CreatePackageDeparture',
  z
    .object({
      startDate: isoDate,
      endDate: isoDate,
      capacity: z.number().int().min(1).max(1000),
      prices: perPersonPricesSchema,
      status: departureStatusSchema.default('open'),
    })
    .refine((value) => value.endDate >= value.startDate, {
      message: 'end_before_start',
      path: ['endDate'],
    }),
);
export const updateDepartureSchema = named(
  'UpdateDeparture',
  z
    .object({
      capacity: z.number().int().min(1).max(1000),
      prices: perPersonPricesSchema,
      status: departureStatusSchema,
    })
    .partial(),
);

const tourFields = {
  slug: slugSchema,
  title: text(120),
  summary: text(400),
  cityId: z.uuid(),
  timeZone: timeZoneSchema,
  durationMinutes: z.number().int().min(15).max(20_160),
  category: z.string().trim().max(40).nullable().default(null),
  artKey,
  featured: z.boolean().default(false),
  meetingPoint: meetingPointSchema,
  highlights: textListSchema.default([]),
  inclusions: textListSchema.default([]),
  exclusions: textListSchema.default([]),
  cancellationPolicy: cancellationPolicySchema,
};
export const createTourSchema = named('CreateTour', z.object(tourFields));
export const updateTourSchema = named(
  'UpdateTour',
  z
    .object({
      title: tourFields.title,
      summary: tourFields.summary,
      durationMinutes: tourFields.durationMinutes,
      category: z.string().trim().max(40).nullable(),
      artKey: artKeyValue.nullable(),
      featured: z.boolean(),
      meetingPoint: meetingPointSchema,
      highlights: textListSchema,
      inclusions: textListSchema,
      exclusions: textListSchema,
      cancellationPolicy: cancellationPolicySchema,
      status: catalogStatusSchema,
    })
    .partial(),
);
export const createTourDepartureSchema = named(
  'CreateTourDeparture',
  z.object({
    startsAtLocal: localDateTime,
    capacity: z.number().int().min(1).max(1000),
    prices: perPersonPricesSchema,
    status: departureStatusSchema.default('open'),
  }),
);

const addonFields = {
  slug: slugSchema,
  type: z.enum(ADDON_PRODUCT_TYPES),
  title: text(120),
  summary: text(300),
  description: text(2000),
  countryCodes: z.array(countryCodeSchema).max(60).default([]),
  pricingBasis: z.enum(ADDON_PRICING_BASES),
  price: positiveMoney,
  maxTravellers: z.number().int().min(1).max(MAX_TRAVELLERS).default(MAX_TRAVELLERS),
  requiredDetails: addonDetailFieldsSchema.default([]),
  cancellationPolicy: cancellationPolicySchema,
};
export const createAddonSchema = named('CreateAddon', z.object(addonFields));
export const updateAddonSchema = named(
  'UpdateAddon',
  z
    .object({
      title: addonFields.title,
      summary: addonFields.summary,
      description: addonFields.description,
      countryCodes: z.array(countryCodeSchema).max(60),
      price: positiveMoney,
      maxTravellers: z.number().int().min(1).max(MAX_TRAVELLERS),
      requiredDetails: addonDetailFieldsSchema,
      cancellationPolicy: cancellationPolicySchema,
      status: catalogStatusSchema,
    })
    .partial(),
);

const visaProductFields = {
  slug: slugSchema,
  title: text(120),
  summary: text(400),
  destination: countryCodeSchema,
  purposes: z
    .array(z.enum(VISA_PURPOSES))
    .min(1)
    .refine((items) => new Set(items).size === items.length, 'duplicate_purpose'),
  processingDaysMin: z.number().int().min(1).max(365),
  processingDaysMax: z.number().int().min(1).max(365),
  price: positiveMoney.meta({ description: 'Service fee per applicant (government fees apart).' }),
  checklist: visaChecklistSchema,
  governmentFeeNote: z.string().trim().max(500).nullable().default(null),
};
export const createVisaProductSchema = named(
  'CreateVisaProduct',
  z
    .object(visaProductFields)
    .refine((value) => value.processingDaysMax >= value.processingDaysMin, {
      message: 'max_below_min',
      path: ['processingDaysMax'],
    }),
);
export const updateVisaProductSchema = named(
  'UpdateVisaProduct',
  z
    .object({
      title: visaProductFields.title,
      summary: visaProductFields.summary,
      purposes: visaProductFields.purposes,
      processingDaysMin: visaProductFields.processingDaysMin,
      processingDaysMax: visaProductFields.processingDaysMax,
      price: positiveMoney,
      checklist: visaChecklistSchema,
      governmentFeeNote: z.string().trim().max(500).nullable(),
      status: catalogStatusSchema,
    })
    .partial(),
);

export const catalogCreatedSchema = named(
  'CatalogCreated',
  z.object({ id: z.uuid(), status: z.enum(CATALOG_STATUSES).or(z.enum(DEPARTURE_STATUSES)) }),
);

export const adminDepartureSchema = named(
  'AdminDeparture',
  z.object({
    id: z.uuid(),
    startsOn: z.string().meta({ description: 'Start date, or local start time for tours.' }),
    endsOn: isoDate.nullable(),
    capacity: z.number().int(),
    seatsReserved: z.number().int(),
    seatsSold: z.number().int(),
    prices: perPersonPricesSchema,
    status: departureStatusSchema,
  }),
);

export const adminProductSchema = named(
  'AdminProduct',
  z.object({
    id: z.uuid(),
    kind: z.enum(['package', 'tour', 'addon', 'visa']),
    slug: z.string(),
    title: z.string(),
    status: catalogStatusSchema,
    sample: z.boolean(),
    updatedAt: timestamp,
    departures: z.array(adminDepartureSchema),
  }),
);

export const adminProductListSchema = named(
  'AdminProductList',
  z.object({ products: z.array(adminProductSchema) }),
);

export const adminProductQuerySchema = z.object({
  kind: z.enum(['package', 'tour', 'addon', 'visa']),
  status: catalogStatusSchema.optional(),
});

export { MAX_ADDON_DAYS };
