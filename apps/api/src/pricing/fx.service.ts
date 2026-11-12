import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  convert,
  crossRate,
  formatRate,
  identityRate,
  parseRate,
  type ExchangeRate,
  type Money,
  type RoundingMode,
} from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { REDIS } from '../infra/redis';

import { FxProvider, type FxSnapshot } from './fx';

const MEMORY_TTL_MS = 60_000;
/** A last-known-good snapshot may be used for a day if the provider is down. */
const MAX_STALE_MS = 24 * 60 * 60 * 1000;

export interface RateQuote {
  rate: ExchangeRate;
  asOf: string;
  provider: string;
}

/** Converts with one snapshot, so every line of a price uses the same rates. */
export interface Converter {
  convert(amount: Money, to: string, rounding?: RoundingMode): Money;
  rate(from: string, to: string): RateQuote;
  describe(
    from: string,
    to: string,
  ): { from: string; to: string; rate: string; asOf: string; provider: string } | null;
}

const unavailable = (currency: string): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'fx-rate-unavailable',
    'Currency not available',
    `No exchange rate is available for ${currency} right now.`,
  );

/** Exact rational cross rates through the snapshot's base; rounding happens once per line. */
export function createConverter(snapshot: FxSnapshot): Converter {
  const baseRate = (currency: string): ExchangeRate => {
    const decimal = snapshot.rates[currency];
    if (!decimal) throw unavailable(currency);
    return parseRate(snapshot.base, currency, decimal);
  };
  const rate = (from: string, to: string): RateQuote => ({
    rate: from === to ? identityRate(from) : crossRate(baseRate(from), baseRate(to)),
    asOf: snapshot.asOf,
    provider: snapshot.provider,
  });
  return {
    rate,
    convert: (amount, to, rounding = 'half-up') =>
      amount.currency === to ? amount : convert(amount, rate(amount.currency, to).rate, rounding),
    describe: (from, to) =>
      from === to
        ? null
        : {
            from,
            to,
            rate: formatRate(rate(from, to).rate, 10),
            asOf: snapshot.asOf,
            provider: snapshot.provider,
          },
  };
}

/**
 * Exchange rates with three layers: process memory (1 minute), Redis (FX_CACHE_TTL_SECONDS,
 * shared by instances) and a last-known-good copy used for up to 24 hours when the provider fails.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private memory: { snapshot: FxSnapshot; expires: number } | undefined;

  constructor(
    private readonly provider: FxProvider,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private key(kind: 'current' | 'last'): string {
    return `fx:${kind}:${this.provider.name}`;
  }

  async snapshot(): Promise<FxSnapshot> {
    const now = Date.now();
    if (this.memory && this.memory.expires > now) return this.memory.snapshot;

    const cached = await this.redis.get(this.key('current'));
    let snapshot = cached ? (JSON.parse(cached) as FxSnapshot) : undefined;
    if (!snapshot) {
      try {
        snapshot = await this.provider.latest(AbortSignal.timeout(5000));
        const payload = JSON.stringify(snapshot);
        await this.redis
          .multi()
          .set(this.key('current'), payload, 'EX', this.config.FX_CACHE_TTL_SECONDS)
          .set(this.key('last'), payload)
          .exec();
      } catch (error) {
        const last = await this.redis.get(this.key('last'));
        const fallback = last ? (JSON.parse(last) as FxSnapshot) : undefined;
        if (!fallback || now - Date.parse(fallback.asOf) > MAX_STALE_MS) throw error;
        this.logger.warn(
          `FX provider failed, using rates from ${fallback.asOf}: ${(error as Error).message}`,
        );
        snapshot = fallback;
      }
    }
    this.memory = { snapshot, expires: now + MEMORY_TTL_MS };
    return snapshot;
  }

  /** A converter bound to the current snapshot. */
  async converter(): Promise<Converter> {
    return createConverter(await this.snapshot());
  }
}
