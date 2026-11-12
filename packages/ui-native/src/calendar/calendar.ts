/** Date helpers for the native calendar. All dates are local calendar days at midnight. */

export interface DateRange {
  from: Date | undefined;
  to?: Date | undefined;
}

export type DayPosition = 'none' | 'single' | 'start' | 'middle' | 'end';

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isBeforeDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime();
}

/** First day of the month `offset` months after `date`'s month. */
export function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

/**
 * Weeks of a month as rows of seven cells; `null` pads days outside the month.
 * `weekStartsOn`: 0 = Sunday ... 6 = Saturday.
 */
export function buildMonthGrid(year: number, month: number, weekStartsOn = 1): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: (Date | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/**
 * Next selection after tapping `day`. Range mode: the first tap starts a range, the second ends
 * it; tapping before the start, or after a complete range, starts over.
 */
export function selectDay(range: DateRange, day: Date, mode: 'range' | 'single'): DateRange {
  const picked = startOfDay(day);
  if (mode === 'single' || !range.from || range.to || isBeforeDay(picked, range.from)) {
    return { from: picked, to: undefined };
  }
  return { from: range.from, to: picked };
}

export function dayPosition(day: Date, range: DateRange): DayPosition {
  const { from, to } = range;
  if (!from) return 'none';
  if (!to || isSameDay(from, to)) return isSameDay(day, from) ? 'single' : 'none';
  if (isSameDay(day, from)) return 'start';
  if (isSameDay(day, to)) return 'end';
  return isBeforeDay(from, day) && isBeforeDay(day, to) ? 'middle' : 'none';
}

/** Weekday names in display order, e.g. ["Mon", ..., "Sun"]. */
export function weekdayLabels(
  locale: string,
  weekStartsOn = 1,
  style: 'short' | 'long' = 'short',
): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: style });
  // 4 Jan 1970 was a Sunday.
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(1970, 0, 4 + ((weekStartsOn + index) % 7))),
  );
}
