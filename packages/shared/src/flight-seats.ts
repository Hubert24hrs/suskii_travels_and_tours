/**
 * Seat selection on flights (ADR-094): what a seat map says about a seat and the limits of a
 * selection. Framework-free, shared by the API, the website and the app.
 */

/** What sets a seat apart on the map; a seat may have several, or none (a middle seat). */
export const SEAT_FEATURES = ['window', 'aisle', 'extra_legroom', 'exit_row'] as const;
export type SeatFeature = (typeof SEAT_FEATURES)[number];

/** A seat as airlines print it: row then letter ("12A"). */
export const SEAT_DESIGNATOR_PATTERN = /^[1-9]\d{0,2}[A-Z]$/;

/** One seat per traveller with a seat on each flight: nine travellers on up to twelve flights. */
export const MAX_SEAT_SELECTIONS = 108;

/** A chosen seat: which flight of the trip (all flights in order, from 0), who, and where. */
export interface SeatChoice {
  flight: number;
  passengerIndex: number;
  designator: string;
}

/** Why a set of seat choices cannot be booked; the first problem found. */
export const SEAT_CHOICE_ISSUES = [
  'unknown_traveller',
  'unknown_flight',
  'unknown_seat',
  'seat_taken',
  'seat_chosen_twice',
  'two_seats_one_traveller',
  'no_seat_for_infant',
] as const;
export type SeatChoiceIssue = (typeof SEAT_CHOICE_ISSUES)[number];

/**
 * The rules a selection must pass whatever the airline: one seat per traveller per flight, no
 * seat shared, none for a lap infant. `seated` is how many travellers have a seat of their own
 * (adults and children; they come first in the passenger list).
 */
export function seatChoiceIssue(
  choices: readonly SeatChoice[],
  seated: number,
): SeatChoiceIssue | null {
  const seats = new Set<string>();
  const travellers = new Set<string>();
  for (const choice of choices) {
    if (choice.passengerIndex >= seated) return 'no_seat_for_infant';
    const seat = `${choice.flight}|${choice.designator}`;
    if (seats.has(seat)) return 'seat_chosen_twice';
    seats.add(seat);
    const traveller = `${choice.flight}|${choice.passengerIndex}`;
    if (travellers.has(traveller)) return 'two_seats_one_traveller';
    travellers.add(traveller);
  }
  return null;
}
