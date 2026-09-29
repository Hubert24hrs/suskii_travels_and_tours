/**
 * IANA time-zone helpers built on Intl (no dependency; works in Node, browsers and Hermes).
 * Flight times are stored in UTC plus the airport's zone; users see local wall times.
 *
 * Local date-times use the ISO form without offset: "2026-10-01T08:30" (seconds optional).
 */

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The zone whose calendar date is always the earliest on Earth (UTC-12; Etc signs are inverted). */
export const EARLIEST_TIME_ZONE = 'Etc/GMT+12';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** Offset from UTC in minutes at an instant (Lagos +60, New York -240 in summer). */
export function utcOffsetMinutes(instant: Date, timeZone: string): number {
  const wall = wallClock(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60_000);
}

/** "2026-10-01T08:30" in the zone at that instant. */
export function utcToLocal(instant: Date, timeZone: string): string {
  const wall = wallClock(instant, timeZone);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}T${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** The calendar date ("2026-10-01") in the zone at that instant. */
export function localDate(instant: Date, timeZone: string): string {
  return utcToLocal(instant, timeZone).slice(0, 10);
}

/**
 * Wall time in a zone to an instant. DST edge cases follow Temporal's `compatible` behaviour:
 * a time skipped by a spring-forward gap moves forward by the gap; a time repeated by a
 * fall-back overlap resolves to the earlier instant (`later` picks the second one).
 */
export function localToUtc(
  local: string,
  timeZone: string,
  disambiguation: 'compatible' | 'earlier' | 'later' = 'compatible',
): Date {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) throw new RangeError(`Invalid local date-time: ${local}`);
  const [, year, month, day, hour, minute, second] = match;
  const wall = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
  // Transitions never happen twice within a day, so the offsets 12 hours either side are the
  // only candidates.
  const before = utcOffsetMinutes(new Date(wall - 12 * HOUR_MS), timeZone);
  const after = utcOffsetMinutes(new Date(wall + 12 * HOUR_MS), timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => wall - offset * 60_000)
    .filter((instant) => utcOffsetMinutes(new Date(instant), timeZone) * 60_000 === wall - instant)
    .sort((a, b) => a - b);

  if (valid.length > 0) {
    const chosen = disambiguation === 'later' ? valid[valid.length - 1] : valid[0];
    return new Date(chosen ?? wall);
  }
  // In a gap: interpret with the offset before the transition (lands after the gap).
  const offset = disambiguation === 'earlier' ? after : before;
  return new Date(wall - offset * 60_000);
}

function parseDate(date: string): number {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new RangeError(`Invalid date: ${date}`);
  const [, year, month, day] = match;
  const value = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (new Date(value).toISOString().slice(0, 10) !== date)
    throw new RangeError(`Invalid date: ${date}`);
  return value;
}

export function isValidDate(date: string): boolean {
  try {
    parseDate(date);
    return true;
  } catch {
    return false;
  }
}

/** Calendar arithmetic on "YYYY-MM-DD" strings. */
export function addDays(date: string, days: number): string {
  return new Date(parseDate(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD" or local date-times). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to.slice(0, 10)) - parseDate(from.slice(0, 10))) / DAY_MS);
}

/** The earliest calendar date that is "today" somewhere on Earth: safe client-side lower bound. */
export function earliestToday(now: Date = new Date()): string {
  return localDate(now, EARLIEST_TIME_ZONE);
}
