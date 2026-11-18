import type { GeoPoint } from '@suskii/shared';

import { MapsProvider, RoutingFailedError, type RouteLeg, type RouteResult } from './maps';

/** The parts of a `computeRoutes` answer this adapter asks for (its field mask). */
interface ComputeRoutesResponse {
  routes?: {
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
  }[];
}

/**
 * One element of a `computeRouteMatrix` answer. Google leaves out fields that hold their
 * default, so an index of 0 or a distance of 0 can be missing.
 */
interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  status?: { code?: number };
  condition?: string;
  distanceMeters?: number;
  duration?: string;
}

/** Google allows 625 elements in one traffic-unaware matrix call; we never ask for more. */
export const GOOGLE_MATRIX_MAX_ELEMENTS = 625;

const ROUTE_FIELDS = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';
const MATRIX_FIELDS = 'originIndex,destinationIndex,status,condition,distanceMeters,duration';

/** "1234s" or "12.5s", Google's duration, as whole seconds; null when it is not one. */
export function googleSeconds(duration: string | undefined): number | null {
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration ?? '');
  return match ? Math.round(Number(match[1])) : null;
}

const waypoint = (point: GeoPoint) => ({
  location: { latLng: { latitude: point.lat, longitude: point.lng } },
});

/**
 * Google's Routes API (ADR-122): `computeRoutes` for one route, `computeRouteMatrix` for
 * several origins or destinations at once. Driving, without traffic (the cheapest tier and the
 * same answer at any hour), metric. The key goes in a header, never in the URL, and the field
 * mask asks only for what we read, which is also what Google bills by. Requests hold
 * coordinates only.
 */
export class GoogleRoutesMapsProvider extends MapsProvider {
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

  async route(from: GeoPoint, to: GeoPoint, signal: AbortSignal): Promise<RouteResult> {
    const body = await this.post<ComputeRoutesResponse>(
      'directions/v2:computeRoutes',
      ROUTE_FIELDS,
      {
        origin: waypoint(from),
        destination: waypoint(to),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        polylineEncoding: 'ENCODED_POLYLINE',
        units: 'METRIC',
      },
      signal,
    );
    const route = body.routes?.[0];
    const durationSeconds = googleSeconds(route?.duration);
    const polyline = route?.polyline?.encodedPolyline;
    if (!route || durationSeconds === null || typeof polyline !== 'string') {
      throw new RoutingFailedError('no route');
    }
    return {
      distanceMetres: Math.round(route.distanceMeters ?? 0),
      durationSeconds,
      polyline,
      estimate: 'routed',
    };
  }

  override async matrix(
    origins: readonly GeoPoint[],
    destinations: readonly GeoPoint[],
    signal: AbortSignal,
  ): Promise<(RouteLeg | null)[][]> {
    if (origins.length === 0 || destinations.length === 0) return origins.map(() => []);
    if (origins.length * destinations.length > GOOGLE_MATRIX_MAX_ELEMENTS) {
      throw new RoutingFailedError('too many elements');
    }
    const elements = await this.post<RouteMatrixElement[]>(
      'distanceMatrix/v2:computeRouteMatrix',
      MATRIX_FIELDS,
      {
        origins: origins.map((point) => ({ waypoint: waypoint(point) })),
        destinations: destinations.map((point) => ({ waypoint: waypoint(point) })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        units: 'METRIC',
      },
      signal,
    );
    if (!Array.isArray(elements)) throw new RoutingFailedError('unreadable answer');
    const rows: (RouteLeg | null)[][] = origins.map(() => destinations.map(() => null));
    let answered = 0;
    for (const element of elements) {
      const origin = element.originIndex ?? 0;
      const destination = element.destinationIndex ?? 0;
      const row = rows[origin];
      if (!row || destination < 0 || destination >= destinations.length) continue;
      const durationSeconds = googleSeconds(element.duration);
      // An element with an error status, or no route between the two points, stays null.
      if (
        (element.status?.code ?? 0) !== 0 ||
        element.condition !== 'ROUTE_EXISTS' ||
        durationSeconds === null
      ) {
        continue;
      }
      row[destination] = {
        distanceMetres: Math.round(element.distanceMeters ?? 0),
        durationSeconds,
      };
      answered += 1;
    }
    if (answered === 0) throw new RoutingFailedError('no route for any pair');
    return rows;
  }

  private async post<T>(
    path: string,
    fields: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<T> {
    // `./` keeps the path relative whatever it holds (a colon can read as a URL scheme).
    const url = new URL(
      `./${path}`,
      this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`,
    );
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-goog-api-key': this.options.apiKey,
          'x-goog-fieldmask': fields,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]),
      });
    } catch (error) {
      throw new RoutingFailedError(error instanceof Error ? error.name : 'request failed');
    }
    if (!response.ok) {
      // The status names the reason (403: the key's restrictions, 429: quota); the body, which
      // can echo the request, is never logged.
      await response.body?.cancel();
      throw new RoutingFailedError(`status ${response.status}`);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new RoutingFailedError('unreadable answer');
    }
  }
}
