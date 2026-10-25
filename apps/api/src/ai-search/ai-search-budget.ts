import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { REDIS } from '../infra/redis';

import type { LlmUsage } from './llm-provider';

/** A day's spend outlives the day long enough for late settlements. */
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;
const MICROS_PER_MILLION_TOKENS = 1_000_000;

/**
 * Checks both caps and reserves in one step, so two concurrent requests cannot both pass a
 * check and overspend. Returns 0 when reserved, 1 over the caller's cap, 2 over the global cap.
 */
const RESERVE = `
local amount = tonumber(ARGV[1])
if tonumber(redis.call('GET', KEYS[1]) or '0') + amount > tonumber(ARGV[2]) then return 1 end
if tonumber(redis.call('GET', KEYS[2]) or '0') + amount > tonumber(ARGV[3]) then return 2 end
redis.call('INCRBY', KEYS[1], amount)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('INCRBY', KEYS[2], amount)
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 0
`;

/** Moves both counters by the difference between the actual and the reserved cost. */
const SETTLE = `
local delta = tonumber(ARGV[1])
for _, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then redis.call('INCRBY', key, delta) end
end
return 0
`;

export type BudgetRefusal = 'caller' | 'global';

export interface BudgetReservation {
  keys: [string, string];
  reserved: number;
}

/**
 * The per-user cost cap for AI trip search (ADR-061): spend per UTC day, in integer
 * micro-dollars, per signed-in user or per guest address (an HMAC), plus a global cap. Each
 * request reserves its worst case before calling the model and settles to the actual cost after.
 */
@Injectable()
export class AiSearchBudget {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The cost of a call from its usage, rounded up to a whole micro-dollar. */
  cost(usage: LlmUsage): number {
    const c = this.config;
    const total =
      usage.inputTokens * c.LLM_INPUT_MICROUSD_PER_MTOK +
      usage.outputTokens * c.LLM_OUTPUT_MICROUSD_PER_MTOK +
      usage.cacheReadTokens * c.LLM_CACHE_READ_MICROUSD_PER_MTOK +
      usage.cacheWriteTokens * c.LLM_CACHE_WRITE_MICROUSD_PER_MTOK;
    return Math.ceil(total / MICROS_PER_MILLION_TOKENS);
  }

  /**
   * The most a call can cost: every prompt token written to the cache (the dearer input rate)
   * plus the whole output allowance.
   */
  worstCase(promptTokens: number, maxOutputTokens: number): number {
    const inputRate = Math.max(
      this.config.LLM_INPUT_MICROUSD_PER_MTOK,
      this.config.LLM_CACHE_WRITE_MICROUSD_PER_MTOK,
    );
    return Math.ceil(
      (promptTokens * inputRate + maxOutputTokens * this.config.LLM_OUTPUT_MICROUSD_PER_MTOK) /
        MICROS_PER_MILLION_TOKENS,
    );
  }

  /** Reserves `amount` for `caller` (a user id or a guest HMAC), or says which cap refuses it. */
  async reserve(
    caller: string,
    amount: number,
    now: Date = new Date(),
  ): Promise<BudgetReservation | BudgetRefusal> {
    const day = now.toISOString().slice(0, 10);
    const keys: [string, string] = [
      `ai-search:spend:${day}:${caller}`,
      `ai-search:spend:${day}:all`,
    ];
    const result = await this.redis.eval(
      RESERVE,
      2,
      ...keys,
      amount,
      this.config.AI_SEARCH_USER_DAILY_MICROUSD,
      this.config.AI_SEARCH_GLOBAL_DAILY_MICROUSD,
      KEY_TTL_SECONDS,
    );
    if (result === 1) return 'caller';
    if (result === 2) return 'global';
    return { keys, reserved: amount };
  }

  /** Replaces the reservation with the actual cost (which may be lower or, rarely, higher). */
  async settle(reservation: BudgetReservation, actual: number): Promise<void> {
    const delta = actual - reservation.reserved;
    if (delta === 0) return;
    await this.redis.eval(SETTLE, 2, ...reservation.keys, delta);
  }
}
