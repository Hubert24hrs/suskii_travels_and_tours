import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { parseWithBigInt, stringifyWithBigInt } from '../common/json';
import { randomToken } from '../crypto/random';
import { REDIS } from '../infra/redis';

export type SearchVertical = 'flights' | 'hotels';

export type SupplierStatus = 'ok' | 'timeout' | 'error' | 'circuit_open';

export interface SupplierOutcome {
  supplier: string;
  status: SupplierStatus;
  resultCount: number;
  durationMs: number;
}

export interface SearchMeta<Q> {
  searchId: string;
  vertical: SearchVertical;
  /** The validated request, so an expired search can be re-run with the same inputs. */
  request: Q;
  suppliers: SupplierOutcome[];
  partial: boolean;
  resultCount: number;
  createdAt: string;
  /** When the stored results stop being served (offers expire around then). */
  resultsExpireAt: string;
}

/** Results are kept this long; offers themselves expire after ~30 minutes. */
const RESULTS_TTL_SECONDS = 30 * 60;
/** The request is kept for a day so "search again" can restore every input. */
const META_TTL_SECONDS = 24 * 60 * 60;
/** Partial results are served briefly, then the failed supplier is retried. */
const PARTIAL_CACHE_TTL_SECONDS = 60;

const PREFIX: Record<SearchVertical, string> = { flights: 'fs', hotels: 'hs' };

/** Stable hash of a normalised query (object keys sorted). */
export function queryHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return item;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('base64url');
}

/**
 * Redis layout per vertical:
 *   search:<v>:q:<hash>        -> current search id for an identical query (cache TTL)
 *   search:<v>:meta:<id>       -> SearchMeta (24 h)
 *   search:<v>:items:<id>      -> hash of result id -> item JSON (30 min)
 * Every supplier fetch gets a new random search id, so a result id is never reused for a
 * different offer.
 */
@Injectable()
export class SearchStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  newSearchId(vertical: SearchVertical): string {
    return `${PREFIX[vertical]}_${randomToken(12)}`;
  }

  verticalOf(searchId: string): SearchVertical | null {
    if (searchId.startsWith('fs_')) return 'flights';
    if (searchId.startsWith('hs_')) return 'hotels';
    return null;
  }

  async cachedSearchId(vertical: SearchVertical, hash: string): Promise<string | null> {
    return this.redis.get(`search:${vertical}:q:${hash}`);
  }

  async save<Q, T>(
    vertical: SearchVertical,
    hash: string,
    meta: SearchMeta<Q>,
    items: ReadonlyMap<string, T>,
    cacheTtlSeconds: number,
  ): Promise<void> {
    const itemsKey = `search:${vertical}:items:${meta.searchId}`;
    const multi = this.redis.multi();
    if (items.size > 0) {
      multi.hset(
        itemsKey,
        Object.fromEntries([...items].map(([id, item]) => [id, stringifyWithBigInt(item)])),
      );
      multi.expire(itemsKey, RESULTS_TTL_SECONDS);
    }
    multi.set(
      `search:${vertical}:meta:${meta.searchId}`,
      stringifyWithBigInt(meta),
      'EX',
      META_TTL_SECONDS,
    );
    multi.set(
      `search:${vertical}:q:${hash}`,
      meta.searchId,
      'EX',
      meta.partial ? PARTIAL_CACHE_TTL_SECONDS : cacheTtlSeconds,
    );
    await multi.exec();
  }

  resultsExpireAt(now: number): string {
    return new Date(now + RESULTS_TTL_SECONDS * 1000).toISOString();
  }

  async meta<Q>(vertical: SearchVertical, searchId: string): Promise<SearchMeta<Q> | null> {
    const raw = await this.redis.get(`search:${vertical}:meta:${searchId}`);
    return raw ? parseWithBigInt<SearchMeta<Q>>(raw) : null;
  }

  /** All stored items in insertion order, or null once the results have expired. */
  async items<T>(vertical: SearchVertical, searchId: string): Promise<Map<string, T> | null> {
    const raw = await this.redis.hgetall(`search:${vertical}:items:${searchId}`);
    const entries = Object.entries(raw);
    if (entries.length === 0) return null;
    return new Map(entries.map(([id, json]) => [id, parseWithBigInt<T>(json)]));
  }

  async item<T>(vertical: SearchVertical, searchId: string, itemId: string): Promise<T | null> {
    const raw = await this.redis.hget(`search:${vertical}:items:${searchId}`, itemId);
    return raw ? parseWithBigInt<T>(raw) : null;
  }
}
