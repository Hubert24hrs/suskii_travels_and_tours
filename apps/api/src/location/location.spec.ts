import type { Redis } from 'ioredis';

import type { GeoPoint } from '@suskii/shared';

import type { AppConfig } from '../config/config';
import { parseEnv } from '../config/env.schema';
import {
  MapsProvider,
  MockMapsProvider,
  RoutingFailedError,
  type RouteLeg,
  type RouteResult,
} from '../ground/maps';

import { GooglePlacesProvider } from './google-places';
import { LocationService } from './location.service';
import { placesProviderFor } from './location.module';
import {
  MockPlacesProvider,
  PlacesError,
  PlacesProvider,
  type FindPlacesQuery,
  type NearbyPlacesQuery,
  type PlaceResult,
} from './places';

const config = (extra: Record<string, string> = {}): AppConfig =>
  parseEnv({
    DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
    REDIS_URL: 'redis://localhost:6379',
    ...extra,
  });

/** Enough of ioredis for the daily caps: `multi().incrby().expire().exec()`. */
function capRedis(broken = false): Redis & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const multi = () => {
    const steps: (() => [null, number])[] = [];
    const chain = {
      incrby: (key: string, amount: number) => {
        steps.push(() => {
          const value = (counts.get(key) ?? 0) + amount;
          counts.set(key, value);
          return [null, value];
        });
        return chain;
      },
      expire: () => {
        steps.push(() => [null, 1]);
        return chain;
      },
      exec: () =>
        broken ? Promise.reject(new Error('down')) : Promise.resolve(steps.map((step) => step())),
    };
    return chain;
  };
  return Object.assign({ multi }, { counts }) as unknown as Redis & { counts: Map<string, number> };
}

const LAGOS: GeoPoint = { lat: 6.4281, lng: 3.4219 };
const LOS: GeoPoint = { lat: 6.5774, lng: 3.3212 };
const signal = () => new AbortController().signal;

/** A places provider that says it is Google's, so the caps apply, and counts its calls. */
class CountingGooglePlaces extends PlacesProvider {
  readonly name = 'google';
  calls = 0;
  fail = false;

  nearby(_query: NearbyPlacesQuery): Promise<PlaceResult[]> {
    return this.answer();
  }

  find(_query: FindPlacesQuery): Promise<PlaceResult[]> {
    return this.answer();
  }

  private answer(): Promise<PlaceResult[]> {
    this.calls += 1;
    if (this.fail) return Promise.reject(new PlacesError('google', 'status_503'));
    return Promise.resolve([
      {
        providerId: 'ChIJ-test',
        name: 'Nike Art Gallery',
        address: 'Lekki, Lagos',
        point: { lat: 6.4457, lng: 3.4801 },
        type: 'art_gallery',
        rating: 4.7,
        ratingCount: 3120,
        priceLevel: null,
      },
    ]);
  }
}

/** A router that says it is Google's, answers every pair but the ones it is told to miss. */
class CountingGoogleRoutes extends MapsProvider {
  readonly name = 'google';
  calls = 0;
  fail = false;
  noRoute = new Set<number>();

  route(): Promise<RouteResult> {
    return Promise.reject(new RoutingFailedError('not used'));
  }

  override matrix(
    origins: readonly GeoPoint[],
    destinations: readonly GeoPoint[],
  ): Promise<(RouteLeg | null)[][]> {
    this.calls += 1;
    if (this.fail) return Promise.reject(new RoutingFailedError('status 503'));
    return Promise.resolve(
      origins.map((_, o) =>
        destinations.map(() =>
          this.noRoute.has(o) ? null : { distanceMetres: 21_400 + o, durationSeconds: 2400 },
        ),
      ),
    );
  }
}

describe('LocationService (ADR-122)', () => {
  it('says places are off when no provider is chosen, and asks nothing', async () => {
    const service = new LocationService(config(), capRedis(), null, new MockMapsProvider());
    expect(service.placesProvider).toBeNull();
    expect(await service.nearby(LAGOS, 'restaurants', 5, 'en-NG', signal())).toEqual({
      ok: false,
      problem: 'places_off',
    });
    expect(await service.find('Eko Atlantic', null, 3, 'en-NG', signal())).toEqual({
      ok: false,
      problem: 'places_off',
    });
  });

  it('finds sample places with the mock, within the radius of their kind', async () => {
    const mock = new MockPlacesProvider();
    const service = new LocationService(config(), capRedis(), mock, new MockMapsProvider());
    const answer = await service.nearby(LAGOS, 'restaurants', 4, 'en-NG', signal());
    expect(answer.ok && answer.provider).toBe('mock');
    if (!answer.ok) throw new Error('expected places');
    expect(answer.places).toHaveLength(4);
    for (const place of answer.places) expect(place.name).toMatch(/^Sample restaurant \d$/);
    // The same question gives the same places.
    const again = await service.nearby(LAGOS, 'restaurants', 4, 'en-NG', signal());
    expect(again).toEqual(answer);
    expect(mock.asked[0]).toMatchObject({ kind: 'restaurants', radiusMetres: 1500 });
  });

  it('sends a name scrubbed of contact details, and nothing when nothing is left', async () => {
    const mock = new MockPlacesProvider();
    const service = new LocationService(config(), capRedis(), mock, new MockMapsProvider());
    await service.find(
      'Eko Atlantic, ring me on +234 803 123 4567 or ada@example.com',
      LOS,
      3,
      'en-NG',
      signal(),
    );
    const asked = mock.asked[0] as FindPlacesQuery;
    expect(asked.text).not.toMatch(/\d|@|removed/);
    expect(asked.text).toContain('Eko Atlantic');
    expect(asked.near).toEqual(LOS);

    expect(await service.find('+234 803 123 4567', null, 3, 'en-NG', signal())).toEqual({
      ok: false,
      problem: 'query_empty',
    });
    expect(mock.asked).toHaveLength(1);
  });

  it("stops asking Google's places at the day's cap, and when Redis cannot count", async () => {
    const google = new CountingGooglePlaces();
    const redis = capRedis();
    const service = new LocationService(
      config({ GOOGLE_PLACES_DAILY_CALLS: '2' }),
      redis,
      google,
      new MockMapsProvider(),
    );
    expect((await service.nearby(LAGOS, 'attractions', 3, 'en', signal())).ok).toBe(true);
    expect((await service.find('Lekki', null, 3, 'en', signal())).ok).toBe(true);
    expect(await service.nearby(LAGOS, 'attractions', 3, 'en', signal())).toEqual({
      ok: false,
      problem: 'places_limit',
    });
    expect(google.calls).toBe(2);

    const blind = new LocationService(config(), capRedis(true), google, new MockMapsProvider());
    expect(await blind.nearby(LAGOS, 'shopping', 3, 'en', signal())).toEqual({
      ok: false,
      problem: 'places_limit',
    });
    expect(google.calls).toBe(2);

    const stopped = new LocationService(
      config({ GOOGLE_PLACES_DAILY_CALLS: '0' }),
      capRedis(),
      google,
      new MockMapsProvider(),
    );
    expect((await stopped.nearby(LAGOS, 'shopping', 3, 'en', signal())).ok).toBe(false);
    expect(google.calls).toBe(2);
  });

  it('answers unavailable when the provider fails, then stops calling it for a while', async () => {
    const google = new CountingGooglePlaces();
    google.fail = true;
    const service = new LocationService(config(), capRedis(), google, new MockMapsProvider());
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await service.nearby(LAGOS, 'restaurants', 3, 'en', signal())).toEqual({
        ok: false,
        problem: 'places_unavailable',
      });
    }
    // Five failures in a row open the breaker: the sixth question costs nothing.
    expect(await service.nearby(LAGOS, 'restaurants', 3, 'en', signal())).toEqual({
      ok: false,
      problem: 'places_unavailable',
    });
    expect(google.calls).toBe(5);
  });

  it('never asks about the 0,0 of a missing position', async () => {
    const google = new CountingGooglePlaces();
    const service = new LocationService(config(), capRedis(), google, new MockMapsProvider());
    expect((await service.nearby({ lat: 0, lng: 0 }, 'restaurants', 3, 'en', signal())).ok).toBe(
      false,
    );
    expect(google.calls).toBe(0);
  });

  it('routes with the mock where mocks are allowed, and marks the figures sample', async () => {
    const service = new LocationService(config(), capRedis(), null, new MockMapsProvider());
    const measured = await service.measure([LAGOS], [LOS], signal());
    expect(measured.sample).toBe(true);
    expect(measured.legs[0]?.[0]).toMatchObject({ basis: 'routed' });
    expect(measured.legs[0]?.[0]?.durationSeconds).toBeGreaterThan(0);
  });

  it('never presents the mock as a road in production: a straight line, with no time', async () => {
    const production = { ...config(), NODE_ENV: 'production' } as AppConfig;
    const service = new LocationService(production, capRedis(), null, new MockMapsProvider());
    const measured = await service.measure([LAGOS], [LOS], signal());
    expect(measured.sample).toBe(false);
    expect(measured.legs[0]?.[0]).toMatchObject({ basis: 'straight_line', durationSeconds: null });
    // About 20 km from Victoria Island to the airport, as the crow flies.
    expect(measured.legs[0]?.[0]?.distanceMetres).toBeGreaterThan(19_000);
    expect(measured.legs[0]?.[0]?.distanceMetres).toBeLessThan(21_000);
  });

  it("counts Google's route elements against the day's cap, and falls back to the line", async () => {
    const google = new CountingGoogleRoutes();
    const service = new LocationService(
      config({ GOOGLE_ROUTES_DAILY_ELEMENTS: '3' }),
      capRedis(),
      null,
      google,
    );
    const first = await service.measure([LAGOS, LOS], [LOS], signal());
    expect(first.legs.map((row) => row[0]?.basis)).toEqual(['routed', 'routed']);
    expect(first.sample).toBe(false);
    // Two more elements would make four: over the cap, so nothing is asked.
    const second = await service.measure([LAGOS, LOS], [LOS], signal());
    expect(second.legs.map((row) => row[0]?.basis)).toEqual(['straight_line', 'straight_line']);
    expect(google.calls).toBe(1);
  });

  it('measures a pair with no road in a straight line, and every pair when routing fails', async () => {
    const google = new CountingGoogleRoutes();
    google.noRoute.add(1);
    const service = new LocationService(config(), capRedis(), null, google);
    const partly = await service.measure([LAGOS, LOS], [LOS], signal());
    expect(partly.legs.map((row) => row[0]?.basis)).toEqual(['routed', 'straight_line']);
    expect(partly.legs[0]?.[0]?.durationSeconds).toBe(2400);
    expect(partly.legs[1]?.[0]?.durationSeconds).toBeNull();

    google.fail = true;
    const failed = await service.measure([LAGOS], [LOS], signal());
    expect(failed.legs[0]?.[0]?.basis).toBe('straight_line');
  });
});

describe('placesProviderFor (ADR-122)', () => {
  it('chooses none, the mock or Google from the settings', () => {
    expect(placesProviderFor(config())).toBeNull();
    expect(placesProviderFor(config({ PLACES_PROVIDER: 'mock' }))).toBeInstanceOf(
      MockPlacesProvider,
    );
    expect(
      placesProviderFor(
        config({ PLACES_PROVIDER: 'google', GOOGLE_MAPS_SERVER_KEY: 'test-server-key-0123456789' }),
      ),
    ).toBeInstanceOf(GooglePlacesProvider);
  });
});

describe('MapsProvider.matrix (ADR-122)', () => {
  it('asks route() for every pair, leaving out a pair without a road', async () => {
    const mock = new MockMapsProvider();
    const legs = await mock.matrix([LAGOS, LOS], [LOS, LAGOS], signal());
    expect(legs).toHaveLength(2);
    expect(legs[0]).toHaveLength(2);
    expect(legs[0]?.[0]?.distanceMetres).toBeGreaterThan(0);

    mock.failNext = 1;
    const partly = await mock.matrix([LAGOS], [LOS, LAGOS], signal());
    expect(partly[0]?.filter((leg) => leg === null)).toHaveLength(1);

    mock.failNext = 2;
    await expect(mock.matrix([LAGOS], [LOS, LAGOS], signal())).rejects.toThrow(RoutingFailedError);
  });
});
