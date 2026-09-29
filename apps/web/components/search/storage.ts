/**
 * Browser storage that never throws (private mode, blocked storage). Only non-sensitive search
 * preferences are kept: places, dates and traveller counts, never names or references.
 */
export function readStored<T>(key: string, storage: 'local' | 'session' = 'local'): T | null {
  try {
    const raw = (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeStored(
  key: string,
  value: unknown,
  storage: 'local' | 'session' = 'local',
): void {
  try {
    (storage === 'local' ? window.localStorage : window.sessionStorage).setItem(
      key,
      JSON.stringify(value),
    );
  } catch {
    // Storage full or disabled: persistence is a convenience only.
  }
}

export const STORAGE_KEYS = {
  lastFlightSearch: 'suskii:search:flights:v1',
  recentPlaces: 'suskii:search:recent-places:v1',
  addonsLastName: 'suskii:addons:last-name',
} as const;
