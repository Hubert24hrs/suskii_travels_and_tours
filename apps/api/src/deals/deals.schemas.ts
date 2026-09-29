import { z } from 'zod';

import {
  CABIN_CLASSES,
  DEFAULT_CURRENCY,
  currencyCodeSchema,
  iataCodeSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const displayCurrency = currencyCodeSchema
  .default(DEFAULT_CURRENCY)
  .meta({ description: 'Display currency.' });

// ---------------------------------------------------------------------------
// Flight deals
// ---------------------------------------------------------------------------

export const dealsQuerySchema = z.object({
  origin: iataCodeSchema.optional().meta({ description: 'Only deals from this airport.' }),
  currency: displayCurrency,
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

export const currencyOnlyQuerySchema = z.object({ currency: displayCurrency });

const dealPlaceSchema = z.object({
  code: z.string(),
  cityName: z.string(),
  countryCode: z.string(),
});

export const flightDealSchema = named(
  'FlightDeal',
  z.object({
    id: z.string(),
    routeSlug: z.string(),
    origin: dealPlaceSchema,
    destination: dealPlaceSchema,
    departureDate: isoDate,
    returnDate: isoDate.nullable(),
    carrier: z.object({ code: z.string(), name: z.string() }),
    cabinClass: z.enum(CABIN_CLASSES),
    stops: z.number().int().meta({ description: 'Stops on the outbound flight.' }),
    durationMinutes: z.number().int().meta({ description: 'Outbound journey time.' }),
    price: moneySchema.meta({
      description: 'Per adult for the whole trip, taxes and fees included: a "from" price.',
    }),
    sample: z
      .boolean()
      .meta({ description: 'Quote from the mock supplier: show it as a sample fare.' }),
    updatedAt: z.iso.datetime().meta({ description: 'When the fare was found.' }),
  }),
);

export const flightDealsSchema = named(
  'FlightDeals',
  z.object({
    currency: z.string(),
    origins: z
      .array(z.object({ code: z.string(), cityName: z.string() }))
      .meta({ description: 'Departure cities that currently have fresh deals.' }),
    deals: z.array(flightDealSchema),
  }),
);

const dealRouteSummarySchema = z.object({
  slug: z.string(),
  origin: dealPlaceSchema,
  destination: dealPlaceSchema,
});

export const dealRoutesSchema = named(
  'DealRoutes',
  z.object({ routes: z.array(dealRouteSummarySchema) }),
);

export const dealRouteParamsSchema = z.object({ slug: z.string().max(80).regex(SLUG) });

export const dealRouteSchema = named(
  'DealRouteDetail',
  dealRouteSummarySchema.extend({
    cabinClass: z.enum(CABIN_CLASSES),
    stayNights: z.number().int(),
    currency: z.string(),
    deal: flightDealSchema.nullable().meta({ description: 'Latest fresh fare, if any.' }),
    relatedRoutes: z.array(dealRouteSummarySchema),
  }),
);

// ---------------------------------------------------------------------------
// Hotel destinations
// ---------------------------------------------------------------------------

export const hotelDestinationSchema = named(
  'HotelDestination',
  z.object({
    id: z.string(),
    slug: z.string(),
    city: z.object({ id: z.string(), name: z.string() }),
    country: z.object({ code: z.string(), name: z.string() }),
    imageUrl: z.string().nullable().meta({ description: 'Licensed photo, when the CMS has one.' }),
    hotelCount: z.number().int().nullable(),
    fromPricePerNight: moneySchema
      .nullable()
      .meta({ description: 'Cheapest nightly rate found, taxes and fees included.' }),
    sample: z.boolean().nullable().meta({ description: 'Rates from the mock supplier.' }),
    updatedAt: z.iso.datetime().nullable(),
  }),
);

export const hotelDestinationsSchema = named(
  'HotelDestinations',
  z.object({ currency: z.string(), destinations: z.array(hotelDestinationSchema) }),
);

export const destinationParamsSchema = z.object({ slug: z.string().max(80).regex(SLUG) });

// ---------------------------------------------------------------------------
// Internal refresh routes (worker)
// ---------------------------------------------------------------------------

export const refreshTargetsSchema = named(
  'RefreshTargets',
  z.object({
    dealRoutes: z.array(z.object({ id: z.string(), slug: z.string() })),
    hotelDestinations: z.array(z.object({ id: z.string(), slug: z.string() })),
  }),
);

export const refreshResultSchema = named(
  'RefreshResult',
  z.object({
    status: z.enum(['refreshed', 'no_results', 'inactive']),
    snapshotId: z.string().nullable(),
    fetchedAt: z.iso.datetime().nullable(),
  }),
);

export const pruneResultSchema = named(
  'PruneResult',
  z.object({ deletedDeals: z.number().int(), deletedDestinations: z.number().int() }),
);

export const routeIdParamsSchema = z.object({ routeId: z.uuid() });
export const destinationIdParamsSchema = z.object({ destinationId: z.uuid() });

export type RefreshResult = z.infer<typeof refreshResultSchema>;
