import type { SearchParams } from './search-initial';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export interface BusQuery {
  from: string;
  to: string;
  date: string;
  seats: number;
}

/** A bus search from the URL (`?from=&to=&date=&seats=`), or null until it is complete. */
export function busQuery(params: SearchParams): BusQuery | null {
  const from = one(params.from)?.trim() ?? '';
  const to = one(params.to)?.trim() ?? '';
  const date = one(params.date) ?? '';
  const seats = Number(one(params.seats) ?? '1');
  if (from.length < 2 || to.length < 2 || from.length > 80 || to.length > 80) return null;
  if (!DAY.test(date) || !Number.isInteger(seats) || seats < 1 || seats > 6) return null;
  return { from, to, date, seats };
}

export interface RentalQuery {
  city: string;
  pickupAt: string;
  returnAt: string;
  category: string | undefined;
  chauffeur: boolean;
}

/** A rental search from the URL, or null until the period is complete and in order. */
export function rentalQuery(params: SearchParams): RentalQuery | null {
  const cityInput = one(params.city)?.trim();
  // An empty field (the form always sends it) means the default city.
  const city = cityInput !== undefined && cityInput.length > 0 ? cityInput : 'Lagos';
  const pickupAt = one(params.pickupAt) ?? '';
  const returnAt = one(params.returnAt) ?? '';
  const categoryInput = one(params.category);
  const category =
    categoryInput !== undefined && categoryInput.length > 0 ? categoryInput : undefined;
  if (!LOCAL.test(pickupAt) || !LOCAL.test(returnAt) || returnAt <= pickupAt) return null;
  return { city, pickupAt, returnAt, category, chauffeur: one(params.chauffeur) === 'true' };
}

/** `HH:mm` of a local wall time (`YYYY-MM-DDTHH:mm`). */
export const wallTime = (local: string): string => local.slice(11, 16);

/** A readable label for an amenity code, from the catalog when it has one. */
export function amenityLabel(labels: Readonly<Record<string, string>>, code: string): string {
  return labels[code] ?? code.replaceAll('_', ' ');
}
