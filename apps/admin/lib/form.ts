import { money, parseMoney, toDecimalString } from '@suskii/shared';

import { problemOf } from './api';
import { label, t } from './i18n';

/** Minor units from a decimal input ("2500.50" NGN -> 250050); null when empty, NaN when invalid. */
export function minorFromInput(value: string, currency: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseMoney(trimmed, currency);
    return parsed.minor < 0n ? Number.NaN : Number(parsed.minor);
  } catch {
    return Number.NaN;
  }
}

/** The decimal input for a stored minor amount ("" when null). */
export const inputFromMinor = (minor: number | null, currency: string | null): string =>
  minor === null ? '' : toDecimalString(money(minor, currency ?? 'NGN'));

/** Basis points from a percentage input ("2.5" -> 250); NaN when invalid. */
export function bpsFromPercent(value: string): number {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export const percentFromBps = (bps: number): string =>
  `${Math.floor(bps / 100)}${
    bps % 100
      ? `.${String(bps % 100)
          .padStart(2, '0')
          .replace(/0$/, '')}`
      : ''
  }`;

const pad = (value: number): string => String(value).padStart(2, '0');

/** A `datetime-local` value (the staff member's own time zone) for an ISO instant. */
export function localInputFromIso(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The ISO instant for a `datetime-local` value, or null when empty. */
export const isoFromLocalInput = (value: string): string | null =>
  value ? new Date(value).toISOString() : null;

/** Empty text becomes null (optional API fields are nullable, not empty strings). */
export const nullable = (value: string): string | null => (value.trim() ? value.trim() : null);

/** API field issues by top-level field, in words staff understand. */
export function fieldIssues(error: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of problemOf(error).issues) {
    const field = issue.path.split('.').find((part) => part !== 'content') ?? issue.path;
    const text = label('validation', issue.message);
    result[field] ??= text === issue.message ? t('validation.invalid') : text;
  }
  return result;
}
