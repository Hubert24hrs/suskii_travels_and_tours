import type { GeoPoint } from '@suskii/shared';

import { SeededRandom } from '../suppliers/mock/random';

/** What a traveller can ask to find around a point (ADR-122). */
export const PLACE_KINDS = ['restaurants', 'attractions', 'shopping'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_PRICE_LEVELS = [
  'free',
  'inexpensive',
  'moderate',
  'expensive',
  'very_expensive',
] as const;
export type PlacePriceLevel = (typeof PLACE_PRICE_LEVELS)[number];

/** How far around a point each kind is looked for: a walk for food, a short ride for the rest. */
export const PLACE_RADIUS_METRES: Record<PlaceKind, number> = {
  restaurants: 1500,
  attractions: 5000,
  shopping: 3000,
};

/** One place as a provider describes it. Every part but the name and the point may be unknown. */
export interface PlaceResult {
  /** The provider's own id (Google's place id): kept to tell places apart, never shown. */
  providerId: string;
  name: string;
  address: string | null;
  point: GeoPoint;
  /** The provider's word for what it is ("museum"), as a lower-case code. */
  type: string | null;
  /** The provider's average rating out of 5, and how many ratings it is made of. */
  rating: number | null;
  ratingCount: number | null;
  priceLevel: PlacePriceLevel | null;
}

export interface NearbyPlacesQuery {
  center: GeoPoint;
  kind: PlaceKind;
  radiusMetres: number;
  limit: number;
  /** The language names come back in, when the provider has them ("en", "fr"). */
  language: string;
}

export interface FindPlacesQuery {
  /** A landmark, a district or an address of a public place, already scrubbed. */
  text: string;
  /** Prefer places around here (a hotel, an airport, a city), when known. */
  near: GeoPoint | null;
  limit: number;
  language: string;
}

/** The provider could not answer. The code names the reason; it never holds what was asked. */
export class PlacesError extends Error {
  constructor(
    readonly provider: string,
    readonly code: string,
  ) {
    super(`Places failed: ${provider} ${code}`);
    this.name = 'PlacesError';
  }
}

/**
 * Places around a point or found by name (ADR-122). Adapters keep the vendor's payloads to
 * themselves, honour the `AbortSignal`, never retry and send only what a query holds: a point,
 * a kind, a radius, a language, or the scrubbed name of a public place. Never a traveller.
 */
export abstract class PlacesProvider {
  abstract readonly name: 'mock' | 'google';
  abstract nearby(query: NearbyPlacesQuery, signal: AbortSignal): Promise<PlaceResult[]>;
  abstract find(query: FindPlacesQuery, signal: AbortSignal): Promise<PlaceResult[]>;
}

/** Where the mock puts a place it finds by name when it is told nothing nearer: Lagos. */
const MOCK_DEFAULT_POINT: GeoPoint = { lat: 6.4541, lng: 3.3947 };

const MOCK_TYPES: Record<PlaceKind, readonly string[]> = {
  restaurants: ['restaurant'],
  attractions: ['museum', 'park', 'art_gallery'],
  shopping: ['shopping_mall'],
};

const MOCK_NAMES: Record<PlaceKind, string> = {
  restaurants: 'Sample restaurant',
  attractions: 'Sample attraction',
  shopping: 'Sample shopping centre',
};

/** A point `metres` from `center` towards `angle` (radians), on a flat earth: fine for a mock. */
function offset(center: GeoPoint, metres: number, angle: number): GeoPoint {
  const lat = center.lat + (metres / 111_320) * Math.cos(angle);
  const lng =
    center.lng + (metres / (111_320 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle);
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

/**
 * Development and test places (refused in production unless ALLOW_MOCK_PROVIDERS). Every place
 * is named "Sample ..." and every answer the tools build from it is marked `sample`, so nobody
 * mistakes it for a real one. The same question always gives the same places.
 */
export class MockPlacesProvider extends PlacesProvider {
  readonly name = 'mock';
  /** Test hooks: the next calls fail; what was asked, to check nothing personal was sent. */
  failNext = 0;
  readonly asked: (NearbyPlacesQuery | FindPlacesQuery)[] = [];

  nearby(query: NearbyPlacesQuery): Promise<PlaceResult[]> {
    this.asked.push(query);
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new PlacesError(this.name, 'unavailable'));
    }
    const seed = `${query.kind}:${query.center.lat.toFixed(3)},${query.center.lng.toFixed(3)}`;
    const random = new SeededRandom(seed);
    const places = Array.from({ length: Math.min(query.limit, 6) }, (_, index) => {
      const metres = Math.round(random.between(0.1, 0.95) * query.radiusMetres);
      return {
        providerId: `mock-${query.kind}-${index + 1}-${seed}`,
        name: `${MOCK_NAMES[query.kind]} ${index + 1}`,
        address: null,
        point: offset(query.center, metres, random.between(0, 2 * Math.PI)),
        type: random.pick(MOCK_TYPES[query.kind]),
        rating: Math.round(random.between(3.6, 4.9) * 10) / 10,
        ratingCount: random.int(12, 2400),
        priceLevel:
          query.kind === 'restaurants' ? random.pick(PLACE_PRICE_LEVELS.slice(1, 4)) : null,
      };
    });
    return Promise.resolve(places);
  }

  find(query: FindPlacesQuery): Promise<PlaceResult[]> {
    this.asked.push(query);
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new PlacesError(this.name, 'unavailable'));
    }
    const random = new SeededRandom(`find:${query.text.toLowerCase()}`);
    const center = query.near ?? MOCK_DEFAULT_POINT;
    return Promise.resolve([
      {
        providerId: `mock-find-${query.text.toLowerCase()}`,
        name: `${query.text} (sample)`,
        address: null,
        point: offset(center, random.int(800, 6000), random.between(0, 2 * Math.PI)),
        type: 'point_of_interest',
        rating: null,
        ratingCount: null,
        priceLevel: null,
      },
    ]);
  }
}
