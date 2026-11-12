import { z } from 'zod';

import {
  BED_TYPES,
  CABIN_CLASSES,
  HOTEL_COLLECTIONS,
  PROPERTY_TYPES,
  currencyCodeSchema,
  DEFAULT_CURRENCY,
  flightSearchRequestSchema,
  hotelSearchRequestSchema,
} from '@suskii/shared';

import { named } from '../contract/contract';
import { moneySchema, priceSchema } from '../pricing/pricing.schemas';
import { reviewSummarySchema } from '../reviews/reviews.schemas';
import { LAYOVER_WARNINGS } from '../suppliers/supplier.types';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const timestamp = z.iso.datetime();
const isoDate = z.iso.date();
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

/** A new search: display currency and the size of the first page it answers with (ADR-075). */
export const searchQuerySchema = currencyQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20).meta({
    description: 'Results on the first page, which the search returns; fewer in data-saver mode.',
  }),
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

export const carrierSchema = named('Carrier', z.object({ code: z.string(), name: z.string() }));

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

export const flightServiceSchema = named(
  'FlightService',
  z.object({
    id: z.string(),
    type: z.enum(['checked_bag']),
    weightKg: z.number().int(),
    maxQuantity: z.number().int().meta({ description: 'Per passenger; infants cannot add bags.' }),
    price: moneySchema.meta({ description: 'Per unit, in the display currency.' }),
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
    mealRequests: z.boolean().meta({
      description:
        'Whether a special meal can be asked for each seated passenger at booking (`passengers[].meal`). False: the traveller asks the airline directly.',
    }),
    services: z.array(flightServiceSchema),
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

export const flightDatePricesSchema = named(
  'FlightDatePrices',
  z.object({
    currency: z.string().length(3),
    days: z
      .array(
        z.object({
          offset: z
            .number()
            .int()
            .meta({ description: 'Days from the requested dates; 0 is the request itself.' }),
          departureDate: isoDate,
          returnDate: isoDate.nullable().meta({
            description: 'Return trips keep their length: both dates move together.',
          }),
          status: z.enum(['priced', 'none', 'unavailable']).meta({
            description:
              '`none`: no flights that day. `unavailable`: the suppliers could not answer; the day can still be searched.',
          }),
          total: moneySchema.nullable().meta({
            description: 'Lowest total for every traveller that day, priced as search results are.',
          }),
        }),
      )
      .meta({
        description:
          'Oldest day first. Days in the past or beyond the booking horizon are left out. Empty for multi-city trips and when day-by-day prices are off.',
      }),
    cheapestOffset: z.number().int().nullable().meta({
      description:
        'The offset of the lowest total; the earliest day wins a tie. Null without a price.',
    }),
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

export const hotelPhotoSchema = named(
  'HotelPhoto',
  z.object({
    url: z.url().meta({
      description:
        "The supplier's photo over https, or a drawn sample picture from the website's `/art/hotels` for demo data. Show it only from hosts the client allows.",
    }),
    caption: z.string().nullable(),
  }),
);

export const hotelRoomSchema = named(
  'HotelRoom',
  z.object({
    description: z.string().nullable(),
    maxGuests: z.number().int().nullable(),
    sizeSqm: z.number().nullable(),
    beds: z.array(z.object({ type: z.enum(BED_TYPES), count: z.number().int() })),
  }),
);

export const hotelRateSchema = named(
  'HotelRate',
  z.object({
    id: z.string(),
    roomName: z.string(),
    room: hotelRoomSchema.nullable().default(null).meta({
      description: 'What the supplier says of the room; null when it sends only a name.',
    }),
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
  propertyType: z.enum(PROPERTY_TYPES).nullable().meta({
    description: 'Hotel, apartment, resort...; null when the supplier does not say.',
  }),
  verifiedReviews: reviewSummarySchema.nullable().meta({
    description:
      "Suskii's own score from travellers who stayed through us (ADR-077); `reviewScore` is the supplier's. Null until a review is published.",
  }),
};

export const hotelSummarySchema = named(
  'HotelSummary',
  z.object({
    ...hotelBase,
    photo: hotelPhotoSchema.nullable().meta({ description: 'The first photo, for a card.' }),
    deal: z.object({ percentBelow: z.number().int() }).nullable().meta({
      description:
        'Set when the hotel costs at least 15% less than the usual (median) price of hotels with its star rating in this search, and guests do not rate it poorly (ADR-097).',
    }),
    collections: z.array(z.enum(HOTEL_COLLECTIONS)).meta({
      description:
        'The collections the hotel belongs to: fixed rules over stars, score, rooms, amenities and type.',
    }),
    cheapestRate: hotelRateSchema,
    freeCancellationAvailable: z.boolean(),
  }),
);

export const hotelDetailSchema = named(
  'HotelDetail',
  z.object({
    ...hotelBase,
    description: z.string().nullable().meta({
      description: "The supplier's text about the property, as plain text.",
    }),
    photos: z.array(hotelPhotoSchema),
    nights: z.number().int(),
    rates: z.array(hotelRateSchema),
  }),
);

export const hotelFacetsSchema = named(
  'HotelFacets',
  z.object({
    stars: z.array(z.object({ stars: z.number().int(), ...countWithPrice })),
    price: z.object({ min: moneySchema, max: moneySchema }).nullable(),
    amenities: z.array(z.object({ amenity: z.string(), count: z.number().int() })),
    boards: z.array(z.object({ board: boardSchema, count: z.number().int() })),
    areas: z.array(z.object({ area: z.string(), count: z.number().int() })),
    propertyTypes: z.array(z.object({ type: z.enum(PROPERTY_TYPES), count: z.number().int() })),
    collections: z.array(
      z.object({ collection: z.enum(HOTEL_COLLECTIONS), count: z.number().int() }),
    ),
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
  areas: z
    .string()
    .max(500)
    .transform((value) => value.split(',').filter((area) => area.length > 0))
    .optional()
    .meta({ description: 'Comma-separated area names from the `areas` facet (any of them).' }),
  board: boardSchema.optional(),
  types: csvParam(/^[a-z]+(,[a-z]+)*$/)
    .optional()
    .meta({ description: 'Property types from the `propertyTypes` facet (any of them).' }),
  maxPrice: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .meta({ description: 'Whole stay, minor units of the display currency.' }),
  collection: z
    .enum(HOTEL_COLLECTIONS)
    .optional()
    .meta({ description: 'One collection from the `collections` facet.' }),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const hotelResultParamsSchema = z.object({
  hotelId: z.string().regex(/^hs_[A-Za-z0-9_-]{16}\.h[a-z0-9]+$/),
});
export const rateIdParamsSchema = z.object({
  // `.r`: a rate search returned; `.f`: one of the full list loaded for the hotel page.
  rateId: z.string().regex(/^hs_[A-Za-z0-9_-]{16}\.h[a-z0-9]+\.[rf][a-z0-9]+$/),
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
