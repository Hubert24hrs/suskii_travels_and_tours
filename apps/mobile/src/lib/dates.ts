import { addDays } from '@suskii/shared';

const pad = (value: number): string => String(value).padStart(2, '0');

/** A calendar day in the device's time zone as YYYY-MM-DD. */
export const toIso = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** YYYY-MM-DD to a local midnight Date (for the calendar), or undefined. */
export function fromIso(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export const todayIso = (): string => toIso(new Date());

export const daysFromToday = (days: number): string => addDays(todayIso(), days);
