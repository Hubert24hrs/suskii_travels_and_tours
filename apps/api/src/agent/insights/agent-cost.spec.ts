import {
  costAlertLevel,
  FORECAST_MIN_DAYS,
  monthKey,
  monthSpend,
  monthStartOf,
} from './agent-cost';

const at = (iso: string): Date => new Date(iso);

describe("the month's cost of the assistant and when to tell (ADR-106)", () => {
  it('carries the spend so far to the end of the month at the same daily rate', () => {
    // Ten days of a thirty-day month: three times what was spent.
    expect(monthSpend(10_000_000, at('2026-11-11T00:00:00.000Z'))).toEqual({
      toDateMicroUsd: 10_000_000,
      forecastMicroUsd: 30_000_000,
      daysElapsed: 10,
      daysInMonth: 30,
    });
    // Today counts by the hour: at noon on the 1st, half a day has passed.
    expect(monthSpend(1_000_000, at('2026-12-01T12:00:00.000Z'))).toEqual({
      toDateMicroUsd: 1_000_000,
      forecastMicroUsd: 62_000_000,
      daysElapsed: 1,
      daysInMonth: 31,
    });
    // February of a leap year, and the first instant of a month.
    expect(monthSpend(0, at('2028-02-15T00:00:00.000Z')).daysInMonth).toBe(29);
    expect(monthSpend(500, at('2026-11-01T00:00:00.000Z'))).toMatchObject({
      forecastMicroUsd: 0,
      daysElapsed: 1,
    });
  });

  it('names the UTC month and its first instant', () => {
    expect(monthKey(at('2026-11-30T23:59:59.000Z'))).toBe('2026-11');
    expect(monthStartOf(at('2026-11-30T23:59:59.000Z')).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });

  it('tells of a forecast only after the first days, and of spend at any time', () => {
    const month = (toDate: number, iso: string) => monthSpend(toDate, at(iso));
    const threshold = 40_000_000;
    // No figure set: nobody is told, whatever was spent.
    expect(costAlertLevel(month(90_000_000, '2026-11-20T00:00:00.000Z'), 0)).toBeNull();
    // Day 1: a busy morning forecasts a fortune and means nothing yet.
    const early = month(3_000_000, '2026-11-01T12:00:00.000Z');
    expect(early.forecastMicroUsd).toBeGreaterThan(threshold);
    expect(early.daysElapsed).toBeLessThan(FORECAST_MIN_DAYS);
    expect(costAlertLevel(early, threshold)).toBeNull();
    // Day 10 at 1.5 dollars a day: 45 by the month's end.
    expect(costAlertLevel(month(15_000_000, '2026-11-11T00:00:00.000Z'), threshold)).toBe(
      'forecast',
    );
    // Day 10 at one dollar a day: 30 by the month's end.
    expect(costAlertLevel(month(10_000_000, '2026-11-11T00:00:00.000Z'), threshold)).toBeNull();
    // Past the figure itself, also on the first day.
    expect(costAlertLevel(month(40_000_000, '2026-11-25T00:00:00.000Z'), threshold)).toBe('spent');
    expect(costAlertLevel(month(41_000_000, '2026-11-01T06:00:00.000Z'), threshold)).toBe('spent');
  });
});
