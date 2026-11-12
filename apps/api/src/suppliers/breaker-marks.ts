import type { Redis } from 'ioredis';

/**
 * Circuit breakers live in each API instance; the status page (ADR-087) needs one answer across
 * all of them. An instance whose breaker opens marks the supplier in Redis for this long, and a
 * breaker that stays open re-marks it at every failed probe (every 30 s by default).
 */
export const BREAKER_MARK_TTL_MS = 120_000;

/** `breaker` is the breaker's name: `<vertical>:<supplier>`, for example `flights:duffel`. */
export const breakerMarkKey = (breaker: string): string => `status:breaker:${breaker}`;

/** Marks a supplier as failing; a Redis error is ignored (the status page is best effort). */
export function markBreakerOpen(redis: Redis, breaker: string): void {
  redis.set(breakerMarkKey(breaker), '1', 'PX', BREAKER_MARK_TTL_MS).catch(() => undefined);
}
