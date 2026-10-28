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

const carrierSchema = z.object({ code: z.string(), name: z.string() });

export const routeFactsSchema = named(
  'RouteFacts',
  z
    .object({
      cheapest: z
        .object({ price: moneySchema, departureDate: isoDate, carrier: carrierSchema })
        .meta({ description: 'Lowest fare found in the last 30 days.' }),
      typical: moneySchema.meta({
        description: "Median of each day's cheapest fare over the last 90 days.",
      }),
      airlines: z
        .array(carrierSchema)
        .meta({ description: 'Airlines seen in the last 90 days, most often first.' }),
      direct: z.boolean().meta({ description: 'A nonstop outbound flight was seen in 90 days.' }),
      fastestMinutes: z
        .number()
        .int()
        .meta({ description: 'Shortest outbound journey seen in 90 days.' }),
      cheapestMonth: z.number().int().min(1).max(12).nullable().meta({
        description:
          'Departure month with the lowest median fare over a year; null until three months were seen.',
      }),
      observedDays: z.number().int().meta({ description: 'Days with fares in the last 90.' }),
      sample: z.boolean().meta({ description: 'Built from mock supplier fares: show as sample.' }),
      updatedAt: z.iso.datetime(),
    })
    .meta({
      description:
        "What the fare history says about a route (ADR-080): one adult, return, the route's cabin, priced with today's rules.",
    }),
);

export const dealRouteSchema = named(
  'DealRouteDetail',
  dealRouteSummarySchema.extend({
    cabinClass: z.enum(CABIN_CLASSES),
    stayNights: z.number().int(),
    currency: z.string(),
    deal: flightDealSchema.nullable().meta({ description: 'Latest fresh fare, if any.' }),
    facts: routeFactsSchema
      .nullable()
      .meta({ description: 'Null until enough days of fares exist (ADR-080).' }),
    relatedRoutes: z.array(dealRouteSummarySchema),
  }),
);

// ---------------------------------------------------------------------------
// City hubs and airline pages (ADR-080)
// ---------------------------------------------------------------------------

export const citySlugParamsSchema = z.object({ slug: z.string().max(80).regex(SLUG) });

const cityRouteSchema = dealRouteSummarySchema.extend({
  deal: flightDealSchema.nullable().meta({ description: 'Latest fresh fare, if any.' }),
  typical: moneySchema.nullable().meta({ description: 'Typical fare (90-day median), if known.' }),
  direct: z.boolean().nullable().meta({ description: 'A nonstop flight was seen, if known.' }),
});

export const dealCitiesSchema = named(
  'DealCities',
  z.object({
    cities: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        countryCode: z.string(),
        departures: z.number().int().meta({ description: 'Active routes from this city.' }),
        arrivals: z.number().int().meta({ description: 'Active routes to this city.' }),
      }),
    ),
  }),
);

export const dealCitySchema = named(
  'DealCity',
  z.object({
    city: z.object({ slug: z.string(), name: z.string(), countryCode: z.string() }),
    currency: z.string(),
    departures: z.array(cityRouteSchema),
    arrivals: z.array(cityRouteSchema),
  }),
);

export const airlineCodeParamsSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9]{2}$/)
    .meta({ description: 'IATA airline designator, upper case.' }),
});

export const dealAirlinesSchema = named(
  'DealAirlines',
  z.object({
    airlines: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        routes: z.number().int().meta({ description: 'Routes the airline was seen on (90 days).' }),
      }),
    ),
  }),
);

export const dealAirlineSchema = named(
  'DealAirline',
  z.object({
    airline: z.object({ code: z.string(), name: z.string(), logoUrl: z.string().nullable() }),
    currency: z.string(),
    routes: z.array(
      dealRouteSummarySchema.extend({
        cheapest: z
          .object({ price: moneySchema, departureDate: isoDate })
          .meta({ description: "The airline's lowest fare on the route in the last 90 days." }),
        direct: z.boolean().meta({ description: 'The airline flew it nonstop in 90 days.' }),
        fastestMinutes: z.number().int(),
        sample: z.boolean(),
      }),
    ),
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
  z.object({
    deletedDeals: z.number().int(),
    deletedDestinations: z.number().int(),
    deletedFares: z.number().int().meta({ description: 'Route fare history past retention.' }),
  }),
);

export const routeIdParamsSchema = z.object({ routeId: z.uuid() });
export const destinationIdParamsSchema = z.object({ destinationId: z.uuid() });

export type RefreshResult = z.infer<typeof refreshResultSchema>;
