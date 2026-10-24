import { HttpStatus, Injectable } from '@nestjs/common';

import { localToUtc, utcToLocal, type GeoPoint } from '@suskii/shared';

import { itemPayload } from '../bookings/booking-presenter';
import { BookingsService, type BookingCaller } from '../bookings/bookings.service';
import { ProblemDetailsException } from '../common/problem-details';
import { CarsFlags } from '../ground/cars-flags';
import { RouteTooLongError, RoutingService } from '../ground/maps';
import { PrismaService } from '../infra/prisma.service';

import type { CarsSuggestionsDto, DeparturePlanDto } from './planning.schemas';

/** Check-in before a flight: domestic and international (owner question; airline guidance). */
const FLIGHT_BUFFER_MINUTES = { domestic: 120, international: 180 } as const;
/** Boarding opens before a bus leaves; be at the terminal by then. */
const BUS_BUFFER_MINUTES = 30;
/** Lagos traffic: an allowance on top of the routed time. */
const TRAFFIC_MARGIN_MINUTES = 15;
/** Rides can be scheduled from 15 minutes to 7 days ahead (ADR-051). */
const RIDE_SCHEDULE_MIN_MS = 15 * 60_000;
const RIDE_SCHEDULE_MAX_MS = 7 * 86_400_000;
/** A ride from the airport, offered for this long after landing. */
const ARRIVAL_RIDE_DELAY_MS = 30 * 60_000;
const DEFAULT_RENTAL_DAYS = 3;
const CLOSED = ['CANCELLED', 'EXPIRED', 'FAILED', 'REFUNDED'];

const unavailable = (detail: string): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'plan-unavailable',
    'We cannot plan this trip',
    detail,
  );

const iso = (date: Date): string => date.toISOString();

/** The next whole hour of a local wall time, plus `hours`. */
function onTheHour(local: string, hours: number, timeZone: string): string {
  const instant = localToUtc(local, timeZone);
  const next = new Date(Math.ceil(instant.getTime() / 3_600_000) * 3_600_000 + hours * 3_600_000);
  return utcToLocal(next, timeZone);
}

interface Departure {
  kind: 'flight' | 'bus';
  departsAt: Date;
  bufferMinutes: number;
  /** Where the ride would take the traveller, or why it cannot be planned. */
  destination: (GeoPoint & { label: string; cityName: string }) | null;
}

/**
 * Cars features built on a booking (P9): when to leave for the airport or the bus terminal
 * (departure planner) and the rides, cars and buses that fit the trip (bundling). Both read the
 * booking through `BookingsService.load`, so the owner or the holder of its guest token only.
 */
@Injectable()
export class TripPlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly routing: RoutingService,
    private readonly flags: CarsFlags,
  ) {}

  async departurePlan(
    bookingId: string,
    fromPlaceId: string,
    caller: Pick<BookingCaller, 'client' | 'token'>,
    now = new Date(),
  ): Promise<DeparturePlanDto> {
    const booking = await this.bookings.load(bookingId, caller);
    if (CLOSED.includes(booking.status)) throw unavailable('This booking is not going ahead.');
    const departure = await this.departure(booking.items[0]);
    if (!departure) throw unavailable('Only flights and buses have a departure to plan.');
    if (departure.departsAt.getTime() <= now.getTime()) {
      throw unavailable('This trip has already left.');
    }
    if (!departure.destination) {
      throw unavailable('We have no pick-up point for this airport or terminal yet.');
    }
    const from = await this.prisma.ridePlace.findFirst({
      where: { id: fromPlaceId, active: true },
    });
    if (!from) throw unavailable('Choose a place to leave from.');
    if (from.cityName !== departure.destination.cityName) {
      throw unavailable('Choose a place in the same city as the departure.');
    }

    let route;
    try {
      route = await this.routing.route(from, departure.destination);
    } catch (error) {
      if (error instanceof RouteTooLongError) throw unavailable('That place is too far away.');
      throw error;
    }
    const arriveBy = new Date(departure.departsAt.getTime() - departure.bufferMinutes * 60_000);
    const leaveBy = new Date(
      arriveBy.getTime() - route.durationSeconds * 1000 - TRAFFIC_MARGIN_MINUTES * 60_000,
    );
    const ahead = leaveBy.getTime() - now.getTime();
    const destination = {
      label: departure.destination.label,
      lat: departure.destination.lat,
      lng: departure.destination.lng,
    };
    const origin = { label: from.name, lat: from.lat, lng: from.lng };
    return {
      kind: departure.kind,
      departsAt: iso(departure.departsAt),
      destination,
      bufferMinutes: departure.bufferMinutes,
      marginMinutes: TRAFFIC_MARGIN_MINUTES,
      arriveBy: iso(arriveBy),
      leaveBy: iso(leaveBy),
      travel: {
        durationSeconds: route.durationSeconds,
        distanceMetres: route.distanceMetres,
        estimate: route.estimate,
      },
      from: { id: from.id, ...origin },
      ride:
        this.flags.enabled('rides') &&
        ahead >= RIDE_SCHEDULE_MIN_MS &&
        ahead <= RIDE_SCHEDULE_MAX_MS
          ? { pickup: origin, dropoff: destination, scheduledFor: iso(leaveBy) }
          : null,
    };
  }

  async suggestions(
    bookingId: string,
    caller: Pick<BookingCaller, 'client' | 'token'>,
    now = new Date(),
  ): Promise<CarsSuggestionsDto> {
    const booking = await this.bookings.load(bookingId, caller);
    const none: CarsSuggestionsDto = { ride: null, rental: null, bus: null };
    const item = booking.items[0];
    if (!item || CLOSED.includes(booking.status)) return none;
    const payload = itemPayload(item);

    if (payload.kind === 'flight') {
      const [outbound, back] = payload.offer.slices;
      if (!outbound) return none;
      const city = outbound.destination.cityName;
      const zone = outbound.destination.timeZone;
      const arrival = new Date(outbound.arrivalUtc);
      if (!city || arrival.getTime() <= now.getTime()) return none;
      const pickupAt = onTheHour(outbound.arrivalLocal, 1, zone);
      const returnAt = back
        ? onTheHour(back.departureLocal, -4, back.origin.timeZone)
        : utcToLocal(
            new Date(localToUtc(pickupAt, zone).getTime() + DEFAULT_RENTAL_DAYS * 86_400_000),
            zone,
          );
      return {
        ride: await this.airportRide(city, arrival, now),
        rental: returnAt > pickupAt ? await this.rental(city, pickupAt, returnAt) : null,
        bus: await this.bus(city, outbound.arrivalLocal.slice(0, 10)),
      };
    }
    if (payload.kind === 'hotel') {
      const { checkIn, checkOut } = payload.request;
      if (checkIn <= now.toISOString().slice(0, 10)) return none;
      return {
        ...none,
        rental: await this.rental(payload.hotel.cityName, `${checkIn}T10:00`, `${checkOut}T10:00`),
      };
    }
    return none;
  }

  private async departure(item: Parameters<typeof itemPayload>[0] | undefined) {
    if (!item) return null;
    const payload = itemPayload(item);
    if (payload.kind === 'flight') {
      const [first] = payload.offer.slices;
      if (!first) return null;
      const international = payload.offer.slices.some(
        (slice) =>
          slice.origin.countryCode !== first.origin.countryCode ||
          slice.destination.countryCode !== first.origin.countryCode,
      );
      const airport = first.origin.cityName
        ? await this.prisma.ridePlace.findFirst({
            where: { kind: 'airport', cityName: first.origin.cityName, active: true },
            orderBy: { createdAt: 'asc' },
          })
        : null;
      return {
        kind: 'flight',
        departsAt: new Date(first.departureUtc),
        bufferMinutes: FLIGHT_BUFFER_MINUTES[international ? 'international' : 'domestic'],
        destination: airport
          ? { label: airport.name, lat: airport.lat, lng: airport.lng, cityName: airport.cityName }
          : null,
      } satisfies Departure;
    }
    if (payload.kind === 'bus') {
      const terminal = await this.prisma.busTerminal.findUnique({
        where: { id: payload.origin.terminalId },
      });
      return {
        kind: 'bus',
        departsAt: new Date(payload.departsAtUtc),
        bufferMinutes: BUS_BUFFER_MINUTES,
        destination: terminal
          ? {
              label: terminal.name,
              lat: terminal.lat,
              lng: terminal.lng,
              cityName: terminal.cityName,
            }
          : null,
      } satisfies Departure;
    }
    return null;
  }

  private async airportRide(
    city: string,
    arrival: Date,
    now: Date,
  ): Promise<CarsSuggestionsDto['ride']> {
    if (!this.flags.enabled('rides')) return null;
    const airport = await this.prisma.ridePlace.findFirst({
      where: { kind: 'airport', cityName: city, active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!airport) return null;
    const pickup = new Date(arrival.getTime() + ARRIVAL_RIDE_DELAY_MS);
    const ahead = pickup.getTime() - now.getTime();
    return {
      pickupPlaceId: airport.id,
      pickupLabel: airport.name,
      cityName: city,
      scheduledFor:
        ahead >= RIDE_SCHEDULE_MIN_MS && ahead <= RIDE_SCHEDULE_MAX_MS ? iso(pickup) : null,
    };
  }

  private async rental(
    city: string,
    pickupAtLocal: string,
    returnAtLocal: string,
  ): Promise<CarsSuggestionsDto['rental']> {
    if (!this.flags.enabled('rentals')) return null;
    const cars = await this.prisma.rentalVehicle.count({
      where: { cityName: city, status: 'published' },
    });
    return cars > 0 ? { cityName: city, pickupAtLocal, returnAtLocal } : null;
  }

  private async bus(city: string, date: string): Promise<CarsSuggestionsDto['bus']> {
    if (!this.flags.enabled('buses')) return null;
    const terminals = await this.prisma.busTerminal.count({
      where: { cityName: city, active: true },
    });
    return terminals > 0 ? { from: city, date } : null;
  }
}
