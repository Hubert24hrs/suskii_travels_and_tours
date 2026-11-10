import { describe, expect, it } from 'vitest';

import { delayMinutes, flightAlert, type FlightAlertInput } from './flight-status';

const LIMITS = { threshold: 30, step: 15 };
const reading = (patch: Partial<FlightAlertInput>): FlightAlertInput => ({
  alertedDelayMinutes: null,
  alertedState: null,
  previousGate: null,
  state: 'scheduled',
  delayMinutes: 0,
  departureGate: null,
  ...patch,
});

describe('delayMinutes', () => {
  it('counts whole minutes late and never goes below zero', () => {
    expect(delayMinutes('2026-12-01T06:00:00Z', '2026-12-01T06:45:00Z')).toBe(45);
    expect(delayMinutes('2026-12-01T06:00:00Z', '2026-12-01T05:50:00Z')).toBe(0);
    expect(delayMinutes('2026-12-01T06:00:00Z', null)).toBe(0);
    expect(delayMinutes('2026-12-01T06:00:00Z', 'not a time')).toBe(0);
  });
});

describe('flightAlert', () => {
  it('says nothing about a flight on time or a short delay', () => {
    expect(flightAlert(reading({}), LIMITS)).toBeNull();
    expect(flightAlert(reading({ state: 'delayed', delayMinutes: 20 }), LIMITS)).toBeNull();
  });

  it('tells of a delay once, then only when it moves by the step', () => {
    expect(flightAlert(reading({ state: 'delayed', delayMinutes: 45 }), LIMITS)).toBe('delayed');
    const told = { state: 'delayed' as const, alertedDelayMinutes: 45 };
    expect(flightAlert(reading({ ...told, delayMinutes: 50 }), LIMITS)).toBeNull();
    expect(flightAlert(reading({ ...told, delayMinutes: 60 }), LIMITS)).toBe('delayed');
  });

  it('tells of a delay that shrinks, and of one that has gone', () => {
    const told = { state: 'delayed' as const, alertedDelayMinutes: 90 };
    expect(flightAlert(reading({ ...told, delayMinutes: 60 }), LIMITS)).toBe('earlier');
    expect(flightAlert(reading({ ...told, delayMinutes: 80 }), LIMITS)).toBeNull();
    expect(flightAlert(reading({ ...told, state: 'scheduled', delayMinutes: 0 }), LIMITS)).toBe(
      'back_on_time',
    );
  });

  it('tells of a cancellation or a diversion once', () => {
    expect(flightAlert(reading({ state: 'cancelled' }), LIMITS)).toBe('cancelled');
    expect(
      flightAlert(reading({ state: 'cancelled', alertedState: 'cancelled' }), LIMITS),
    ).toBeNull();
    expect(flightAlert(reading({ state: 'diverted' }), LIMITS)).toBe('diverted');
  });

  it('tells of a new gate only when one was known, and never after departure', () => {
    expect(flightAlert(reading({ departureGate: 'B4' }), LIMITS)).toBeNull();
    expect(flightAlert(reading({ previousGate: 'B4', departureGate: 'C1' }), LIMITS)).toBe(
      'gate_changed',
    );
    expect(
      flightAlert(reading({ state: 'departed', previousGate: 'B4', departureGate: 'C1' }), LIMITS),
    ).toBeNull();
    // A delay that needs telling comes before the gate.
    expect(
      flightAlert(
        reading({ state: 'delayed', delayMinutes: 40, previousGate: 'B4', departureGate: 'C1' }),
        LIMITS,
      ),
    ).toBe('delayed');
  });

  it('says nothing more once the flight has left', () => {
    expect(flightAlert(reading({ state: 'departed', delayMinutes: 120 }), LIMITS)).toBeNull();
    expect(flightAlert(reading({ state: 'landed', delayMinutes: 120 }), LIMITS)).toBeNull();
  });
});
