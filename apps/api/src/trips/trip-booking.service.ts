import { Injectable } from '@nestjs/common';

import {
  TRIP_COMPONENTS,
  type HotelGuest,
  type PassengerInput,
  type TravellerCounts,
  type TripComponent,
} from '@suskii/shared';

import type { ItemPayload } from '../bookings/booking-pricing';
import type { CreateBookingRequest } from '../bookings/bookings.schemas';
import { BookingsService, type BookingCaller } from '../bookings/bookings.service';
import { fromJsonValue } from '../common/json';
import { ProblemDetailsException } from '../common/problem-details';
import { PrismaService } from '../infra/prisma.service';
import { offerUnavailable } from '../search/search.errors';

import {
  tripNothingPrepared,
  tripPartInvalid,
  TRIP_PART_ISSUES,
  tripTravellersShort,
} from './trip-errors';
import type { BookTripRequest, TripDto, TripPreparedPart } from './trips.schemas';
import { TripsService } from './trips.service';

/** The kinds of traveller in the order a booking lists them, with their count's key. */
const KINDS = [
  ['adult', 'adults'],
  ['child', 'children'],
  ['infant', 'infants'],
] as const satisfies readonly (readonly [PassengerInput['type'], keyof TravellerCounts])[];

/** Add-on details a transfer can ask for; dates of birth come with each traveller instead. */
const DETAIL_FIELDS = ['flight_number', 'arrival_time', 'pickup_address'] as const;

/** One part's booking request, and which travellers of the form it names, in its order. */
interface PartRequest {
  component: TripComponent;
  request: CreateBookingRequest;
  travellers: number[];
}

/**
 * The details form of a whole trip (ADR-118): the traveller enters the contact and everyone
 * travelling once, and every part Ask Suskii prepared (ADR-117) is booked from it. Each part is
 * an ordinary booking made by `BookingsService.create()`, with its own checks, prices and
 * reservations, and then joins the trip through `TripsService.addPart()`; the trip is paid once
 * on its page as before. Nothing here prices, holds or charges anything itself.
 *
 * It is all or nothing: when one part cannot be booked, what this request booked is cancelled
 * again (package and tour seats and rental cars are released with it), and the problem names
 * the part and, for a traveller's detail, the traveller's place in the form.
 */
@Injectable()
export class TripBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly trips: TripsService,
  ) {}

  async book(
    tripId: string,
    input: BookTripRequest,
    caller: BookingCaller,
    userId: string,
  ): Promise<TripDto> {
    const trip = await this.trips.get(tripId, userId);
    const prepared = trip.prepared ?? [];
    if (prepared.length === 0) throw tripNothingPrepared();
    const parts = await this.requests(prepared, input);

    const booked: string[] = [];
    try {
      for (const part of parts) {
        try {
          const { booking } = await this.bookings.create(part.request, caller);
          booked.push(booking.id);
        } catch (error) {
          throw forPart(error, part);
        }
      }
      for (const bookingId of booked) await this.trips.addPart(tripId, bookingId, caller, userId);
    } catch (error) {
      // All or nothing: what this request booked goes back, with its seats and cars.
      for (const bookingId of booked) {
        await this.bookings.cancel(bookingId, caller, 'trip_booking_failed').catch(() => null);
      }
      throw error;
    }
    return this.trips.get(tripId, userId);
  }

  /** Each prepared part's booking request, checked against the form before anything is booked. */
  private async requests(
    prepared: readonly TripPreparedPart[],
    input: BookTripRequest,
  ): Promise<PartRequest[]> {
    const offers = await this.prisma.offer.findMany({
      where: { id: { in: prepared.map((part) => part.quoteId) } },
    });
    const now = Date.now();
    // A traveller is saved to the account with the first part that names them, not with each.
    const saved = new Set<number>();
    // In the trip's own order: the flight first, whose travellers the others follow.
    const ordered = [...prepared].sort(
      (a, b) => TRIP_COMPONENTS.indexOf(a.component) - TRIP_COMPONENTS.indexOf(b.component),
    );
    return ordered.map((part) => {
      const offer = offers.find((row) => row.id === part.quoteId);
      if (!offer) throw tripPartInvalid(TRIP_PART_ISSUES.unsupported);
      const payload = fromJsonValue<ItemPayload>(offer.payload);
      if (offer.expiresAt.getTime() <= now)
        throw withPart(offerUnavailable(payload.request), part.component);
      const base: CreateBookingRequest = {
        quoteId: part.quoteId,
        contact: input.contact,
        passengers: [],
        guests: [],
        extras: [],
        seats: [],
        addonDetails: null,
        promoCode: null,
        termsVersion: input.termsVersion,
        acceptTerms: input.acceptTerms,
        locale: input.locale,
        turnstileToken: null,
        company: false,
        marketing: input.marketing,
      };
      switch (payload.kind) {
        case 'flight': {
          const travellers = pick(input.travellers, payload.request.passengers, part.component);
          return {
            component: part.component,
            travellers,
            request: { ...base, passengers: passengersOf(input, travellers, saved, true) },
          };
        }
        case 'addon': {
          const travellers = pick(input.travellers, payload.travellers, part.component);
          const asks = payload.requiredDetails.some((field) =>
            (DETAIL_FIELDS as readonly string[]).includes(field),
          );
          return {
            component: part.component,
            travellers,
            request: {
              ...base,
              passengers: passengersOf(input, travellers, saved, false),
              addonDetails: asks ? input.addonDetails : null,
            },
          };
        }
        case 'hotel': {
          // One lead guest per room, from the adults in order.
          const adults = indexesOf(input.travellers, 'adult');
          const travellers = payload.request.rooms.map(
            (_room, index) => adults[index % adults.length] ?? 0,
          );
          return {
            component: part.component,
            travellers,
            request: { ...base, guests: travellers.map((index) => guestOf(input, index)) },
          };
        }
        case 'rental': {
          // The renter is the first adult: they show the licence when the car is handed over.
          const renter = indexesOf(input.travellers, 'adult')[0] ?? 0;
          return {
            component: part.component,
            travellers: [renter],
            request: { ...base, guests: [guestOf(input, renter)] },
          };
        }
        case 'package':
        case 'tour':
        case 'visa':
        case 'bus':
        case 'ride':
        case 'membership':
        case 'assisted':
          // A trip takes only the parts above (ADR-099); these are booked on their own page.
          throw tripPartInvalid(TRIP_PART_ISSUES.unsupported);
      }
    });
  }
}

const indexesOf = (travellers: readonly PassengerInput[], type: PassengerInput['type']): number[] =>
  travellers.flatMap((traveller, index) => (traveller.type === type ? [index] : []));

/** The travellers of each kind a quote was priced for, the first of each in the form's order. */
function pick(
  travellers: readonly PassengerInput[],
  counts: TravellerCounts,
  component: TripComponent,
): number[] {
  const chosen: number[] = [];
  for (const [type, key] of KINDS) {
    const pool = indexesOf(travellers, type);
    if (pool.length < counts[key]) throw tripTravellersShort(component);
    chosen.push(...pool.slice(0, counts[key]));
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * The form's travellers as one part's passengers. A meal request belongs to the flight alone,
 * and a traveller is saved to the account only once.
 */
function passengersOf(
  input: BookTripRequest,
  travellers: readonly number[],
  saved: Set<number>,
  flight: boolean,
): PassengerInput[] {
  return travellers.flatMap((index) => {
    const traveller = input.travellers[index];
    if (!traveller) return [];
    const save = traveller.saveTraveller && !saved.has(index);
    if (save) saved.add(index);
    return [{ ...traveller, saveTraveller: save, meal: flight ? traveller.meal : null }];
  });
}

const guestOf = (input: BookTripRequest, index: number): HotelGuest => {
  const traveller = input.travellers[index];
  return { givenNames: traveller?.givenNames ?? '', surname: traveller?.surname ?? '' };
};

/** A problem as the part met it, with the part named. */
const withPart = (
  error: ProblemDetailsException,
  component: TripComponent,
): ProblemDetailsException =>
  new ProblemDetailsException(
    error.getStatus(),
    error.slug,
    error.title,
    error.detail,
    { ...error.extensions, part: component },
    error.headers,
  );

/**
 * A part's refusal for the form: the part named, and a traveller's issue moved from the part's
 * own list to the traveller's place in the form, so the client marks the right field.
 */
function forPart(error: unknown, part: PartRequest): unknown {
  if (!(error instanceof ProblemDetailsException)) return error;
  const issues = Array.isArray(error.extensions.issues) ? error.extensions.issues : null;
  const named = withPart(error, part.component);
  if (!issues) return named;
  return new ProblemDetailsException(
    named.getStatus(),
    named.slug,
    named.title,
    named.detail,
    {
      ...named.extensions,
      issues: issues.map((issue: unknown) => {
        if (typeof issue !== 'object' || issue === null || !('index' in issue)) return issue;
        const index =
          typeof issue.index === 'number' ? (part.travellers[issue.index] ?? null) : null;
        return { ...issue, index };
      }),
    },
    named.headers,
  );
}
