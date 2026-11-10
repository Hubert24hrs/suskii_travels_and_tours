import { readStored, STORAGE_KEYS, writeStored } from '../components/search/storage';

/** A hotel search worth offering again: a city, the dates and the rooms. Nothing personal. */
export interface RecentHotelSearch {
  cityId: string;
  cityName: string;
  checkIn: string;
  checkOut: string;
  rooms: { adults: number; childAges: number[] }[];
}

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

/** The visitor's calendar date, "2026-12-01": stays that have begun are not offered again. */
export function localToday(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const same = (a: RecentHotelSearch, b: RecentHotelSearch): boolean =>
  a.cityId === b.cityId && a.checkIn === b.checkIn && a.checkOut === b.checkOut;

/**
 * The last hotel searches, newest first, kept in this browser only (ADR-097): what is read is
 * checked again, since anything can sit in local storage, and stays whose check-in has passed
 * are left out. `today` is the local calendar date.
 */
export function recentHotelSearches(today: string): RecentHotelSearch[] {
  const stored = readStored<unknown>(STORAGE_KEYS.recentHotelSearches);
  return (Array.isArray(stored) ? stored : [])
    .filter(valid)
    .filter((search) => search.checkIn >= today)
    .slice(0, KEPT);
}

/** Remembers a search that returned hotels; the same city and dates move to the front. */
export function rememberHotelSearch(search: RecentHotelSearch, today: string): void {
  if (!valid(search)) return;
  const others = recentHotelSearches(today).filter((entry) => !same(entry, search));
  writeStored(STORAGE_KEYS.recentHotelSearches, [search, ...others].slice(0, KEPT));
}

export function clearRecentHotelSearches(): void {
  writeStored(STORAGE_KEYS.recentHotelSearches, []);
}

/** The results page for a remembered search. */
export function recentHotelSearchHref(search: RecentHotelSearch): string {
  const params = new URLSearchParams({
    dest: search.cityId,
    checkin: search.checkIn,
    checkout: search.checkOut,
  });
  for (const room of search.rooms)
    params.append('room', [room.adults, ...room.childAges].join('-'));
  return `/hotels/search?${params.toString()}`;
}

/** The day after a calendar date, "2026-12-01" to "2026-12-02". */
function nextDay(date: string): string {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Tonight's deals in a city (ADR-097): one night from the visitor's own today, two adults, the
 * "Deals" collection chosen. The dates come from the browser's clock, so the link exists only
 * once the page runs there.
 */
export function lastMinuteHref(cityId: string, today: string): string {
  const params = new URLSearchParams({
    dest: cityId,
    checkin: today,
    checkout: nextDay(today),
    room: '2',
    collection: 'deals',
  });
  return `/hotels/search?${params.toString()}`;
}
