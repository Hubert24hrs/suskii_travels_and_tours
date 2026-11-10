/**
 * What a booked flight is doing on the day of travel (ADR-095). `delayed` is a flight that has
 * not left and is expected to leave late; once it leaves it is `departed`, however late.
 */
export const FLIGHT_STATES = [
  'scheduled',
  'delayed',
  'boarding',
  'departed',
  'landed',
  'cancelled',
  'diverted',
] as const;
export type FlightState = (typeof FLIGHT_STATES)[number];

/** States after which nothing more is expected of the flight. */
export const FINAL_FLIGHT_STATES: readonly FlightState[] = ['landed', 'cancelled', 'diverted'];

/** States in which the traveller can still act on a new departure time or gate. */
export const BEFORE_DEPARTURE_STATES: readonly FlightState[] = ['scheduled', 'delayed', 'boarding'];

/** What a status alert tells the traveller. */
export const FLIGHT_ALERTS = [
  'delayed',
  'earlier',
  'back_on_time',
  'cancelled',
  'diverted',
  'gate_changed',
] as const;
export type FlightAlert = (typeof FLIGHT_ALERTS)[number];

/**
 * Whole minutes an estimated time is after the scheduled one; 0 when it is on time, early or
 * unknown. Both are UTC instants (ISO strings).
 */
export function delayMinutes(scheduledUtc: string, estimatedUtc: string | null): number {
  if (!estimatedUtc) return 0;
  const late = Date.parse(estimatedUtc) - Date.parse(scheduledUtc);
  return Number.isFinite(late) && late > 0 ? Math.round(late / 60_000) : 0;
}

/** What the traveller was last told about a flight, and what is known now. */
export interface FlightAlertInput {
  /** The delay the traveller was last told about, in minutes; null when never told of one. */
  alertedDelayMinutes: number | null;
  /** The state the traveller was last told about (cancelled or diverted), if any. */
  alertedState: FlightState | null;
  /** The departure gate before this reading; null when none was known. */
  previousGate: string | null;
  state: FlightState;
  delayMinutes: number;
  departureGate: string | null;
}

/**
 * The alert a new reading calls for, or null (ADR-095). One reading gives at most one alert,
 * the most serious first:
 *
 * - a cancellation or a diversion, once;
 * - before departure, a delay of `threshold` minutes or more, and again whenever the expected
 *   delay moves by `step` minutes or more: later (`delayed`) or earlier (`earlier`, which matters
 *   more: the traveller must not arrive late);
 * - a delay the traveller was told about that has gone (`back_on_time`);
 * - a departure gate that replaced a known one.
 */
export function flightAlert(
  input: FlightAlertInput,
  thresholds: { threshold: number; step: number },
): FlightAlert | null {
  const { state } = input;
  if (state === 'cancelled' || state === 'diverted') {
    return input.alertedState === state ? null : state;
  }
  if (!BEFORE_DEPARTURE_STATES.includes(state)) return null;
  const told = input.alertedDelayMinutes;
  if (input.delayMinutes >= thresholds.threshold) {
    if (told === null) return 'delayed';
    if (input.delayMinutes - told >= thresholds.step) return 'delayed';
    if (told - input.delayMinutes >= thresholds.step) return 'earlier';
  } else if (told !== null && told >= thresholds.threshold) {
    return 'back_on_time';
  }
  if (
    input.previousGate !== null &&
    input.departureGate !== null &&
    input.previousGate !== input.departureGate
  ) {
    return 'gate_changed';
  }
  return null;
}
