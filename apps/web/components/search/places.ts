/** An airport option in the flight form. */
export interface PlaceOption {
  code: string;
  name: string;
  city: string;
  countryCode: string;
}

const fold = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

let popular: Promise<PlaceOption[]> | null = null;

/**
 * The edge-cached popular airport index (spec performance tactic), loaded once when a visitor
 * first focuses an airport field; the API covers the long tail.
 */
export function loadPopularPlaces(apiBaseUrl: string): Promise<PlaceOption[]> {
  popular ??= fetch(`${apiBaseUrl}/v1/catalog/places/popular`)
    .then((response) =>
      response.ok
        ? (response.json() as Promise<{ airports: [string, string, string, string][] }>)
        : { airports: [] },
    )
    .then(({ airports }) =>
      airports.map(([code, name, city, countryCode]) => ({ code, name, city, countryCode })),
    )
    .catch(() => {
      popular = null;
      return [];
    });
  return popular;
}

/** Ranks the local index: exact code, then city and airport-name prefixes, then word matches. */
export function searchPlaces(
  places: readonly PlaceOption[],
  query: string,
  limit = 8,
): PlaceOption[] {
  const needle = fold(query.trim());
  if (needle.length === 0) return [];
  const scored: { place: PlaceOption; score: number }[] = [];
  for (const place of places) {
    const code = place.code.toLowerCase();
    const city = fold(place.city);
    const name = fold(place.name);
    let score = 0;
    if (code === needle) score = 100;
    else if (city.startsWith(needle)) score = 60;
    else if (name.startsWith(needle)) score = 50;
    else if (code.startsWith(needle)) score = 45;
    else if (` ${city} ${name}`.includes(` ${needle}`)) score = 30;
    else if (needle.length >= 3 && (city.includes(needle) || name.includes(needle))) score = 10;
    if (score > 0) scored.push({ place, score: score + (place.countryCode === 'NG' ? 2 : 0) });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.place.city.localeCompare(b.place.city))
    .slice(0, limit)
    .map((entry) => entry.place);
}

interface ApiPlace {
  type: 'airport' | 'city';
  code?: string;
  name: string;
  cityName?: string | null;
  countryCode: string;
  airports?: { code: string; name: string }[];
}

/** Long-tail lookup through the API; cities expand to the airports serving them. */
export async function remotePlaces(
  apiBaseUrl: string,
  query: string,
  signal: AbortSignal,
): Promise<PlaceOption[]> {
  const url = `${apiBaseUrl}/v1/catalog/places?q=${encodeURIComponent(query)}&limit=8`;
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const { items } = (await response.json()) as { items: ApiPlace[] };
  return items.flatMap((item): PlaceOption[] =>
    item.type === 'city'
      ? (item.airports ?? []).map((airport) => ({
          code: airport.code,
          name: airport.name,
          city: item.name,
          countryCode: item.countryCode,
        }))
      : [
          {
            code: item.code ?? '',
            name: item.name,
            city: item.cityName ?? item.name,
            countryCode: item.countryCode,
          },
        ],
  );
}

export function mergePlaces(...lists: readonly PlaceOption[][]): PlaceOption[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((place) => (seen.has(place.code) ? false : (seen.add(place.code), true)));
}
