/**
 * The values a date field holds, exactly as the API takes them: a calendar day `YYYY-MM-DD`, or
 * a wall time `YYYY-MM-DDTHH:mm` on the 24 hour clock. Days compare as strings. Nothing here
 * reads a time zone: a wall time names a time at a place, not an instant.
 */

export type DateFieldMode = 'date' | 'dateTime';

/** A value in parts while it is being chosen; '' for a part not chosen yet. */
export interface DateParts {
  /** `YYYY-MM-DD` */
  day: string;
  /** `00` to `23` */
  hour: string;
  /** `00` to `59` */
  minute: string;
}

export const NO_PARTS: DateParts = { day: '', hour: '', minute: '' };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

const pad = (value: number): string => String(value).padStart(2, '0');

/** A local calendar day as `YYYY-MM-DD`. */
export function toIsoDay(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `YYYY-MM-DD` as a local midnight Date; undefined when it names no real day (`2026-02-30`). */
export function fromIsoDay(value: string): Date | undefined {
  const match = DAY.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(0, 0, 1);
  date.setFullYear(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : undefined;
}

/** The parts of a value, or null when the value is not one of `mode` (empty, typed, invalid). */
export function splitDateValue(value: string, mode: DateFieldMode): DateParts | null {
  if (mode === 'date') return fromIsoDay(value) ? { ...NO_PARTS, day: value } : null;
  const match = WALL_TIME.exec(value);
  if (!match) return null;
  const [, day = '', hour = '', minute = ''] = match;
  return fromIsoDay(day) && Number(hour) < 24 && Number(minute) < 60 ? { day, hour, minute } : null;
}

/** The value once every part `mode` needs is chosen, else null. */
export function joinDateValue(parts: DateParts, mode: DateFieldMode): string | null {
  if (parts.day === '') return null;
  if (mode === 'date') return parts.day;
  return parts.hour !== '' && parts.minute !== ''
    ? `${parts.day}T${parts.hour}:${parts.minute}`
    : null;
}

/** Whether a day (`YYYY-MM-DD`) lies within `min` and `max`, both included. */
export const dayInRange = (day: string, min: string, max: string): boolean =>
  day >= min && day <= max;

/** The day nearest `day` within `min` and `max`. */
export const clampDay = (day: string, min: string, max: string): string =>
  day < min ? min : day > max ? max : day;

/** Whether a month (`YYYY-MM`) has at least one day within `min` and `max`. */
export const monthInRange = (month: string, min: string, max: string): boolean =>
  month >= min.slice(0, 7) && month <= max.slice(0, 7);

/** The month (`YYYY-MM`) `offset` months after `month`. */
export function shiftMonth(month: string, offset: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + offset;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad((index % 12) + 1)}`;
}

/**
 * The years from `min` to `max`, starting at the end nearer `today`: the newest first for a
 * date of birth, the soonest first for an expiry date. The list opens where most answers are.
 */
export function yearsBetween(min: string, max: string, today: string): number[] {
  const first = Number(min.slice(0, 4));
  const last = Number(max.slice(0, 4));
  const now = Number(today.slice(0, 4));
  const years = Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
  return Math.abs(last - now) < Math.abs(first - now) ? years.reverse() : years;
}

/** The hours of the 24 hour clock, `00` to `23`. */
export const HOURS: readonly string[] = Array.from({ length: 24 }, (_, hour) => pad(hour));

/**
 * Minutes every `step` (`00`, `05`, ...). A chosen minute off the step (a time suggested from
 * an instant, `14:37`) is added in its place, so the choice shows and nothing rounds it.
 */
export function minuteOptions(step: number, chosen: string): string[] {
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, index) => pad(index * step));
  return chosen !== '' && !minutes.includes(chosen) ? [...minutes, chosen].sort() : minutes;
}

/** Items in rows of `size` (grids of years, months, hours). */
export function rowsOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, row) =>
    items.slice(row * size, row * size + size),
  );
}
