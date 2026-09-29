import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { HmacService } from '../crypto/hmac.service';
import { REDIS } from '../infra/redis';

import { tooManyAttempts } from './errors';

/** Credential-guessing surfaces with their own counters. */
export type ThrottleScope = 'password' | 'mfa' | 'otp';

const FREE_ATTEMPTS = 5;
const BASE_LOCK_SECONDS = 30;
const MAX_LOCK_SECONDS = 15 * 60;
const FAILURE_WINDOW_SECONDS = 60 * 60;

/**
 * Account lockout with exponential backoff: after 5 failures within an hour, each further failure
 * locks the identifier for 30s, 60s, 120s ... up to 15 minutes. Identifiers are HMAC'd (no emails
 * or phone numbers in Redis) and unknown accounts are throttled exactly like real ones, so the
 * lockout never reveals whether an account exists.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly hmac: HmacService,
  ) {}

  private keys(scope: ThrottleScope, identifier: string): { failures: string; lock: string } {
    const id = this.hmac.digest('identifier', `${scope}:${identifier.toLowerCase()}`);
    return { failures: `auth:failures:${scope}:${id}`, lock: `auth:lock:${scope}:${id}` };
  }

  /** Throws 429 with Retry-After while the identifier is locked. */
  async assertNotLocked(scope: ThrottleScope, identifier: string): Promise<void> {
    const ttl = await this.redis.pttl(this.keys(scope, identifier).lock);
    if (ttl > 0) throw tooManyAttempts(Math.ceil(ttl / 1000));
  }

  /** Records a failure; returns the lock duration in seconds when this failure triggered one. */
  async recordFailure(scope: ThrottleScope, identifier: string): Promise<number | null> {
    const keys = this.keys(scope, identifier);
    const [[, count]] = (await this.redis
      .multi()
      .incr(keys.failures)
      .expire(keys.failures, FAILURE_WINDOW_SECONDS, 'NX')
      .exec()) as [[Error | null, number]];
    if (count < FREE_ATTEMPTS) return null;
    const seconds = Math.min(BASE_LOCK_SECONDS * 2 ** (count - FREE_ATTEMPTS), MAX_LOCK_SECONDS);
    await this.redis.set(keys.lock, '1', 'EX', seconds);
    return seconds;
  }

  async reset(scope: ThrottleScope, identifier: string): Promise<void> {
    const keys = this.keys(scope, identifier);
    await this.redis.del(keys.failures, keys.lock);
  }
}
