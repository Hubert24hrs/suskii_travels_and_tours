import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { GeoPoint } from '@suskii/shared';

import { REDIS } from '../../infra/redis';
import type { PlaceResult } from '../../location/places';
import type { AgentGrant } from '../agent-grants';

/** "place_1" to "place_99": what a model hands back instead of a point it could mistype. */
export const PLACE_REF = /^place_[1-9]\d?$/;
const MAX_REFS = 99;
/** As long as a conversation about one trip lasts; Google allows coordinates for 30 days. */
const TTL_SECONDS = 6 * 60 * 60;
const COUNTER = 'n';

const key = (grant: AgentGrant): string =>
  grant.conversationId ? `agent:places:${grant.conversationId}` : `agent:places:run:${grant.runId}`;

interface Stored {
  /** The provider's place id. */
  p: string;
  a: number;
  o: number;
  /** Found by the development mock. */
  s?: true;
}

const parse = (raw: string | undefined): Stored | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Stored>;
    return typeof value.p === 'string' && typeof value.a === 'number' && typeof value.o === 'number'
      ? (value as Stored)
      : null;
  } catch {
    return null;
  }
};

/**
 * The places a conversation's location tools found (ADR-122), so a later tool can measure from
 * one by its short reference ("place_2") and a model never copies or invents a coordinate. Only
 * a place's provider id and its point are kept, which Google's terms allow; its name, address
 * and rating are never stored. In Redis for six hours, per conversation (per run without one).
 */
@Injectable()
export class AgentPlaceRefs {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** A reference for each place, in order: the same place keeps the reference it was given. */
  async remember(
    grant: AgentGrant,
    places: readonly PlaceResult[],
    sample: boolean,
  ): Promise<string[]> {
    if (places.length === 0) return [];
    const hash = key(grant);
    const existing = await this.redis.hgetall(hash);
    const byId = new Map<string, string>();
    for (const [field, raw] of Object.entries(existing)) {
      const stored = PLACE_REF.test(field) ? parse(raw) : null;
      if (stored) byId.set(stored.p, field);
    }
    let next = Number.parseInt(existing[COUNTER] ?? '0', 10) || 0;
    const writes: Record<string, string> = {};
    const refs = places.map((place) => {
      const known = byId.get(place.providerId);
      if (known) return known;
      // After the 99th place the oldest references are given again, to the newest places.
      next = (next % MAX_REFS) + 1;
      const ref = `place_${next}`;
      const stored: Stored = {
        p: place.providerId,
        a: place.point.lat,
        o: place.point.lng,
        ...(sample ? { s: true as const } : {}),
      };
      writes[ref] = JSON.stringify(stored);
      byId.set(place.providerId, ref);
      return ref;
    });
    writes[COUNTER] = String(next);
    await this.redis.multi().hset(hash, writes).expire(hash, TTL_SECONDS).exec();
    return refs;
  }

  /** The point a reference names in this conversation, or null for one it never gave. */
  async point(
    grant: AgentGrant,
    ref: string,
  ): Promise<{ point: GeoPoint; sample: boolean } | null> {
    if (!PLACE_REF.test(ref)) return null;
    const stored = parse((await this.redis.hget(key(grant), ref)) ?? undefined);
    return stored ? { point: { lat: stored.a, lng: stored.o }, sample: stored.s === true } : null;
  }
}
