import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { haversineMetres, type GeoPoint } from '@suskii/shared';

import { scrubQuery } from '../ai-search/scrub';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { MapsProvider, RoutingFailedError, type RouteLeg } from '../ground/maps';
import { REDIS } from '../infra/redis';
import { CircuitBreaker } from '../suppliers/circuit-breaker';
import { CircuitOpenError } from '../suppliers/supplier.errors';
import { locationCalls } from '../telemetry/metrics';

import {
  PLACE_RADIUS_METRES,
  PlacesError,
  PlacesProvider,
  type PlaceKind,
  type PlaceResult,
} from './places';

/** The places provider in use, or null while `PLACES_PROVIDER=none` (ADR-122). */
export const PLACES = Symbol('PLACES');

/** Why a places answer is empty, as a code a tool passes on (never a sentence). */
export type PlacesProblem = 'places_off' | 'places_limit' | 'places_unavailable' | 'query_empty';

export type PlacesAnswer =
  | { ok: true; places: PlaceResult[]; provider: PlacesProvider['name'] }
  | { ok: false; problem: PlacesProblem };

export type DistanceBasis = 'routed' | 'straight_line';

/** One measured pair. A straight line says nothing about how long the road takes. */
export interface MeasuredLeg {
  distanceMetres: number;
  durationSeconds: number | null;
  basis: DistanceBasis;
}

export interface Measured {
  /** `legs[origin][destination]`, every pair measured: by road when we can, else in a line. */
  legs: MeasuredLeg[][];
  /** The road figures came from the development mock: for testing, never real ones. */
  sample: boolean;
}

type Api = 'places' | 'routes';

const DAY_SECONDS = 86_400;

/** "Victoria Island" and not "[removed]": what is left of a name once it has been scrubbed. */
const MEANINGFUL = /\p{L}{2,}/u;

export const straightLeg = (from: GeoPoint, to: GeoPoint): MeasuredLeg => ({
  distanceMetres: Math.round(haversineMetres(from, to)),
  durationSeconds: null,
  basis: 'straight_line',
});

/** A point Google may be asked about: finite, on the globe, and not the 0,0 of a missing one. */
export const isUsablePoint = (point: GeoPoint): boolean =>
  Number.isFinite(point.lat) &&
  Number.isFinite(point.lng) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lng) <= 180 &&
  !(point.lat === 0 && point.lng === 0);

/**
 * What Ask Suskii's location tools ask of places and routing providers (ADR-122), and the only
 * way they ask. It decides whether a call may be made (a provider is chosen, the day's cap for
 * Google is not reached, the provider is not failing) and never invents an answer: without a
 * road a distance is the straight line and says so, without places there are none.
 *
 * Nothing from Google is cached here. Google's terms allow keeping place ids and coordinates
 * for a while, but every name, address, rating and route a traveller reads comes from a call
 * made for that answer; the daily caps bound what that costs.
 */
@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly breakers: Record<Api, CircuitBreaker> = {
    places: new CircuitBreaker('location-places'),
    routes: new CircuitBreaker('location-routes'),
  };

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PLACES) private readonly places: PlacesProvider | null,
    private readonly maps: MapsProvider,
  ) {}

  /** The places provider in use, or null while places are off. */
  get placesProvider(): PlacesProvider['name'] | null {
    return this.places?.name ?? null;
  }

  /** Places of a kind around a point, the provider's most popular first. */
  async nearby(
    center: GeoPoint,
    kind: PlaceKind,
    limit: number,
    language: string,
    signal: AbortSignal,
  ): Promise<PlacesAnswer> {
    const provider = this.places;
    if (!provider) return { ok: false, problem: 'places_off' };
    if (!isUsablePoint(center)) return { ok: false, problem: 'places_unavailable' };
    return this.askPlaces(
      provider,
      (abort) =>
        provider.nearby(
          { center, kind, radiusMetres: PLACE_RADIUS_METRES[kind], limit, language },
          abort,
        ),
      signal,
    );
  }

  /**
   * Public places found by name ("Eko Atlantic", "Lekki Conservation Centre"), around `near`
   * when one is known. The words are scrubbed of contact details and numbers first; nothing
   * else about the conversation goes with them.
   */
  async find(
    text: string,
    near: GeoPoint | null,
    limit: number,
    language: string,
    signal: AbortSignal,
  ): Promise<PlacesAnswer> {
    const provider = this.places;
    if (!provider) return { ok: false, problem: 'places_off' };
    const scrubbed = scrubQuery(text)
      .replace(/\[removed\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!MEANINGFUL.test(scrubbed)) return { ok: false, problem: 'query_empty' };
    const bias = near && isUsablePoint(near) ? near : null;
    return this.askPlaces(
      provider,
      (abort) => provider.find({ text: scrubbed, near: bias, limit, language }, abort),
      signal,
    );
  }

  /**
   * Every origin measured against every destination: by road through the routing provider when
   * one may be used, else in a straight line. The development mock routes only where mocks are
   * allowed, and its figures are marked `sample`. Google's elements count against the day's cap;
   * at the cap, or when the provider fails, the answer is the straight line.
   */
  async measure(
    origins: readonly GeoPoint[],
    destinations: readonly GeoPoint[],
    signal: AbortSignal,
  ): Promise<Measured> {
    const straight = (): Measured => ({
      legs: origins.map((origin) =>
        destinations.map((destination) => straightLeg(origin, destination)),
      ),
      sample: false,
    });
    if (origins.length === 0 || destinations.length === 0) return straight();
    const provider = this.maps;
    const mockAllowed = this.config.NODE_ENV !== 'production' || this.config.ALLOW_MOCK_PROVIDERS;
    if (provider.name === 'mock' ? !mockAllowed : !['google', 'osrm'].includes(provider.name)) {
      return straight();
    }
    if (
      provider.name === 'google' &&
      !(await this.withinCap('routes', origins.length * destinations.length))
    ) {
      locationCalls.add(1, { api: 'routes', provider: provider.name, outcome: 'capped' });
      return straight();
    }
    let road: (RouteLeg | null)[][];
    try {
      road = await this.breakers.routes.execute(() =>
        provider.matrix(origins, destinations, signal),
      );
      locationCalls.add(1, { api: 'routes', provider: provider.name, outcome: 'ok' });
    } catch (error) {
      if (
        !(error instanceof RoutingFailedError) &&
        !(error instanceof CircuitOpenError) &&
        !isAbort(error)
      ) {
        throw error;
      }
      locationCalls.add(1, {
        api: 'routes',
        provider: provider.name,
        outcome: error instanceof CircuitOpenError ? 'breaker_open' : 'failed',
      });
      // The reason is our own words ("status 403", "no route"): never a coordinate or a body.
      this.logger.warn(
        {
          provider: provider.name,
          reason: error instanceof Error ? error.message.slice(0, 80) : 'error',
        },
        'routing failed; using straight lines',
      );
      return straight();
    }
    return {
      legs: origins.map((origin, o) =>
        destinations.map((destination, d) => {
          const leg = road[o]?.[d];
          // A pair with no road (across water, a closed border) is the straight line.
          return leg
            ? {
                distanceMetres: leg.distanceMetres,
                durationSeconds: leg.durationSeconds,
                basis: 'routed',
              }
            : straightLeg(origin, destination);
        }),
      ),
      sample: provider.name === 'mock',
    };
  }

  private async askPlaces(
    provider: PlacesProvider,
    call: (signal: AbortSignal) => Promise<PlaceResult[]>,
    signal: AbortSignal,
  ): Promise<PlacesAnswer> {
    if (provider.name === 'google' && !(await this.withinCap('places', 1))) {
      locationCalls.add(1, { api: 'places', provider: provider.name, outcome: 'capped' });
      return { ok: false, problem: 'places_limit' };
    }
    try {
      const places = await this.breakers.places.execute(() => call(signal));
      locationCalls.add(1, { api: 'places', provider: provider.name, outcome: 'ok' });
      return { ok: true, places, provider: provider.name };
    } catch (error) {
      if (
        !(error instanceof PlacesError) &&
        !(error instanceof CircuitOpenError) &&
        !isAbort(error)
      ) {
        throw error;
      }
      locationCalls.add(1, {
        api: 'places',
        provider: provider.name,
        outcome: error instanceof CircuitOpenError ? 'breaker_open' : 'failed',
      });
      this.logger.warn(
        {
          provider: provider.name,
          code:
            error instanceof PlacesError
              ? error.code
              : error instanceof Error
                ? error.name
                : 'error',
        },
        'places provider failed',
      );
      return { ok: false, problem: 'places_unavailable' };
    }
  }

  /**
   * Counts `amount` against today's cap (UTC) for a paid API and says whether it fits. The count
   * is taken before the call, since a call that fails may still be billed. When Redis cannot
   * answer, nothing is spent: a cap fails closed.
   */
  private async withinCap(api: Api, amount: number): Promise<boolean> {
    const cap =
      api === 'places'
        ? this.config.GOOGLE_PLACES_DAILY_CALLS
        : this.config.GOOGLE_ROUTES_DAILY_ELEMENTS;
    if (cap <= 0 || amount > cap) return false;
    const key = `loc:cap:${api}:${new Date().toISOString().slice(0, 10)}`;
    try {
      const result = (await this.redis
        .multi()
        .incrby(key, amount)
        .expire(key, 2 * DAY_SECONDS, 'NX')
        .exec()) as [[Error | null, number]] | null;
      const used = result?.[0]?.[1];
      return typeof used === 'number' && used <= cap;
    } catch {
      return false;
    }
  }
}

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
