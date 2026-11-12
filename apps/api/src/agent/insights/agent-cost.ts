const DAY_MS = 86_400_000;

/** A forecast from less of a month than this is noise: one busy day is not a month. */
export const FORECAST_MIN_DAYS = 3;

/**
 * `forecast`: at the rate so far, the month ends past the threshold. `spent`: the month is
 * already past it.
 */
export const COST_ALERT_LEVELS = ['forecast', 'spent'] as const;
export type CostAlertLevel = (typeof COST_ALERT_LEVELS)[number];

export interface MonthSpend {
  /** Estimated spend since the first of the UTC month, in millionths of a US dollar. */
  toDateMicroUsd: number;
  /** That spend carried to the month's end at the same daily rate. */
  forecastMicroUsd: number;
  daysElapsed: number;
  daysInMonth: number;
}

export const monthStartOf = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** `2026-11`: the UTC month an alert is told once for. */
export const monthKey = (now: Date): string => now.toISOString().slice(0, 7);

/**
 * The month's spend so far and where it ends at the same daily rate (ADR-106). An estimate
 * from an estimate: the tokens the models reported at the configured prices, and a straight
 * line. The part of the month that has passed counts today by the hour.
 */
export function monthSpend(toDateMicroUsd: number, now: Date): MonthSpend {
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const elapsed = (now.getTime() - monthStartOf(now).getTime()) / DAY_MS;
  return {
    toDateMicroUsd,
    forecastMicroUsd: elapsed > 0 ? Math.round((toDateMicroUsd / elapsed) * daysInMonth) : 0,
    daysElapsed: Math.max(1, Math.ceil(elapsed)),
    daysInMonth,
  };
}

/**
 * What the month's figures call for at a threshold: nothing while none is set or neither
 * figure reaches it; `spent` once the spend itself has; `forecast` when only the forecast
 * has, and enough of the month has passed for a forecast to mean something.
 */
export function costAlertLevel(
  month: MonthSpend,
  thresholdMicroUsd: number,
): CostAlertLevel | null {
  if (thresholdMicroUsd <= 0) return null;
  if (month.toDateMicroUsd >= thresholdMicroUsd) return 'spent';
  return month.daysElapsed >= FORECAST_MIN_DAYS && month.forecastMicroUsd >= thresholdMicroUsd
    ? 'forecast'
    : null;
}
