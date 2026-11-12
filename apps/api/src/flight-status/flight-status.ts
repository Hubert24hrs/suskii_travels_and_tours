import { localDate } from '@suskii/shared';

import type { FlightSegment, FlightSlice } from '../suppliers/supplier.types';

import type { FlightStatusQuery } from './flight-status.provider';

// Pure rules of live flight status (ADR-095), shared by the service and its tests.

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** A flight is still followed this long after its scheduled arrival (late arrivals, belts). */
export const STATUS_AFTER_ARRIVAL_HOURS = 6;

/** Every flight of a trip in order: the `flight` index used by seats and status alike. */
export const flightsOf = (slices: readonly FlightSlice[]): FlightSegment[] =>
  slices.flatMap((slice) => slice.segments);

/** What a status provider is asked about a booked flight. */
export const statusQuery = (segment: FlightSegment): FlightStatusQuery => ({
  carrier: segment.marketingCarrier.code,
  flightNumber: segment.flightNumber,
  origin: segment.origin.code,
  destination: segment.destination.code,
  departureDate: localDate(new Date(segment.departureUtc), segment.origin.timeZone),
  scheduledDepartureUtc: segment.departureUtc,
  scheduledArrivalUtc: segment.arrivalUtc,
});

/** When a flight starts and stops being followed. */
export function statusWindow(
  segment: Pick<FlightSegment, 'departureUtc' | 'arrivalUtc'>,
  windowHours: number,
): { from: number; until: number } {
  return {
    from: Date.parse(segment.departureUtc) - windowHours * HOUR_MS,
    until: Date.parse(segment.arrivalUtc) + STATUS_AFTER_ARRIVAL_HOURS * HOUR_MS,
  };
}

/** Whether the flight is followed at this moment. */
export function followedNow(
  segment: Pick<FlightSegment, 'departureUtc' | 'arrivalUtc'>,
  now: Date,
  windowHours: number,
): boolean {
  const { from, until } = statusWindow(segment, windowHours);
  return now.getTime() >= from && now.getTime() <= until;
}

/**
 * When a trip's flights are next due a status check: `checkMinutes` from now while a flight
 * that has not finished is followed, else when the next one starts being followed, else never.
 * `finished` holds the flights that landed, were cancelled or were diverted.
 */
export function nextStatusCheck(
  segments: readonly Pick<FlightSegment, 'departureUtc' | 'arrivalUtc'>[],
  finished: ReadonlySet<number>,
  now: Date,
  settings: { windowHours: number; checkMinutes: number },
): Date | null {
  let next: number | null = null;
  for (const [flight, segment] of segments.entries()) {
    if (finished.has(flight)) continue;
    const { from, until } = statusWindow(segment, settings.windowHours);
    if (now.getTime() > until) continue;
    const due = Math.max(from, now.getTime() + settings.checkMinutes * MINUTE_MS);
    if (next === null || due < next) next = due;
  }
  return next === null ? null : new Date(next);
}
