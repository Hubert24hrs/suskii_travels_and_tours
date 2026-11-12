import { utcToLocal } from './time';

/**
 * Staffed support hours (ADR-085), kept apart from `support.ts` so the website's Zod-free entry
 * (`@suskii/shared/lite`), which takes a few support constants, does not carry the time-zone code.
 */

/** Days as `SUPPORT_HOURS` names them, in `Date.getUTCDay()` order. */
export const SUPPORT_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type SupportWeekday = (typeof SUPPORT_WEEKDAYS)[number];

/** Staffed on these days from `fromMinute` (inclusive) to `toMinute` (exclusive), local time. */
export interface SupportHoursSpan {
  days: SupportWeekday[];
  fromMinute: number;
  toMinute: number;
}

const HOURS_SPAN = /^([a-z]{3})(?:-([a-z]{3}))? (\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

const weekday = (name: string | undefined): number =>
  SUPPORT_WEEKDAYS.findIndex((day) => day === name);

/**
 * Staffed hours (ADR-085) from settings text: comma-separated spans of days and 24-hour times in
 * the support time zone, such as `mon-fri 08:00-20:00, sat 09:00-14:00`. A day range may wrap
 * (`fri-mon`) and `24:00` ends a day. Empty text means no staffed hours. Null when invalid.
 */
export function parseSupportHours(text: string): SupportHoursSpan[] | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return [];
  const spans: SupportHoursSpan[] = [];
  for (const part of trimmed.split(',')) {
    const match = HOURS_SPAN.exec(part.trim().replace(/\s+/g, ' '));
    if (!match) return null;
    const [, first, last, fromHour, fromMin, toHour, toMin] = match;
    const start = weekday(first);
    const end = weekday(last ?? first);
    const fromMinute = Number(fromHour) * 60 + Number(fromMin);
    const toMinute = Number(toHour) * 60 + Number(toMin);
    const minutesValid = Number(fromMin) < 60 && Number(toMin) < 60;
    if (start < 0 || end < 0 || !minutesValid || fromMinute >= toMinute || toMinute > 1440) {
      return null;
    }
    const days: SupportWeekday[] = [];
    for (let offset = 0; offset <= (end - start + 7) % 7; offset += 1) {
      const day = SUPPORT_WEEKDAYS[(start + offset) % 7];
      if (day) days.push(day);
    }
    spans.push({ days, fromMinute, toMinute });
  }
  return spans;
}

/** Whether someone is on shift at `now` under `hours` in `timeZone`. No hours: nobody is. */
export function supportStaffed(
  hours: readonly SupportHoursSpan[],
  timeZone: string,
  now: Date,
): boolean {
  const local = utcToLocal(now, timeZone);
  const day = SUPPORT_WEEKDAYS[new Date(`${local.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  const minute = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  return hours.some(
    (span) =>
      day !== undefined &&
      span.days.includes(day) &&
      minute >= span.fromMinute &&
      minute < span.toMinute,
  );
}
