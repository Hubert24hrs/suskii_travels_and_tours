import { daysBetween } from '@suskii/shared';

import type { FlightSegment, FlightSlice, Layover, LayoverWarning } from './supplier.types';

const MINUTE_MS = 60_000;
/** Below this, a connection is flagged as tight (90 minutes if the airport changes). */
const SHORT_CONNECTION_MINUTES = 60;
const SHORT_AIRPORT_CHANGE_MINUTES = 180;
const LONG_LAYOVER_MINUTES = 6 * 60;
const OVERNIGHT_MIN_MINUTES = 4 * 60;

export const minutesBetween = (fromUtc: string, toUtc: string): number =>
  Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / MINUTE_MS);

/** Layovers with warnings from the spec: short connection, airport change, overnight, long. */
export function layoversFor(segments: readonly FlightSegment[]): Layover[] {
  const layovers: Layover[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const inbound = segments[index - 1];
    const outbound = segments[index];
    if (!inbound || !outbound) continue;
    const durationMinutes = minutesBetween(inbound.arrivalUtc, outbound.departureUtc);
    const airportChange = inbound.destination.code !== outbound.origin.code;
    const warnings: LayoverWarning[] = [];
    if (
      durationMinutes < (airportChange ? SHORT_AIRPORT_CHANGE_MINUTES : SHORT_CONNECTION_MINUTES)
    ) {
      warnings.push('short_connection');
    }
    if (airportChange) warnings.push('airport_change');
    // Overnight: a long wait that crosses local midnight or starts in the small hours.
    const arrivalHour = Number(inbound.arrivalLocal.slice(11, 13));
    const crossesMidnight = daysBetween(inbound.arrivalLocal, outbound.departureLocal) > 0;
    if (durationMinutes >= OVERNIGHT_MIN_MINUTES && (crossesMidnight || arrivalHour < 5)) {
      warnings.push('overnight');
    }
    if (durationMinutes >= LONG_LAYOVER_MINUTES) warnings.push('long_layover');
    layovers.push({ airport: inbound.destination, durationMinutes, warnings });
  }
  return layovers;
}

/** Builds a slice summary from its segments. */
export function buildSlice(segments: FlightSegment[], fareBrand: string | null): FlightSlice {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) throw new Error('A slice needs at least one segment');
  return {
    origin: first.origin,
    destination: last.destination,
    departureLocal: first.departureLocal,
    departureUtc: first.departureUtc,
    arrivalLocal: last.arrivalLocal,
    arrivalUtc: last.arrivalUtc,
    durationMinutes: minutesBetween(first.departureUtc, last.arrivalUtc),
    stops: segments.length - 1,
    arrivalDayOffset: daysBetween(first.departureLocal, last.arrivalLocal),
    fareBrand,
    segments,
    layovers: layoversFor(segments),
  };
}

/** Stable identity of an itinerary across suppliers, used to de-duplicate merged results. */
export function itineraryKey(
  slices: readonly FlightSlice[],
  fareBrand: string | null,
  cabin: string,
): string {
  const flights = slices
    .flatMap((slice) =>
      slice.segments.map((s) => `${s.marketingCarrier.code}${s.flightNumber}@${s.departureUtc}`),
    )
    .join('|');
  return `${cabin}:${fareBrand ?? ''}:${flights}`;
}
