import { z } from 'zod';

import {
  CABIN_CLASSES,
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  flightSearchRequestSchema,
  hotelSearchRequestSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema, priceSchema } from '../pricing/pricing.schemas';
import { LAYOVER_WARNINGS } from '../suppliers/supplier.types';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const timestamp = z.iso.datetime();
const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .meta({ description: 'Local wall time, no offset.' });
const booleanParam = z.enum(['true', 'false']).transform((value) => value === 'true');
const csvParam = (pattern: RegExp) =>
  z
    .string()
    .regex(pattern)
    .transform((value) => value.split(','));

export const currencyQuerySchema = z.object({
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY).meta({ description: 'Display currency.' }),
});

export const supplierOutcomeSchema = named(
  'SupplierOutcome',
  z.object({
    supplier: z.string(),
    status: z.enum(['ok', 'timeout', 'error', 'circuit_open']),
    resultCount: z.number().int(),
    durationMs: z.number().int(),
  }),
);

const searchStatus = z.enum(['complete', 'partial']).meta({
  description:
    '`partial` when at least one supplier failed; results from the others are still returned.',
});

const pageFields = {
  total: z.number().int().meta({ description: 'Results matching the filters.' }),
  nextCursor: z.string().nullable(),
};

export const priceChangeSchema = named(
  'PriceChange',
  z
    .object({ previous: moneySchema, current: moneySchema, difference: moneySchema })
    .nullable()
    .meta({
      description: 'Present when re-pricing changed the total: ask the customer to confirm.',
    }),
);

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

export const airportPointSchema = named(
  'AirportPoint',
  z.object({
    code: z.string().length(3),
    name: z.string().nullable(),
    cityName: z.string().nullable(),
    countryCode: z.string().nullable(),
    timeZone: z.string(),
  }),
);

const carrierSchema = named('Carrier', z.object({ code: z.string(), name: z.string() }));

export const flightSegmentSchema = named(
  'FlightSegment',
  z.object({
    marketingCarrier: carrierSchema,
    operatingCarrier: carrierSchema,
    flightNumber: z.string(),
    origin: airportPointSchema,
    destination: airportPointSchema,
    departureLocal: localDateTime,
    departureUtc: timestamp,
    arrivalLocal: localDateTime,
    arrivalUtc: timestamp,
    durationMinutes: z.number().int(),
    aircraft: z.string().nullable(),
    cabinClass: z.enum(CABIN_CLASSES),
  }),
);

export const flightSliceSchema = named(
  'FlightSlice',
  z.object({
    origin: airportPointSchema,
    destination: airportPointSchema,
    departureLocal: localDateTime,
    departureUtc: timestamp,
    arrivalLocal: localDateTime,
    arrivalUtc: timestamp,
    durationMinutes: z.number().int(),
    stops: z.number().int(),
    arrivalDayOffset: z
      .number()
      .int()
      .meta({ description: '+1 for next-day arrivals (local dates).' }),
    fareBrand: z.string().nullable(),
    segments: z.array(flightSegmentSchema),
    layovers: z.array(
      z.object({
        airport: airportPointSchema,
        durationMinutes: z.number().int(),
        warnings: z.array(z.enum(LAYOVER_WARNINGS)),
      }),
    ),
  }),
);

export const flightOfferSchema = named(
  'FlightOffer',
  z.object({
    id: z.string(),
    supplier: z
      .string()
      .meta({ description: '`mock` offers are synthetic and must be labelled as such.' }),
    owner: carrierSchema,
    slices: z.array(flightSliceSchema),
    baggage: z
      .object({ carryOn: z.number().int(), checked: z.number().int() })
      .meta({ description: 'Per adult.' }),
    conditions: z.object({
      refundable: z.boolean(),
      refundPenalty: moneySchema.nullable(),
      changeable: z.boolean(),
      changePenalty: moneySchema.nullable(),
    }),
    cabinClass: z.enum(CABIN_CLASSES),
    passengers: z.object({
      adults: z.number().int(),
      children: z.number().int(),
      infants: z.number().int(),
    }),
    price: priceSchema,
    expiresAt: timestamp,
    hold: z.object({ available: z.boolean(), paymentRequiredBy: timestamp.nullable() }),
  }),
);

const countWithPrice = { count: z.number().int(), minPrice: moneySchema };

export const flightFacetsSchema = named(
  'FlightFacets',
  z.object({
    airlines: z.array(z.object({ code: z.string(), name: z.string(), ...countWithPrice })),
    stops: z.array(
      z.object({
        stops: z.number().int().meta({ description: '2 means two or more.' }),
        ...countWithPrice,
      }),
    ),
    price: z.object({ min: moneySchema, max: moneySchema }).nullable(),
    durationMinutes: z.object({ min: z.number().int(), max: z.number().int() }).nullable(),
    departureWindows: z.array(
      z.object({
        window: z.enum(['night', 'morning', 'afternoon', 'evening']),
        count: z.number().int(),
      }),
    ),
    refundable: z.number().int(),
    withCheckedBag: z.number().int(),
  }),
);

export const flightSearchResultSchema = named(
  'FlightSearchResult',
  z.object({
    searchId: z.string(),
    status: searchStatus,
    request: flightSearchRequestSchema,
    currency: z.string().length(3),
    suppliers: z.array(supplierOutcomeSchema),
    resultsExpireAt: timestamp,
    ...pageFields,
    offers: z.array(flightOfferSchema),
    facets: flightFacetsSchema,
  }),
);

export const flightOffersQuerySchema = currencyQuerySchema.extend({
  sort: z.enum(['best', 'cheapest', 'fastest', 'earliest']).default('best'),
  stops: csvParam(/^[012](,[012])*$/)
    .optional()
    .meta({ description: 'Maximum stops per slice: 0, 1, 2 (2 = two or more).' }),
  airlines: csvParam(/^[A-Z0-9]{2}(,[A-Z0-9]{2})*$/)
    .optional()
    .meta({ description: 'Validating carrier codes.' }),
  maxPrice: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: 'Minor units of the display currency.' }),
  maxDurationMinutes: z.coerce.number().int().positive().optional(),
  departureWindows: csvParam(
    /^(night|morning|afternoon|evening)(,(night|morning|afternoon|evening))*$/,
  ).optional(),
  refundable: booleanParam.optional(),
  checkedBag: booleanParam.optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const flightSearchIdParamsSchema = z.object({
  searchId: z.string().regex(/^fs_[A-Za-z0-9_-]{16}$/),
});
export const hotelSearchIdParamsSchema = z.object({
  searchId: z.string().regex(/^hs_[A-Za-z0-9_-]{16}$/),
});
export const offerIdParamsSchema = z.object({
  offerId: z.string().regex(/^fs_[A-Za-z0-9_-]{16}\.[a-z0-9]+$/),
});

export const flightQuoteSchema = named(
  'FlightQuote',
  z.object({
    quoteId: z
      .uuid()
      .meta({ description: 'Book from this quote (phase 5); it expires with the offer.' }),
    offer: flightOfferSchema,
    priceChange: priceChangeSchema,
    expiresAt: timestamp,
  }),
);

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

const boardSchema = z.enum(['room_only', 'breakfast_included', 'half_board', 'full_board']);

export const hotelRateSchema = named(
  'HotelRate',
  z.object({
    id: z.string(),
    roomName: z.string(),
    board: boardSchema,
    refundable: z.boolean(),
    freeCancellationUntil: timestamp.nullable(),
    price: priceSchema.meta({ description: 'Whole stay, every room.' }),
    pricePerNight: moneySchema,
    payAtProperty: moneySchema
      .nullable()
      .meta({ description: 'Charged by the hotel on arrival; not included in the price.' }),
    expiresAt: timestamp,
  }),
);

const hotelBase = {
  id: z.string(),
  supplier: z.string(),
  name: z.string(),
  stars: z.number().int(),
  reviewScore: z.number().nullable(),
  reviewCount: z.number().int(),
  latitude: z.number(),
  longitude: z.number(),
  area: z.string().nullable(),
  cityName: z.string(),
  countryCode: z.string().length(2),
  amenities: z.array(z.string()),
};

export const hotelSummarySchema = named(
  'HotelSummary',
  z.object({ ...hotelBase, cheapestRate: hotelRateSchema, freeCancellationAvailable: z.boolean() }),
);

export const hotelDetailSchema = named(
  'HotelDetail',
  z.object({ ...hotelBase, nights: z.number().int(), rates: z.array(hotelRateSchema) }),
);

export const hotelFacetsSchema = named(
  'HotelFacets',
  z.object({
    stars: z.array(z.object({ stars: z.number().int(), ...countWithPrice })),
    price: z.object({ min: moneySchema, max: moneySchema }).nullable(),
    amenities: z.array(z.object({ amenity: z.string(), count: z.number().int() })),
    boards: z.array(z.object({ board: boardSchema, count: z.number().int() })),
    freeCancellation: z.number().int(),
  }),
);

export const hotelSearchResultSchema = named(
  'HotelSearchResult',
  z.object({
    searchId: z.string(),
    status: searchStatus,
    request: hotelSearchRequestSchema,
    currency: z.string().length(3),
    nights: z.number().int(),
    suppliers: z.array(supplierOutcomeSchema),
    resultsExpireAt: timestamp,
    ...pageFields,
    hotels: z.array(hotelSummarySchema),
    facets: hotelFacetsSchema,
  }),
);

export const hotelsQuerySchema = currencyQuerySchema.extend({
  sort: z.enum(['recommended', 'price', 'rating', 'stars']).default('recommended'),
  stars: csvParam(/^[1-5](,[1-5])*$/).optional(),
  minRating: z.coerce.number().min(0).max(10).optional(),
  freeCancellation: booleanParam.optional(),
  amenities: csvParam(/^[a-z0-9_]+(,[a-z0-9_]+)*$/)
    .optional()
    .meta({ description: 'All listed amenities are required.' }),
  board: boardSchema.optional(),
  maxPrice: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: 'Whole stay, minor units of the display currency.' }),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const hotelResultParamsSchema = z.object({
  hotelId: z.string().regex(/^hs_[A-Za-z0-9_-]{16}\.h[a-z0-9]+$/),
});
export const rateIdParamsSchema = z.object({
  rateId: z.string().regex(/^hs_[A-Za-z0-9_-]{16}\.h[a-z0-9]+\.r[a-z0-9]+$/),
});

export const hotelQuoteSchema = named(
  'HotelQuote',
  z.object({
    quoteId: z.uuid(),
    hotel: z.object({
      id: z.string(),
      name: z.string(),
      stars: z.number().int(),
      cityName: z.string(),
    }),
    rate: hotelRateSchema,
    nights: z.number().int(),
    priceChange: priceChangeSchema,
    expiresAt: timestamp,
  }),
);

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------

export const promoValidateBodySchema = named(
  'PromoValidateRequest',
  z.object({ code: z.string().trim().min(3).max(32), quoteId: z.uuid() }),
);

export const promoValidationSchema = named(
  'PromoValidation',
  z.object({ code: z.string(), discount: moneySchema, price: priceSchema }),
);
