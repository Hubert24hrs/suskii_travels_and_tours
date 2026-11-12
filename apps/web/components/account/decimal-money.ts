import { currencyExponent } from '@suskii/shared/lite';

/** "150000.50" in the currency's minor units, without floating point; null when not a price. */
export function decimalToMinor(text: string, currency: string): number | null {
  const exponent = currencyExponent(currency);
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(text.trim().replace(/,/g, ''));
  if (!match?.[1] || (match[2] ?? '').length > exponent) return null;
  const minor = Number(`${match[1]}${(match[2] ?? '').padEnd(exponent, '0')}`);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export const minorToDecimal = (minor: number, currency: string): string => {
  const exponent = currencyExponent(currency);
  if (exponent === 0) return String(minor);
  const text = String(minor).padStart(exponent + 1, '0');
  return `${text.slice(0, -exponent)}.${text.slice(-exponent)}`;
};
