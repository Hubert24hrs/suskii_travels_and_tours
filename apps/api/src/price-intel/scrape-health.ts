import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { ScrapeVendor } from '@suskii/shared';

import { REDIS } from '../infra/redis';

/** How long a vendor's record on a site counts. */
const WINDOW_SECONDS = 24 * 60 * 60;
/** Attempts needed before the record reorders the policy's chain. */
export const HEALTH_MIN_SAMPLES = 5;

export interface VendorHealth {
  vendor: ScrapeVendor;
  attempts: number;
  successes: number;
  /** Mean time of an attempt in milliseconds. */
  meanMs: number;
  /** Micro-dollars spent per attempt that gave a usable page. */
  costPerSuccessMicroUsd: number | null;
}

const key = (vendor: string, domain: string): string => `pi:health:${vendor}:${domain}`;

/**
 * How each vendor has done on each site in the last day (ADR-102): attempts, successes, time and
 * cost, in Redis so every replica sees the same record. The router uses it to try the vendor
 * that works first, without leaving the vendors the policy allows.
 */
@Injectable()
export class ScrapeHealthBoard {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async record(
    vendor: ScrapeVendor,
    domain: string,
    outcome: { ok: boolean; durationMs: number; costMicroUsd: number },
  ): Promise<void> {
    const hash = key(vendor, domain);
    const pipeline = this.redis.multi();
    pipeline.hincrby(hash, 'attempts', 1);
    if (outcome.ok) pipeline.hincrby(hash, 'successes', 1);
    pipeline.hincrby(hash, 'ms', Math.max(0, Math.round(outcome.durationMs)));
    pipeline.hincrby(hash, 'cost', Math.max(0, Math.round(outcome.costMicroUsd)));
    pipeline.expire(hash, WINDOW_SECONDS);
    await pipeline.exec();
  }

  async of(vendors: readonly ScrapeVendor[], domain: string): Promise<VendorHealth[]> {
    const board: VendorHealth[] = [];
    for (const vendor of vendors) {
      const hash = await this.redis.hgetall(key(vendor, domain));
      const attempts = Number(hash.attempts ?? 0);
      const successes = Number(hash.successes ?? 0);
      board.push({
        vendor,
        attempts,
        successes,
        meanMs: attempts > 0 ? Math.round(Number(hash.ms ?? 0) / attempts) : 0,
        costPerSuccessMicroUsd:
          successes > 0 ? Math.round(Number(hash.cost ?? 0) / successes) : null,
      });
    }
    return board;
  }
}

/**
 * The policy's chain, reordered by the record: vendors with enough attempts sort by success
 * rate, then by cost for a usable page, then by time; vendors without a record keep the place
 * the policy gave them, and nobody outside the chain ever enters it.
 */
export function healthOrder(
  chain: readonly ScrapeVendor[],
  board: readonly VendorHealth[],
): ScrapeVendor[] {
  const byVendor = new Map(board.map((entry) => [entry.vendor, entry]));
  const score = (vendor: ScrapeVendor): number | null => {
    const entry = byVendor.get(vendor);
    if (!entry || entry.attempts < HEALTH_MIN_SAMPLES) return null;
    return entry.successes / entry.attempts;
  };
  return chain
    .map((vendor, index) => ({ vendor, index, score: score(vendor), entry: byVendor.get(vendor) }))
    .sort((a, b) => {
      // An unproven vendor counts as an even chance, so one bad record does not bury the rest.
      const rateA = a.score ?? 0.5;
      const rateB = b.score ?? 0.5;
      if (Math.abs(rateA - rateB) > 0.1) return rateB - rateA;
      const costA = a.entry?.costPerSuccessMicroUsd ?? null;
      const costB = b.entry?.costPerSuccessMicroUsd ?? null;
      if (
        a.score !== null &&
        b.score !== null &&
        costA !== null &&
        costB !== null &&
        costA !== costB
      ) {
        return costA - costB;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.vendor);
}
