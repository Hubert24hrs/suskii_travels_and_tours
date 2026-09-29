import { z } from 'zod';

import { named } from '../contract/contract';

const airportRef = z.object({ code: z.string().length(3), name: z.string() });

export const airportSuggestionSchema = named(
  'AirportSuggestion',
  z.object({
    type: z.literal('airport'),
    code: z.string().length(3),
    name: z.string(),
    cityId: z.uuid().nullable(),
    cityName: z.string().nullable(),
    countryCode: z.string().length(2),
    countryName: z.string(),
    timeZone: z.string(),
  }),
);

export const citySuggestionSchema = named(
  'CitySuggestion',
  z.object({
    type: z.literal('city'),
    id: z.uuid(),
    name: z.string(),
    countryCode: z.string().length(2),
    countryName: z.string(),
    timeZone: z.string().nullable(),
    airports: z
      .array(airportRef)
      .meta({ description: 'Airports serving the city, largest first.' }),
  }),
);

export const placeSuggestionSchema = named(
  'PlaceSuggestion',
  z.discriminatedUnion('type', [airportSuggestionSchema, citySuggestionSchema]),
);

export const placeSuggestionsSchema = named(
  'PlaceSuggestions',
  z.object({ items: z.array(placeSuggestionSchema) }),
);

export const placesQuerySchema = z.object({
  q: z.string().trim().min(2).max(64).meta({ description: 'IATA code, city, airport or country.' }),
  types: z
    .string()
    .regex(/^(airport|city)(,(airport|city))?$/)
    .default('airport,city')
    .meta({ description: 'Comma-separated: airport, city.' }),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const popularPlacesSchema = named(
  'PopularPlaces',
  z.object({
    version: z.string().meta({ description: 'Changes when the index changes.' }),
    fields: z.array(z.string()).meta({ description: 'Tuple layout of each airport entry.' }),
    airports: z.array(z.tuple([z.string(), z.string(), z.string(), z.string()])),
  }),
);

export const airportSchema = named(
  'Airport',
  z.object({
    code: z.string().length(3),
    icaoCode: z.string().nullable(),
    name: z.string(),
    type: z.enum(['large_airport', 'medium_airport', 'small_airport']),
    municipality: z.string().nullable(),
    cityId: z.uuid().nullable(),
    countryCode: z.string().length(2),
    countryName: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    timeZone: z.string(),
  }),
);

export const airportParamsSchema = z.object({
  iataCode: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase()),
});

export const countriesSchema = named(
  'Countries',
  z.object({
    items: z.array(
      z.object({ code: z.string().length(2), name: z.string(), continent: z.string().length(2) }),
    ),
  }),
);
