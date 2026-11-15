import { GoogleRoutesMapsProvider, googleSeconds } from '../ground/google-routes';
import { RoutingFailedError } from '../ground/maps';

import { GOOGLE_PLACE_FIELDS, GooglePlacesProvider, placeFromGoogle } from './google-places';
import { PlacesError } from './places';

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const KEY = 'test-server-key-0123456789';

/** A fetch that records each request and answers with `status` and `body`. */
function fake(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return ((url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<
        string,
        unknown
      >,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
}

const places = (fetchImpl: typeof fetch) =>
  new GooglePlacesProvider({
    baseUrl: 'https://places.googleapis.com/v1',
    apiKey: KEY,
    timeoutMs: 3000,
    fetch: fetchImpl,
  });

const routes = (fetchImpl: typeof fetch) =>
  new GoogleRoutesMapsProvider({
    baseUrl: 'https://routes.googleapis.com',
    apiKey: KEY,
    timeoutMs: 3000,
    fetch: fetchImpl,
  });

const signal = () => new AbortController().signal;

const gallery = {
  id: 'ChIJ-gallery',
  displayName: { text: 'Nike Art Gallery', languageCode: 'en' },
  shortFormattedAddress: 'Lekki, Lagos',
  location: { latitude: 6.4457, longitude: 3.4801 },
  primaryType: 'art_gallery',
  rating: 4.73,
  userRatingCount: 3120,
  priceLevel: 'PRICE_LEVEL_MODERATE',
};

describe('GooglePlacesProvider (ADR-122)', () => {
  it('asks Nearby Search for a point, with the key and the field mask in headers', async () => {
    const calls: Call[] = [];
    const found = await places(fake(200, { places: [gallery] }, calls)).nearby(
      {
        center: { lat: 6.4281, lng: 3.4219 },
        kind: 'attractions',
        radiusMetres: 5000,
        limit: 4,
        language: 'fr-FR',
      },
      signal(),
    );
    const call = calls[0];
    expect(call?.url).toBe('https://places.googleapis.com/v1/places:searchNearby');
    expect(call?.method).toBe('POST');
    expect(call?.url).not.toContain(KEY);
    expect(call?.headers['x-goog-api-key']).toBe(KEY);
    expect(call?.headers['x-goog-fieldmask']).toBe(GOOGLE_PLACE_FIELDS);
    expect(call?.body).toEqual({
      includedTypes: [
        'tourist_attraction',
        'museum',
        'art_gallery',
        'park',
        'amusement_park',
        'zoo',
        'aquarium',
      ],
      maxResultCount: 4,
      rankPreference: 'POPULARITY',
      languageCode: 'fr',
      locationRestriction: {
        circle: { center: { latitude: 6.4281, longitude: 3.4219 }, radius: 5000 },
      },
    });
    expect(found).toEqual([
      {
        providerId: 'ChIJ-gallery',
        name: 'Nike Art Gallery',
        address: 'Lekki, Lagos',
        point: { lat: 6.4457, lng: 3.4801 },
        type: 'art_gallery',
        rating: 4.7,
        ratingCount: 3120,
        priceLevel: 'moderate',
      },
    ]);
  });

  it('asks Text Search for a name, preferring places around a point when one is known', async () => {
    const calls: Call[] = [];
    await places(fake(200, { places: [gallery] }, calls)).find(
      {
        text: 'Nike Art Gallery, Lagos',
        near: { lat: 6.5774, lng: 3.3212 },
        limit: 3,
        language: 'en',
      },
      signal(),
    );
    await places(fake(200, {}, calls)).find(
      { text: 'Eko Atlantic', near: null, limit: 2, language: 'en' },
      signal(),
    );
    expect(calls[0]?.url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(calls[0]?.body).toEqual({
      textQuery: 'Nike Art Gallery, Lagos',
      pageSize: 3,
      languageCode: 'en',
      locationBias: {
        circle: { center: { latitude: 6.5774, longitude: 3.3212 }, radius: 30_000 },
      },
    });
    expect(calls[1]?.body).toEqual({ textQuery: 'Eko Atlantic', pageSize: 2, languageCode: 'en' });
  });

  it('leaves out a place without a name or a point, and an odd rating or type', () => {
    expect(placeFromGoogle({ ...gallery, location: undefined })).toBeNull();
    expect(placeFromGoogle({ ...gallery, displayName: { text: ' ' } })).toBeNull();
    expect(
      placeFromGoogle({ ...gallery, rating: 7, primaryType: 'Not A Type', priceLevel: 'X' }),
    ).toMatchObject({ rating: null, type: null, priceLevel: null });
  });

  it('names the reason it failed with a code, never with what Google said', async () => {
    const failure = async (promise: Promise<unknown>): Promise<string> => {
      try {
        await promise;
        return 'none';
      } catch (error) {
        return error instanceof PlacesError ? error.code : 'thrown';
      }
    };
    const query = {
      center: { lat: 6.4, lng: 3.4 },
      kind: 'restaurants' as const,
      radiusMetres: 1500,
      limit: 3,
      language: 'en',
    };
    expect(
      await failure(places(fake(403, { error: { message: 'key' } })).nearby(query, signal())),
    ).toBe('status_403');
    expect(await failure(places(fake(200, { places: 'odd' })).nearby(query, signal()))).toBe(
      'unreadable_answer',
    );
    const timeout: typeof fetch = () =>
      Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect(await failure(places(timeout).nearby(query, signal()))).toBe('timeout');
  });
});

describe('GoogleRoutesMapsProvider (ADR-122)', () => {
  it('reads one route: metres, seconds and the polyline, without traffic', async () => {
    const calls: Call[] = [];
    const route = await routes(
      fake(
        200,
        {
          routes: [
            { distanceMeters: 21_340, duration: '2412s', polyline: { encodedPolyline: 'abc' } },
          ],
        },
        calls,
      ),
    ).route({ lat: 6.4281, lng: 3.4219 }, { lat: 6.5774, lng: 3.3212 }, signal());
    expect(route).toEqual({
      distanceMetres: 21_340,
      durationSeconds: 2412,
      polyline: 'abc',
      estimate: 'routed',
    });
    expect(calls[0]?.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(calls[0]?.url).not.toContain(KEY);
    expect(calls[0]?.headers['x-goog-api-key']).toBe(KEY);
    expect(calls[0]?.body).toMatchObject({
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    });
    await expect(
      routes(fake(200, {})).route({ lat: 6.4, lng: 3.4 }, { lat: 6.5, lng: 3.3 }, signal()),
    ).rejects.toThrow(RoutingFailedError);
  });

  it('reads a matrix where Google leaves out indexes of 0, and a pair without a road', async () => {
    const calls: Call[] = [];
    const legs = await routes(
      fake(
        200,
        [
          { status: {}, condition: 'ROUTE_EXISTS', distanceMeters: 4200, duration: '840s' },
          { originIndex: 1, status: {}, condition: 'ROUTE_NOT_FOUND' },
          { originIndex: 2, status: { code: 5 } },
        ],
        calls,
      ),
    ).matrix(
      [
        { lat: 6.43, lng: 3.42 },
        { lat: 6.44, lng: 3.43 },
        { lat: 6.45, lng: 3.44 },
      ],
      [{ lat: 6.5774, lng: 3.3212 }],
      signal(),
    );
    expect(legs).toEqual([[{ distanceMetres: 4200, durationSeconds: 840 }], [null], [null]]);
    expect(calls[0]?.url).toBe(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
    );
    expect((calls[0]?.body.origins as unknown[]).length).toBe(3);
  });

  it('fails when no pair has a road, when Google refuses, and above 625 elements', async () => {
    const one = [{ lat: 6.4, lng: 3.4 }];
    await expect(
      routes(fake(200, [{ condition: 'ROUTE_NOT_FOUND' }])).matrix(one, one, signal()),
    ).rejects.toThrow(RoutingFailedError);
    await expect(routes(fake(429, {})).matrix(one, one, signal())).rejects.toThrow('status 429');
    const many = Array.from({ length: 26 }, (_, index) => ({ lat: 6 + index / 100, lng: 3.4 }));
    await expect(routes(fake(200, [])).matrix(many, many, signal())).rejects.toThrow(
      'too many elements',
    );
  });

  it("reads Google's durations", () => {
    expect(googleSeconds('2412s')).toBe(2412);
    expect(googleSeconds('12.6s')).toBe(13);
    expect(googleSeconds('0s')).toBe(0);
    expect(googleSeconds('12 minutes')).toBeNull();
    expect(googleSeconds(undefined)).toBeNull();
  });
});
