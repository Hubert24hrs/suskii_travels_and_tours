import { z } from 'zod';

import {
  CABIN_CLASSES,
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  iataCodeSchema,
  isoDateSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';
import { carrierSchema, flightOfferSchema } from '../search/search.schemas';

const timestamp = z.iso.datetime();
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const booleanParam = z.enum(['true', 'false']).transform((value) => value === 'true');
const countParam = (min: number) => z.coerce.number().int().min(min).max(9);

export const METASEARCH_KEY_HEADER = {
  name: 'X-Api-Key',
  required: true,
  description: 'The partner key from the console (`smk_…`). Never send it in a URL.',
};

/** Hard ceiling on a partner's results per request, whatever the console says. */
export const MAX_METASEARCH_RESULTS = 200;

export const metasearchFlightsQuerySchema = z.object({
  origin: iataCodeSchema.meta({ description: 'Departure airport (IATA).' }),
  destination: iataCodeSchema.meta({ description: 'Arrival airport (IATA).' }),
  departureDate: isoDateSchema.meta({ description: 'Outbound date, local to the origin.' }),
  returnDate: isoDateSchema.optional().meta({ description: 'Return date; omit for one way.' }),
  adults: countParam(1).default(1),
  children: countParam(0).default(0),
  infants: countParam(0).default(0),
  cabin: z.enum(CABIN_CLASSES).default('economy'),
  directOnly: booleanParam.default(false),
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
  limit: z.coerce.number().int().min(1).max(MAX_METASEARCH_RESULTS).optional().meta({
    description: "Itineraries to return, up to the partner's own maximum.",
  }),
});
export type MetasearchFlightsQuery = z.infer<typeof metasearchFlightsQuerySchema>;

const metasearchSegmentSchema = z.object({
  marketingCarrier: carrierSchema,
  operatingCarrier: carrierSchema,
  flightNumber: z.string(),
  origin: z.string().length(3),
  destination: z.string().length(3),
  departureLocal: localDateTime,
  departureUtc: timestamp,
  arrivalLocal: localDateTime,
  arrivalUtc: timestamp,
  durationMinutes: z.number().int(),
  aircraft: z.string().nullable(),
});

const metasearchSliceSchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  departureLocal: localDateTime,
  arrivalLocal: localDateTime,
  durationMinutes: z.number().int(),
  stops: z.number().int(),
  segments: z.array(metasearchSegmentSchema),
});

export const metasearchItinerarySchema = named(
  'MetasearchItinerary',
  z.object({
    slices: z.array(metasearchSliceSchema),
    cabinClass: z.enum(CABIN_CLASSES),
    fareBrand: z.string().nullable(),
    baggage: z.object({ carryOn: z.number().int(), checked: z.number().int() }),
    refundable: z.boolean(),
    changeable: z.boolean(),
    total: moneySchema.meta({
      description: 'All-in price for every traveller: fare, taxes, fees and service taxes.',
    }),
    validUntil: timestamp,
    deepLink: z.url().meta({
      description:
        'The itinerary on the Suskii website at this price. Opaque: never change it; it lapses after METASEARCH_LINK_TTL_HOURS.',
    }),
  }),
);

export const metasearchFlightsSchema = named(
  'MetasearchFlights',
  z.object({
    currency: z.string().length(3),
    searchedAt: timestamp,
    complete: z.boolean().meta({ description: 'False when a supplier did not answer in time.' }),
    itineraries: z.array(metasearchItinerarySchema),
  }),
);
export type MetasearchFlightsDto = z.infer<typeof metasearchFlightsSchema>;

export const METASEARCH_OUTCOMES = ['same', 'lower', 'higher', 'unavailable', 'expired'] as const;
export type MetasearchOutcome = (typeof METASEARCH_OUTCOMES)[number];

export const metasearchLandingBodySchema = named(
  'MetasearchLandingInput',
  z.object({ token: z.string().min(1).max(2048) }),
);

/** The request a deep link carries; dates may be past, so no date rules here. */
const landingRequestSchema = z.object({
  slices: z.array(
    z.object({
      origin: z.string().length(3),
      destination: z.string().length(3),
      departureDate: z.string(),
    }),
  ),
  passengers: z.object({
    adults: z.number().int(),
    children: z.number().int(),
    infants: z.number().int(),
  }),
  cabinClass: z.enum(CABIN_CLASSES),
  directOnly: z.boolean(),
});

export const metasearchLandingSchema = named(
  'MetasearchLanding',
  z.object({
    outcome: z.enum(METASEARCH_OUTCOMES).meta({
      description:
        '`same` or `lower`: continue to checkout. `higher`: show both totals first. `unavailable` or `expired`: offer the same search.',
    }),
    partner: z.object({ name: z.string() }),
    quoteId: z.uuid().nullable(),
    shown: moneySchema,
    current: moneySchema.nullable(),
    offer: flightOfferSchema.nullable(),
    request: landingRequestSchema,
  }),
);
export type MetasearchLandingDto = z.infer<typeof metasearchLandingSchema>;

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

const limitsShape = {
  requestsPerMinute: z.number().int().min(1).max(6000),
  requestsPerDay: z.number().int().min(1).max(5_000_000),
  maxResults: z.number().int().min(1).max(MAX_METASEARCH_RESULTS),
};

export const metasearchPartnerInputSchema = named(
  'MetasearchPartnerInput',
  z.object({
    name: z.string().trim().min(2).max(80),
    code: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,31}$/)
      .meta({ description: 'Lowercase code for reports and metrics, e.g. `skyscanner`.' }),
    requestsPerMinute: limitsShape.requestsPerMinute.default(60),
    requestsPerDay: limitsShape.requestsPerDay.default(20_000),
    maxResults: limitsShape.maxResults.default(50),
  }),
);
export type MetasearchPartnerInput = z.infer<typeof metasearchPartnerInputSchema>;

export const metasearchPartnerPatchSchema = named(
  'MetasearchPartnerPatch',
  z
    .object({
      name: z.string().trim().min(2).max(80),
      active: z.boolean(),
      ...limitsShape,
    })
    .partial(),
);
export type MetasearchPartnerPatch = z.infer<typeof metasearchPartnerPatchSchema>;

export const metasearchPartnerIdParamsSchema = z.object({ partnerId: z.uuid() });

const countsByOutcome = z.object({
  same: z.number().int(),
  lower: z.number().int(),
  higher: z.number().int(),
  unavailable: z.number().int(),
  expired: z.number().int(),
});

export const adminMetasearchPartnerSchema = named(
  'AdminMetasearchPartner',
  z.object({
    id: z.uuid(),
    name: z.string(),
    code: z.string(),
    keyHint: z.string().meta({ description: 'The first characters of the key, for recognition.' }),
    active: z.boolean(),
    ...limitsShape,
    keyRotatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
);
export type AdminMetasearchPartner = z.infer<typeof adminMetasearchPartnerSchema>;

export const adminMetasearchPartnerKeySchema = named(
  'AdminMetasearchPartnerKey',
  z.object({
    partner: adminMetasearchPartnerSchema,
    key: z.string().meta({ description: 'Shown once. Only its HMAC is stored.' }),
  }),
);
export type AdminMetasearchPartnerKey = z.infer<typeof adminMetasearchPartnerKeySchema>;

export const adminMetasearchReportSchema = named(
  'AdminMetasearchReport',
  z.object({
    from: timestamp,
    to: timestamp,
    partners: z.array(
      z.object({
        partner: adminMetasearchPartnerSchema,
        landings: z.number().int(),
        outcomes: countsByOutcome,
        priceAccuracyBps: z.number().int().nullable().meta({
          description: 'Same or lower among landings that found the flight, in basis points.',
        }),
        linkSuccessBps: z.number().int().nullable().meta({
          description: 'Landings that found the flight among all landings, in basis points.',
        }),
        bookings: z.number().int().meta({ description: 'Committed bookings (paid or partly).' }),
        value: z.array(moneySchema).meta({ description: 'Their totals per currency.' }),
      }),
    ),
  }),
);
export type AdminMetasearchReport = z.infer<typeof adminMetasearchReportSchema>;
