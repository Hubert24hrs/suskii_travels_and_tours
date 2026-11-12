import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { ScrapeVendor } from '@suskii/shared';

import { REDIS } from '../infra/redis';

import { ScrapeError } from './scrape-provider';

/**
 * Token bucket: refills `rate` tokens a minute up to a burst of one, takes one when there is
 * one. Returns 0 when taken, else the milliseconds until the next token.
 */
const TAKE = `
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local last = tonumber(redis.call('GET', KEYS[1]) or '0')
local wait = last + interval - now
if wait > 0 then return wait end
redis.call('SET', KEYS[1], now, 'PX', math.max(interval * 2, 60000))
return 0
`;

/** Takes a concurrency slot when one is free. Returns 1 when taken. */
const ENTER = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const LEAVE = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count <= 1 then redis.call('DEL', KEYS[1]) else redis.call('DECR', KEYS[1]) end
return 0
`;

const MINUTE_MS = 60_000;
/** A slot nobody released (a crashed attempt) frees itself after this. */
const SLOT_TTL_MS = 3 * MINUTE_MS;
/** How long a penalty halves. A site that refused is approached at half speed, then recovers. */
export const PENALTY_HALF_LIFE_MS = 10 * MINUTE_MS;
export const MAX_PENALTY_FACTOR = 8;
/** The longest a `Retry-After` is honoured for; longer than this the job gives up instead. */
export const MAX_PAUSE_MS = 5 * MINUTE_MS;
const MAX_JITTER_MS = 400;

export interface ThrottlePolicy {
  requestsPerMinute: number;
  maxConcurrency: number;
}

export interface ThrottleLease {
  release(): Promise<void>;
}

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });

/**
 * How politely a site is read (ADR-102): a rate and a concurrency limit per site, shared by
 * every replica; a pause when the site says `Retry-After`; and half speed after a refusal,
 * recovering slowly. Waiting has a deadline: a read that cannot start in time fails as a
 * timeout instead of queueing without end.
 */
@Injectable()
export class DomainThrottle {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Waits for a turn on `domain` and returns a lease to release when the attempt ends. Throws
   * `ScrapeError('timeout')` when no turn comes before `deadline` (epoch milliseconds).
   */
  async acquire(
    vendor: ScrapeVendor,
    domain: string,
    policy: ThrottlePolicy,
    deadline: number,
    signal: AbortSignal,
    random: () => number = Math.random,
  ): Promise<ThrottleLease> {
    const slotKey = `pi:slots:${domain}`;
    for (;;) {
      const now = Date.now();
      const paused = Number(await this.redis.pttl(`pi:pause:${domain}`));
      let wait = paused > 0 ? paused : 0;
      if (wait === 0) {
        const entered = await this.redis.eval(
          ENTER,
          1,
          slotKey,
          policy.maxConcurrency,
          SLOT_TTL_MS,
        );
        if (entered === 1) {
          const factor = await this.penalty(domain, now);
          const interval = Math.ceil((MINUTE_MS / policy.requestsPerMinute) * factor);
          wait = Number(await this.redis.eval(TAKE, 1, `pi:rate:${domain}`, now, interval));
          if (wait === 0) {
            let released = false;
            return {
              release: async () => {
                if (released) return;
                released = true;
                await this.redis.eval(LEAVE, 1, slotKey).catch(() => undefined);
              },
            };
          }
          await this.redis.eval(LEAVE, 1, slotKey);
        } else {
          wait = 250;
        }
      }
      wait += Math.floor(random() * MAX_JITTER_MS);
      if (now + wait > deadline) {
        throw new ScrapeError(vendor, 'timeout', { reason: 'no turn before the deadline' });
      }
      try {
        await sleep(wait, signal);
      } catch {
        throw new ScrapeError(vendor, 'timeout', { reason: 'aborted while waiting' });
      }
    }
  }

  /** The site refused or asked us to wait: slow down, and pause when it named a time. */
  async penalise(domain: string, retryAfterMs?: number, now = Date.now()): Promise<void> {
    const current = await this.penalty(domain, now);
    const factor = Math.min(MAX_PENALTY_FACTOR, Math.max(2, Math.ceil(current) * 2));
    await this.redis.set(`pi:slow:${domain}`, `${factor}:${now}`, 'PX', PENALTY_HALF_LIFE_MS * 4);
    if (retryAfterMs && retryAfterMs > 0) {
      await this.redis.set(`pi:pause:${domain}`, '1', 'PX', Math.min(MAX_PAUSE_MS, retryAfterMs));
    }
  }

  /** The current slow-down: 1 at full speed, halving back towards it every half-life. */
  async penalty(domain: string, now = Date.now()): Promise<number> {
    const raw = await this.redis.get(`pi:slow:${domain}`);
    if (!raw) return 1;
    const [factor = '1', since = '0'] = raw.split(':');
    const halvings = Math.floor((now - Number(since)) / PENALTY_HALF_LIFE_MS);
    return Math.max(1, Number(factor) / 2 ** Math.max(0, halvings));
  }
}
