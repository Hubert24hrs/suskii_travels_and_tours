import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { REDIS } from '../infra/redis';

/** How long a parser's record on a site counts. */
const WINDOW_SECONDS = 24 * 60 * 60;
/** A drift stays open until staff change the recipe, or this long at most. */
const OPEN_SECONDS = 14 * 24 * 60 * 60;
/** Failed reads in the window before the rate means anything. */
export const DRIFT_MIN_FAILURES = 5;
/** The share of reads that fail to find a price at which a parser counts as drifting. */
export const DRIFT_FAILURE_RATE = 0.5;

const state = z.object({ since: z.iso.datetime(), parserVersion: z.string() });
export type DriftState = z.infer<typeof state>;

/** Counts an outcome; opens the drift when failures are many enough and the larger share. */
const NOTE = `
local fail = tonumber(ARGV[1])
local ok = redis.call('HINCRBY', KEYS[1], 'ok', 1 - fail)
local failed = redis.call('HINCRBY', KEYS[1], 'fail', fail)
redis.call('EXPIRE', KEYS[1], ARGV[2])
if fail == 1 and failed >= tonumber(ARGV[3]) and failed >= (ok + failed) * tonumber(ARGV[4]) then
  if redis.call('SET', KEYS[2], ARGV[5], 'NX', 'EX', ARGV[6]) then return 1 end
end
return 0
`;

/**
 * Parser drift (ADR-102): when the pages of a site stop yielding prices to a recipe version, the
 * site is moved to its recipe's next method, staff are told, and the incident stays open until a
 * person changes the recipe. Nothing here writes or approves a recipe.
 */
@Injectable()
export class PriceIntelDrift {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Records whether a read with `parserVersion` found a price. Returns true when this failure
   * opened a drift (once per incident).
   */
  async note(
    sourceId: string,
    parserVersion: string,
    found: boolean,
    now: Date = new Date(),
  ): Promise<boolean> {
    const opened = await this.redis.eval(
      NOTE,
      2,
      `pi:drift:count:${sourceId}:${parserVersion}`,
      `pi:drift:open:${sourceId}`,
      found ? 0 : 1,
      WINDOW_SECONDS,
      DRIFT_MIN_FAILURES,
      DRIFT_FAILURE_RATE,
      JSON.stringify({ since: now.toISOString(), parserVersion } satisfies DriftState),
      OPEN_SECONDS,
    );
    return opened === 1;
  }

  /** The open drift of a site, or null. Unreadable means none: drift only changes the method. */
  async of(sourceId: string): Promise<DriftState | null> {
    const raw = await this.redis.get(`pi:drift:open:${sourceId}`).catch(() => null);
    if (!raw) return null;
    try {
      const parsed = state.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Closes the incident: a person changed the recipe. */
  async clear(sourceId: string, parserVersions: readonly string[]): Promise<void> {
    await this.redis.del(
      `pi:drift:open:${sourceId}`,
      ...parserVersions.map((version) => `pi:drift:count:${sourceId}:${version}`),
    );
  }
}
