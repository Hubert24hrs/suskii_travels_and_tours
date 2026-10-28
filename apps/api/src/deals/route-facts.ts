/**
 * Route facts from fare history (ADR-080). Pure rules over one route's `route_fares` rows; the
 * service prices the rows they pick, so supplier cost never leaves the API.
 */

/** The columns the rules read. */
export interface FareRow {
  observedOn: Date;
  departureDate: Date;
  supplier: string;
  carrierCode: string;
  carrierName: string;
  stops: number;
  durationMinutes: number;
  /** Base plus taxes in US cents when found: the only comparison between rows. */
  usdMinor: bigint;
  updatedAt: Date;
}

export interface FareSummary<Row extends FareRow> {
  /** Lowest fare found in the last 30 days. */
  cheapest: Row;
  /** The median of each day's cheapest fare over 90 days (the lower middle day). */
  typical: Row;
  /** Carriers seen in 90 days, most often first, then by name. */
  airlines: { code: string; name: string }[];
  direct: boolean;
  fastestMinutes: number;
  /** Departure month (1 to 12) with the lowest median over 365 days, with 3 months or more seen. */
  cheapestMonth: number | null;
  observedDays: number;
  sample: boolean;
  updatedAt: Date;
}

const DAY_MS = 86_400_000;
export const RECENT_DAYS = 30;
export const TYPICAL_DAYS = 90;
export const MONTH_DAYS = 365;
export const MAX_AIRLINES = 6;
export const MIN_MONTHS = 3;
const MOCK_SUPPLIER = 'mock';

const dayKey = (value: Date): string => value.toISOString().slice(0, 10);
const byPrice = (a: FareRow, b: FareRow): number =>
  a.usdMinor < b.usdMinor ? -1 : a.usdMinor > b.usdMinor ? 1 : 0;

/** The UTC calendar day `days` before `today`'s day, as a Date at midnight. */
export function daysBefore(today: Date, days: number): Date {
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(midnight - days * DAY_MS);
}

/** Lower median of a sorted list: an actual row, so the price is a real fare, never an average. */
function lowerMedian<T>(sorted: T[]): T | undefined {
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * Summarises one route's fares, or null while fewer than `minDays` days were observed in the last
 * 90 (facts on thin data would mislead). Rows may span more than a year; older ones are ignored.
 */
export function summariseFares<Row extends FareRow>(
  rows: readonly Row[],
  today: Date,
  minDays: number,
  airlineNames: ReadonlyMap<string, string> = new Map(),
): FareSummary<Row> | null {
  const typicalFrom = daysBefore(today, TYPICAL_DAYS - 1).getTime();
  const recentFrom = daysBefore(today, RECENT_DAYS - 1).getTime();
  const monthFrom = daysBefore(today, MONTH_DAYS - 1).getTime();
  const window = rows.filter((row) => row.observedOn.getTime() >= typicalFrom);

  const cheapestPerDay = new Map<string, Row>();
  for (const row of window) {
    const key = dayKey(row.observedOn);
    const best = cheapestPerDay.get(key);
    if (!best || byPrice(row, best) < 0) cheapestPerDay.set(key, row);
  }
  if (cheapestPerDay.size < minDays) return null;

  const daily = [...cheapestPerDay.values()].sort(byPrice);
  const typical = lowerMedian(daily);
  const recent = window.filter((row) => row.observedOn.getTime() >= recentFrom).sort(byPrice);
  const cheapest = recent[0] ?? daily[0];
  if (!typical || !cheapest) return null;

  const carriers = new Map<string, { code: string; name: string; count: number }>();
  for (const row of window) {
    const entry = carriers.get(row.carrierCode) ?? {
      code: row.carrierCode,
      name: airlineNames.get(row.carrierCode) ?? row.carrierName,
      count: 0,
    };
    entry.count += 1;
    carriers.set(row.carrierCode, entry);
  }
  const airlines = [...carriers.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_AIRLINES)
    .map(({ code, name }) => ({ code, name }));

  const months = new Map<number, Row[]>();
  for (const row of rows) {
    if (row.observedOn.getTime() < monthFrom) continue;
    const month = row.departureDate.getUTCMonth() + 1;
    months.set(month, [...(months.get(month) ?? []), row]);
  }
  let cheapestMonth: number | null = null;
  if (months.size >= MIN_MONTHS) {
    let best: Row | undefined;
    for (const [month, monthRows] of months) {
      const median = lowerMedian([...monthRows].sort(byPrice));
      if (median && (!best || byPrice(median, best) < 0)) {
        best = median;
        cheapestMonth = month;
      }
    }
  }

  return {
    cheapest,
    typical,
    airlines,
    direct: window.some((row) => row.stops === 0),
    fastestMinutes: Math.min(...window.map((row) => row.durationMinutes)),
    cheapestMonth,
    observedDays: cheapestPerDay.size,
    sample: window.some((row) => row.supplier === MOCK_SUPPLIER),
    updatedAt: new Date(Math.max(...window.map((row) => row.updatedAt.getTime()))),
  };
}

/** A city's URL slug: `Port Harcourt` → `port-harcourt`, accents dropped. */
export function citySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
