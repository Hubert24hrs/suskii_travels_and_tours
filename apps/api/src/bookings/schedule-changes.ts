import { fromJsonValue } from '../common/json';
import { documentDateTime } from '../documents/booking-pdf';
import type { FlightSlice } from '../suppliers/supplier.types';

// Pure rules of airline schedule changes (ADR-065), shared by the service and its tests.

/** The stored slices of a change, in our domain shape. */
export const changeSlices = (value: unknown): FlightSlice[] => fromJsonValue<FlightSlice[]>(value);

/**
 * What the traveller would notice about an itinerary: flights, airports and times. Two mappings
 * of the same flights (an offer and the order made from it) give the same signature.
 */
export function itinerarySignature(slices: readonly FlightSlice[]): string {
  return slices
    .map((slice) =>
      slice.segments
        .map(
          (segment) =>
            `${segment.marketingCarrier.code}${segment.flightNumber}:${segment.origin.code}-${segment.destination.code}@${segment.departureUtc}/${segment.arrivalUtc}`,
        )
        .join(','),
    )
    .join('|');
}

/** Checks stop once the last flight of the trip has left: nothing can change after that. */
export function departed(slices: readonly FlightSlice[], now: Date): boolean {
  const last = slices[slices.length - 1];
  return !last || Date.parse(last.departureUtc) <= now.getTime();
}

const place = (point: { code: string; cityName: string | null }): string =>
  `${point.cityName ?? point.code} (${point.code})`;

const flights = (slice: FlightSlice): string =>
  slice.segments
    .map((segment) => `${segment.marketingCarrier.code} ${segment.flightNumber}`)
    .join(' and ');

const times = (slice: FlightSlice): string =>
  `${flights(slice)}, departing ${documentDateTime(slice.departureLocal)} and arriving ${documentDateTime(slice.arrivalLocal)}`;

/**
 * One line per changed flight for the email, old and new side by side: "Lagos (LOS) to Abuja
 * (ABV): was W3 101, departing Thu, 26 Nov 2026 08:30 and arriving ... Now W3 105, ...".
 */
export function changeLines(
  removed: readonly FlightSlice[],
  added: readonly FlightSlice[],
): string[] {
  const lines: string[] = [];
  for (let index = 0; index < Math.max(removed.length, added.length); index += 1) {
    const before = removed[index];
    const after = added[index];
    const route = before ?? after;
    if (!route) continue;
    const was = before ? `was ${times(before)}.` : '';
    const now = after
      ? `${before ? 'Now' : 'now'} ${times(after)}.`
      : 'This flight is no longer in your booking.';
    lines.push(
      `${place(route.origin)} to ${place(route.destination)}: ${[was, now].filter(Boolean).join(' ')}`,
    );
  }
  return lines;
}

const HOUR_MS = 3_600_000;

/** Hours a flight may move before the change is significant (ADR-073, the US DOT thresholds). */
export interface SignificanceThresholds {
  domesticHours: number;
  internationalHours: number;
}

/** Within one country: every airport of the booked flight is known to be in the same country. */
function domestic(slice: FlightSlice): boolean {
  const countries = slice.segments.flatMap((segment) => [
    segment.origin.countryCode,
    segment.destination.countryCode,
  ]);
  return countries.length > 0 && countries.every((code) => code !== null && code === countries[0]);
}

const movedHours = (before: string, after: string): number =>
  Math.abs(Date.parse(after) - Date.parse(before)) / HOUR_MS;

/**
 * Whether a change entitles the traveller to a full refund (ADR-073): a flight removed with no
 * replacement, another airport, more connections, or a departure or arrival moved by the
 * threshold. A change whose flights could not be read (no slices) is left to support.
 */
export function significantChange(
  removed: readonly FlightSlice[],
  added: readonly FlightSlice[],
  thresholds: SignificanceThresholds,
): boolean {
  if (removed.length === 0) return false;
  if (added.length < removed.length) return true;
  return removed.some((before, index) => {
    const after = added[index];
    if (!after) return true;
    if (after.origin.code !== before.origin.code) return true;
    if (after.destination.code !== before.destination.code) return true;
    if (after.segments.length > before.segments.length) return true;
    const limit = domestic(before) ? thresholds.domesticHours : thresholds.internationalHours;
    return (
      movedHours(before.departureUtc, after.departureUtc) >= limit ||
      movedHours(before.arrivalUtc, after.arrivalUtc) >= limit
    );
  });
}

/**
 * Whether the traveller may take a full refund instead of this change (ADR-073): an open,
 * significant change the airline would cancel online for (`cancellable`), not handed to support.
 */
export function refundOfferOpen(
  change: { status: string; significant: boolean; refundOfferWithdrawnAt: Date | null },
  cancellable: boolean,
): boolean {
  return (
    cancellable &&
    change.status === 'open' &&
    change.significant &&
    change.refundOfferWithdrawnAt === null
  );
}
