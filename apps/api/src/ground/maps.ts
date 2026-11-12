import { Inject, Injectable, Logger } from '@nestjs/common';

import { encodePolyline, haversineMetres, type GeoPoint } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';

/** A driving route between two points (ADR-053). */
export interface RouteResult {
  distanceMetres: number;
  durationSeconds: number;
  /** Encoded polyline (precision 5) of the planned route. */
  polyline: string;
  /** `straight_line` when the provider failed and the estimate stood in for it. */
  estimate: 'routed' | 'straight_line';
}

/** Thrown when a provider has no answer; the caller falls back to the straight-line estimate. */
export class RoutingFailedError extends Error {
  constructor(reason: string) {
    super(`Routing failed: ${reason}`);
    this.name = 'RoutingFailedError';
  }
}

/** Routing for ride quotes and route-deviation checks. */
export abstract class MapsProvider {
  abstract readonly name: string;
  /** Throws `RoutingFailedError` when no route could be computed. */
  abstract route(from: GeoPoint, to: GeoPoint, signal: AbortSignal): Promise<RouteResult>;
}

/** City driving speed the mock and the fallback assume: 25 km/h (Lagos traffic). */
const CITY_METRES_PER_SECOND = 25_000 / 3600;

/**
 * Development and test routing (refused in production with rides on, unless
 * ALLOW_MOCK_PROVIDERS): the straight line × 1.3 at city speed, through a midpoint offset so the
 * route has a bend, deterministic for the same points.
 */
@Injectable()
export class MockMapsProvider extends MapsProvider {
  readonly name = 'mock';
  /** Test hook: the next calls fail as if the provider were down. */
  failNext = 0;

  route(from: GeoPoint, to: GeoPoint): Promise<RouteResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new RoutingFailedError('mock provider unavailable'));
    }
    const distanceMetres = Math.round(haversineMetres(from, to) * 1.3);
    const bend = { lat: (from.lat + to.lat) / 2 + 0.002, lng: (from.lng + to.lng) / 2 };
    return Promise.resolve({
      distanceMetres,
      durationSeconds: Math.round(distanceMetres / CITY_METRES_PER_SECOND),
      polyline: encodePolyline([from, bend, to]),
      estimate: 'routed',
    });
  }
}

interface OsrmResponse {
  code?: string;
  routes?: { distance?: number; duration?: number; geometry?: string }[];
}

/**
 * A self-hosted OSRM (`/route/v1/driving`). OSRM's default geometry is a precision-5 polyline,
 * the same format as ours. The request carries coordinates only, no rider data.
 */
export class OsrmMapsProvider extends MapsProvider {
  readonly name = 'osrm';

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {
    super();
  }

  async route(from: GeoPoint, to: GeoPoint, signal: AbortSignal): Promise<RouteResult> {
    const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = new URL(`route/v1/driving/${coordinates}`, ensureSlash(this.baseUrl));
    url.searchParams.set('overview', 'simplified');
    let body: OsrmResponse;
    try {
      const response = await fetch(url, {
        redirect: 'error',
        headers: { accept: 'application/json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
      if (!response.ok) throw new RoutingFailedError(`status ${response.status}`);
      body = (await response.json()) as OsrmResponse;
    } catch (error) {
      if (error instanceof RoutingFailedError) throw error;
      throw new RoutingFailedError(error instanceof Error ? error.name : 'request failed');
    }
    const route = body.routes?.[0];
    if (
      body.code !== 'Ok' ||
      typeof route?.distance !== 'number' ||
      typeof route.duration !== 'number' ||
      typeof route.geometry !== 'string'
    ) {
      throw new RoutingFailedError(`no route (${body.code ?? 'unknown'})`);
    }
    return {
      distanceMetres: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      polyline: route.geometry,
      estimate: 'routed',
    };
  }
}

const ensureSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

/** The trip is longer than Cars quotes (`RIDE_MAX_KM`, or `RIDE_FALLBACK_MAX_KM` on fallback). */
export class RouteTooLongError extends Error {
  constructor() {
    super('Route is longer than the maximum ride distance');
    this.name = 'RouteTooLongError';
  }
}

/**
 * Routes through the configured provider. When it fails, the quote uses the straight line × 1.4
 * at city speed, labelled `straight_line` and capped at `RIDE_FALLBACK_MAX_KM`, so an outage
 * neither blocks riders nor produces absurd fares (ADR-053).
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly provider: MapsProvider,
  ) {}

  async route(from: GeoPoint, to: GeoPoint): Promise<RouteResult> {
    let result: RouteResult;
    try {
      result = await this.provider.route(
        from,
        to,
        AbortSignal.timeout(this.config.MAPS_TIMEOUT_MS),
      );
    } catch (error) {
      if (!(error instanceof RoutingFailedError) && !isAbort(error)) throw error;
      this.logger.warn({ provider: this.provider.name }, 'routing failed; using the estimate');
      result = straightLineEstimate(from, to);
      if (result.distanceMetres > this.config.RIDE_FALLBACK_MAX_KM * 1000) {
        throw new RouteTooLongError();
      }
    }
    if (result.distanceMetres > this.config.RIDE_MAX_KM * 1000) throw new RouteTooLongError();
    return result;
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

export function straightLineEstimate(from: GeoPoint, to: GeoPoint): RouteResult {
  const distanceMetres = Math.round(haversineMetres(from, to) * 1.4);
  return {
    distanceMetres,
    durationSeconds: Math.round(distanceMetres / CITY_METRES_PER_SECOND),
    polyline: encodePolyline([from, to]),
    estimate: 'straight_line',
  };
}
