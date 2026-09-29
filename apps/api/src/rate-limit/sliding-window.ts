import type { Redis } from 'ioredis';

/**
 * Sliding-window counter (the approximation Cloudflare and others use): the previous window's
 * count is weighted by how much of it still overlaps the sliding window. O(1) memory per key and
 * atomic in Redis, unlike a per-request log.
 *
 * KEYS: current window, previous window. ARGV: limit, window ms, ms elapsed in current window.
 * Returns {allowed (1/0), estimated count after this request}.
 */
const SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local estimated = previous * ((window - elapsed) / window) + current
if estimated + 1 > limit then
  return {0, math.ceil(estimated)}
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], window * 2)
return {1, math.ceil(estimated + 1)}
`;

export interface WindowResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window rolls over. */
  resetSeconds: number;
}

export async function consume(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<WindowResult> {
  const windowMs = windowSeconds * 1000;
  const index = Math.floor(nowMs / windowMs);
  const elapsed = nowMs - index * windowMs;
  const [allowed, estimated] = (await redis.eval(
    SCRIPT,
    2,
    `${key}:${index}`,
    `${key}:${index - 1}`,
    limit,
    windowMs,
    elapsed,
  )) as [number, number];
  return {
    allowed: allowed === 1,
    limit,
    remaining: Math.max(0, limit - estimated),
    resetSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
  };
}
