import { addDays, addMonths } from '@suskii/shared';

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

/** The first and last days a date picker offers (YYYY-MM-DD). */
export interface DateBounds {
  min: string;
  max: string;
}

/** How far back a date of birth goes, in years. */
const BIRTH_YEARS = 120;

/**
 * How far ahead each document's expiry date can be, in years: a passport runs ten years at most
 * (twenty leaves room), a driving licence can run to its holder's seventieth birthday, insurance
 * a year or a few.
 */
export const EXPIRY_YEARS = { passport: 20, licence: 50, insurance: 10 } as const;

/** A date of birth: from 120 years back to today. */
export const birthDates = (today: string = todayIso()): DateBounds => ({
  min: addMonths(today, -12 * BIRTH_YEARS),
  max: today,
});

/** An expiry date: from today (an expired document cannot be used) to `years` ahead. */
export const expiryDates = (years: number, today: string = todayIso()): DateBounds => ({
  min: today,
  max: addMonths(today, 12 * years),
});
