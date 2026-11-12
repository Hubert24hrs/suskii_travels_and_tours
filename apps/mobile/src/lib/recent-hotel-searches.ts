import { preferences } from './cache';

/** A hotel search worth offering again: a city, the dates and the rooms. Nothing personal. */
export interface RecentHotelSearch {
  cityId: string;
  cityName: string;
  checkIn: string;
  checkOut: string;
  rooms: { adults: number; childAges: number[] }[];
}

const KEY = 'search.hotels.recent';
const KEPT = 3;
const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const valid = (entry: unknown): entry is RecentHotelSearch => {
  if (typeof entry !== 'object' || entry === null) return false;
  const search = entry as Partial<RecentHotelSearch>;
  return (
    typeof search.cityId === 'string' &&
    UUID.test(search.cityId) &&
    typeof search.cityName === 'string' &&
    search.cityName.length > 0 &&
    search.cityName.length <= 80 &&
    typeof search.checkIn === 'string' &&
    DATE.test(search.checkIn) &&
    typeof search.checkOut === 'string' &&
    DATE.test(search.checkOut) &&
    Array.isArray(search.rooms) &&
    search.rooms.length > 0 &&
    search.rooms.length <= 8 &&
    search.rooms.every(
      (room) =>
        Number.isInteger(room.adults) &&
        Array.isArray(room.childAges) &&
        room.childAges.every((age) => Number.isInteger(age)),
    )
  );
};

/** The device's calendar date, "2026-12-01": stays that have begun are not offered again. */
export function localToday(now = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The last hotel searches on this device (ADR-097), newest first: a city, dates and room
 * counts in the app's settings store, never sent anywhere. What is read is checked again.
 */
export const recentHotelSearches = {
  list(today = localToday()): RecentHotelSearch[] {
    let stored: unknown;
    try {
      stored = JSON.parse(preferences.getString(KEY) ?? '[]');
    } catch {
      return [];
    }
    return (Array.isArray(stored) ? stored : [])
      .filter(valid)
      .filter((search) => search.checkIn >= today)
      .slice(0, KEPT);
  },
  /** Remembers a search that returned hotels; the same city and dates move to the front. */
  remember(search: RecentHotelSearch, today = localToday()): void {
    if (!valid(search)) return;
    const others = this.list(today).filter(
      (entry) =>
        !(
          entry.cityId === search.cityId &&
          entry.checkIn === search.checkIn &&
          entry.checkOut === search.checkOut
        ),
    );
    preferences.set(KEY, JSON.stringify([search, ...others].slice(0, KEPT)));
  },
  clear(): void {
    preferences.remove(KEY);
  },
};
