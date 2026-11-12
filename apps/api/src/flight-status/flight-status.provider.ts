import type { FlightState } from '@suskii/shared';

import { SeededRandom, stableCode } from '../suppliers/mock/random';

/** One booked flight, as flight-data providers key it: airline, number and the day it leaves. */
export interface FlightStatusQuery {
  /** The marketing airline's IATA code and the flight number without it ("P4", "7120"). */
  carrier: string;
  flightNumber: string;
  origin: string;
  destination: string;
  /** The local calendar date of the scheduled departure at the origin, "2026-12-01". */
  departureDate: string;
  scheduledDepartureUtc: string;
  scheduledArrivalUtc: string;
}

/** What the provider knows about the flight now. Times are UTC instants (ISO strings). */
export interface FlightStatusReport {
  state: FlightState;
  estimatedDepartureUtc: string | null;
  estimatedArrivalUtc: string | null;
  departureTerminal: string | null;
  departureGate: string | null;
  arrivalTerminal: string | null;
  arrivalGate: string | null;
  baggageBelt: string | null;
}

/** The provider could not answer. The code names the reason; it never holds flight details. */
export class FlightStatusError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
  ) {
    super(`Flight status failed: ${provider} ${code}`);
    this.name = 'FlightStatusError';
  }
}

/**
 * Live flight data on the day of travel (ADR-095). Adapters keep the vendor's payloads to
 * themselves, honour the `AbortSignal` and send only what a query holds: no traveller, booking
 * or contact detail ever reaches a status provider.
 */
export abstract class FlightStatusProvider {
  abstract readonly name: string;
  /** One answer per query, in order; null for a flight the provider does not know. */
  abstract status(
    flights: readonly FlightStatusQuery[],
    signal: AbortSignal,
  ): Promise<(FlightStatusReport | null)[]>;
}

/** What the mock is told to report on a route or a flight: a delay in minutes, or a state. */
export interface MockFlightStatusRule {
  state?: 'cancelled' | 'diverted';
  delayMinutes?: number;
  departureGate?: string;
}

const MINUTE_MS = 60_000;
const BOARDING_MINUTES = 40;

/**
 * Development and test flight data (refused in production unless ALLOW_MOCK_PROVIDERS). Every
 * flight runs on time, with a terminal and a gate that are stable for the flight, and moves
 * from scheduled to boarding, departed and landed as the clock passes its times. `rules`
 * (from `MOCK_FLIGHT_STATUS_RULES`, e.g. `LOS-ABV:delayed:45` or `LOS-LHR:cancelled`, keyed by
 * route) and `flights` (keyed "P47120") make a flight late, cancelled or diverted.
 */
export class MockFlightStatusProvider extends FlightStatusProvider {
  readonly name = 'mock';
  /** Test hooks: by flight ("P47120"), the next calls fail, the flights asked for, the clock. */
  readonly flights = new Map<string, MockFlightStatusRule>();
  failNext = 0;
  readonly asked: FlightStatusQuery[] = [];
  now: () => Date = () => new Date();

  constructor(readonly rules: Map<string, MockFlightStatusRule> = new Map()) {
    super();
  }

  status(
    flights: readonly FlightStatusQuery[],
    signal: AbortSignal,
  ): Promise<(FlightStatusReport | null)[]> {
    signal.throwIfAborted();
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new FlightStatusError(this.name, 'unavailable'));
    }
    this.asked.push(...flights);
    return Promise.resolve(flights.map((flight) => this.report(flight)));
  }

  private report(flight: FlightStatusQuery): FlightStatusReport {
    const rule =
      this.flights.get(`${flight.carrier}${flight.flightNumber}`) ??
      this.rules.get(`${flight.origin}-${flight.destination}`) ??
      {};
    const seed = `status|${flight.carrier}${flight.flightNumber}|${flight.departureDate}`;
    const random = new SeededRandom(seed);
    const places = {
      departureTerminal: String(random.int(1, 2)),
      departureGate: rule.departureGate ?? `${stableCode(seed, 1, 'ABCD')}${random.int(1, 24)}`,
      arrivalTerminal: String(random.int(1, 3)),
      arrivalGate: null,
      baggageBelt: null,
    };
    if (rule.state) {
      return {
        state: rule.state,
        estimatedDepartureUtc: null,
        estimatedArrivalUtc: null,
        ...places,
      };
    }
    const late = (rule.delayMinutes ?? 0) * MINUTE_MS;
    const departure = Date.parse(flight.scheduledDepartureUtc) + late;
    const arrival = Date.parse(flight.scheduledArrivalUtc) + late;
    const now = this.now().getTime();
    const state: FlightState =
      now >= arrival
        ? 'landed'
        : now >= departure
          ? 'departed'
          : late > 0
            ? 'delayed'
            : now >= departure - BOARDING_MINUTES * MINUTE_MS
              ? 'boarding'
              : 'scheduled';
    return {
      state,
      estimatedDepartureUtc: new Date(departure).toISOString(),
      estimatedArrivalUtc: new Date(arrival).toISOString(),
      ...places,
      baggageBelt: state === 'landed' ? String(random.int(1, 8)) : null,
    };
  }
}
