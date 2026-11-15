import {
  PlacesError,
  PlacesProvider,
  type FindPlacesQuery,
  type NearbyPlacesQuery,
  type PlaceKind,
  type PlacePriceLevel,
  type PlaceResult,
} from './places';

/** One place in a Places API (New) answer: only the fields the field mask asks for. */
interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  shortFormattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
}

interface GooglePlacesResponse {
  places?: GooglePlace[];
}

/**
 * The fields we ask for, which are also what Google bills by: the name, a short address, the
 * point, the kind of place, the rating and its count, and the price level. No photos, reviews,
 * opening hours, phone numbers or websites.
 */
export const GOOGLE_PLACE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.shortFormattedAddress',
  'places.location',
  'places.primaryType',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
].join(',');

/** Google's place types for each kind (Table A of the Places API, New). */
export const GOOGLE_PLACE_TYPES: Record<PlaceKind, readonly string[]> = {
  restaurants: ['restaurant'],
  attractions: [
    'tourist_attraction',
    'museum',
    'art_gallery',
    'park',
    'amusement_park',
    'zoo',
    'aquarium',
  ],
  shopping: ['shopping_mall', 'department_store'],
};

const PRICE_LEVELS: Record<string, PlacePriceLevel> = {
  PRICE_LEVEL_FREE: 'free',
  PRICE_LEVEL_INEXPENSIVE: 'inexpensive',
  PRICE_LEVEL_MODERATE: 'moderate',
  PRICE_LEVEL_EXPENSIVE: 'expensive',
  PRICE_LEVEL_VERY_EXPENSIVE: 'very_expensive',
};

/** How far around a "near" point a search by name prefers its answers. */
const FIND_BIAS_METRES = 30_000;
const PLACE_TYPE = /^[a-z][a-z0-9_]{1,47}$/;

const language = (locale: string): string => locale.split('-')[0]?.toLowerCase() ?? 'en';

/** A place as our tools read it, or null when Google left out the name or the point. */
export function placeFromGoogle(place: GooglePlace): PlaceResult | null {
  const name = place.displayName?.text?.trim();
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!place.id || !name || typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    providerId: place.id,
    name,
    address: place.shortFormattedAddress?.trim() ? place.shortFormattedAddress.trim() : null,
    point: { lat, lng },
    type: place.primaryType && PLACE_TYPE.test(place.primaryType) ? place.primaryType : null,
    rating:
      typeof place.rating === 'number' && place.rating >= 0 && place.rating <= 5
        ? Math.round(place.rating * 10) / 10
        : null,
    ratingCount:
      typeof place.userRatingCount === 'number' && place.userRatingCount >= 0
        ? Math.round(place.userRatingCount)
        : null,
    priceLevel: place.priceLevel ? (PRICE_LEVELS[place.priceLevel] ?? null) : null,
  };
}

/**
 * Google's Places API, New (ADR-122): Nearby Search for what is around a point, Text Search
 * for a place found by name. The key goes in a header, never in the URL; the field mask keeps
 * the answer, and the bill, to the fields above. What is sent is a point, a radius, place
 * types and a language, or the scrubbed name of a public place with a point to prefer.
 */
export class GooglePlacesProvider extends PlacesProvider {
  readonly name = 'google';

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
      /** Tests pass their own; the platform's otherwise. */
      fetch?: typeof fetch;
    },
  ) {
    super();
  }

  async nearby(query: NearbyPlacesQuery, signal: AbortSignal): Promise<PlaceResult[]> {
    const body = await this.post(
      'places:searchNearby',
      {
        includedTypes: GOOGLE_PLACE_TYPES[query.kind],
        maxResultCount: Math.min(Math.max(query.limit, 1), 20),
        rankPreference: 'POPULARITY',
        languageCode: language(query.language),
        locationRestriction: {
          circle: {
            center: { latitude: query.center.lat, longitude: query.center.lng },
            radius: query.radiusMetres,
          },
        },
      },
      signal,
    );
    return this.places(body, query.limit);
  }

  async find(query: FindPlacesQuery, signal: AbortSignal): Promise<PlaceResult[]> {
    const body = await this.post(
      'places:searchText',
      {
        textQuery: query.text,
        pageSize: Math.min(Math.max(query.limit, 1), 20),
        languageCode: language(query.language),
        ...(query.near
          ? {
              locationBias: {
                circle: {
                  center: { latitude: query.near.lat, longitude: query.near.lng },
                  radius: FIND_BIAS_METRES,
                },
              },
            }
          : {}),
      },
      signal,
    );
    return this.places(body, query.limit);
  }

  private places(body: GooglePlacesResponse, limit: number): PlaceResult[] {
    if (body.places !== undefined && !Array.isArray(body.places)) {
      throw new PlacesError(this.name, 'unreadable_answer');
    }
    return (body.places ?? [])
      .map(placeFromGoogle)
      .filter((place): place is PlaceResult => place !== null)
      .slice(0, limit);
  }

  private async post(
    path: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<GooglePlacesResponse> {
    const base = this.options.baseUrl.endsWith('/')
      ? this.options.baseUrl
      : `${this.options.baseUrl}/`;
    let response: Response;
    try {
      // `./` keeps "places:searchText" a path: on its own, `places:` reads as a URL scheme.
      response = await (this.options.fetch ?? fetch)(new URL(`./${path}`, base), {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-goog-api-key': this.options.apiKey,
          'x-goog-fieldmask': GOOGLE_PLACE_FIELDS,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]),
      });
    } catch (error) {
      throw new PlacesError(
        this.name,
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'timeout'
          : 'request_failed',
      );
    }
    if (!response.ok) {
      // The status names the reason (403: the key's restrictions, 429: quota); the body can
      // echo what was asked, so it is never read into a log.
      await response.body?.cancel();
      throw new PlacesError(this.name, `status_${response.status}`);
    }
    try {
      return (await response.json()) as GooglePlacesResponse;
    } catch {
      throw new PlacesError(this.name, 'unreadable_answer');
    }
  }
}
