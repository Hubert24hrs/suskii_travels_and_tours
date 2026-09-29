import { z } from 'zod';

import { addDays, daysBetween, earliestToday, isValidDate } from './time';
import { travellerCountsSchema } from './travellers';

/**
 * Search schemas shared by the web and mobile forms and the API
 * (PROJECT_SPEC.json#/homepage_spec search_module). Clients check dates against the earliest
 * "today" on Earth; the API re-checks against the origin airport's local date.
 */

export const CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first'] as const;
export type CabinClass = (typeof CABIN_CLASSES)[number];

export const TRIP_TYPES = ['round_trip', 'one_way', 'multi_city'] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const MAX_FLIGHT_SLICES = 5;
export const MIN_MULTI_CITY_LEGS = 2;
/** Airlines sell about 330-361 days ahead. */
export const MAX_ADVANCE_DAYS = 361;

export const MAX_HOTEL_ROOMS = 8;
export const MAX_ADULTS_PER_ROOM = 6;
export const MAX_CHILDREN_PER_ROOM = 4;
export const MAX_CHILD_AGE = 17;
export const MAX_STAY_NIGHTS = 30;

/** Machine-readable issue codes; apps map them to localised messages. */
export const SEARCH_ISSUES = {
  sameOriginDestination: 'same_origin_destination',
  legsNotChronological: 'legs_not_chronological',
  returnBeforeDeparture: 'return_before_departure',
  dateInPast: 'date_in_past',
  dateTooFar: 'date_too_far',
  checkOutNotAfterCheckIn: 'check_out_not_after_check_in',
  stayTooLong: 'stay_too_long',
} as const;

export const iataCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter IATA code');

export const isoDateSchema = z.string().refine(isValidDate, 'Use a valid YYYY-MM-DD date');

export const cabinClassSchema = z.enum(CABIN_CLASSES);

export interface SearchSchemaOptions {
  /** Clock override for tests. */
  now?: () => Date;
}

interface SliceLike {
  origin: string;
  destination: string;
  departureDate: string;
}

type IssueSink = (path: (string | number)[], message: string) => void;

/** Rules for every slice sequence, shared by the form and request schemas. */
function checkSlices(
  slices: readonly SliceLike[],
  now: Date,
  report: IssueSink,
  prefix: (index: number) => (string | number)[],
): void {
  const today = earliestToday(now);
  const latest = addDays(today, MAX_ADVANCE_DAYS);
  slices.forEach((slice, index) => {
    if (slice.origin === slice.destination) {
      report([...prefix(index), 'destination'], SEARCH_ISSUES.sameOriginDestination);
    }
    if (slice.departureDate < today)
      report([...prefix(index), 'departureDate'], SEARCH_ISSUES.dateInPast);
    if (slice.departureDate > latest)
      report([...prefix(index), 'departureDate'], SEARCH_ISSUES.dateTooFar);
    const previous = slices[index - 1];
    if (previous && slice.departureDate < previous.departureDate) {
      report([...prefix(index), 'departureDate'], SEARCH_ISSUES.legsNotChronological);
    }
  });
}

const sliceSchema = z.object({
  origin: iataCodeSchema,
  destination: iataCodeSchema,
  departureDate: isoDateSchema,
});

/** API request: one to five slices (one-way, return, multi-city are all slice lists). */
export function createFlightSearchRequestSchema(options: SearchSchemaOptions = {}) {
  const now = options.now ?? (() => new Date());
  return z
    .object({
      slices: z.array(sliceSchema).min(1).max(MAX_FLIGHT_SLICES),
      passengers: travellerCountsSchema,
      cabinClass: cabinClassSchema.default('economy'),
      directOnly: z.boolean().default(false),
    })
    .superRefine((request, ctx) => {
      checkSlices(
        request.slices,
        now(),
        (path, message) => ctx.addIssue({ code: 'custom', path, message }),
        (index) => ['slices', index],
      );
    });
}

export const flightSearchRequestSchema = createFlightSearchRequestSchema();
export type FlightSearchRequest = z.output<typeof flightSearchRequestSchema>;
export type FlightSearchRequestInput = z.input<typeof flightSearchRequestSchema>;

const formCommon = {
  travellers: travellerCountsSchema,
  cabinClass: cabinClassSchema.default('economy'),
  directOnly: z.boolean().default(false),
  /** +/- 3 days fare calendar (phase 5 results page). */
  flexibleDates: z.boolean().default(false),
};

/** The homepage flight form: round trip, one way or 2-5 multi-city legs. */
export function createFlightSearchFormSchema(options: SearchSchemaOptions = {}) {
  const now = options.now ?? (() => new Date());
  return z
    .discriminatedUnion('tripType', [
      z.object({ tripType: z.literal('one_way'), ...sliceSchema.shape, ...formCommon }),
      z.object({
        tripType: z.literal('round_trip'),
        ...sliceSchema.shape,
        returnDate: isoDateSchema,
        ...formCommon,
      }),
      z.object({
        tripType: z.literal('multi_city'),
        legs: z.array(sliceSchema).min(MIN_MULTI_CITY_LEGS).max(MAX_FLIGHT_SLICES),
        ...formCommon,
      }),
    ])
    .superRefine((form, ctx) => {
      const report: IssueSink = (path, message) => ctx.addIssue({ code: 'custom', path, message });
      if (form.tripType === 'multi_city') {
        checkSlices(form.legs, now(), report, (index) => ['legs', index]);
        return;
      }
      checkSlices([form], now(), report, () => []);
      if (form.tripType === 'round_trip' && form.returnDate < form.departureDate) {
        report(['returnDate'], SEARCH_ISSUES.returnBeforeDeparture);
      }
    });
}

export const flightSearchFormSchema = createFlightSearchFormSchema();
export type FlightSearchForm = z.output<typeof flightSearchFormSchema>;

/** Converts the form into the API request (a return trip is two slices). */
export function toFlightSearchRequest(form: FlightSearchForm): FlightSearchRequest {
  const common = {
    passengers: form.travellers,
    cabinClass: form.cabinClass,
    directOnly: form.directOnly,
  };
  if (form.tripType === 'multi_city') return { slices: form.legs, ...common };
  const outbound = {
    origin: form.origin,
    destination: form.destination,
    departureDate: form.departureDate,
  };
  if (form.tripType === 'one_way') return { slices: [outbound], ...common };
  return {
    slices: [
      outbound,
      { origin: form.destination, destination: form.origin, departureDate: form.returnDate },
    ],
    ...common,
  };
}

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

export const hotelRoomSchema = z.object({
  adults: z.number().int().min(1).max(MAX_ADULTS_PER_ROOM),
  childAges: z
    .array(z.number().int().min(0).max(MAX_CHILD_AGE))
    .max(MAX_CHILDREN_PER_ROOM)
    .default([]),
});

export const hotelDestinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('city'), cityId: z.uuid() }),
]);

export function createHotelSearchRequestSchema(options: SearchSchemaOptions = {}) {
  const now = options.now ?? (() => new Date());
  return z
    .object({
      destination: hotelDestinationSchema,
      checkIn: isoDateSchema,
      checkOut: isoDateSchema,
      rooms: z.array(hotelRoomSchema).min(1).max(MAX_HOTEL_ROOMS),
      freeCancellationOnly: z.boolean().default(false),
    })
    .superRefine((request, ctx) => {
      // Zod still runs object refinements after a field refinement failed; skip date maths then.
      if (!isValidDate(request.checkIn) || !isValidDate(request.checkOut)) return;
      const today = earliestToday(now());
      const report = (path: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (request.checkIn < today) report('checkIn', SEARCH_ISSUES.dateInPast);
      if (request.checkIn > addDays(today, MAX_ADVANCE_DAYS))
        report('checkIn', SEARCH_ISSUES.dateTooFar);
      const nights = daysBetween(request.checkIn, request.checkOut);
      if (nights < 1) report('checkOut', SEARCH_ISSUES.checkOutNotAfterCheckIn);
      if (nights > MAX_STAY_NIGHTS) report('checkOut', SEARCH_ISSUES.stayTooLong);
    });
}

export const hotelSearchRequestSchema = createHotelSearchRequestSchema();
export type HotelSearchRequest = z.output<typeof hotelSearchRequestSchema>;
export type HotelSearchRequestInput = z.input<typeof hotelSearchRequestSchema>;
