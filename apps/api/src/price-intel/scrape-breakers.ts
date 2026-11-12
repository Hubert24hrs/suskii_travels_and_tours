import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import type { ScrapeFailureClass, ScrapeVendor } from '@suskii/shared';

import { REDIS } from '../infra/redis';

/** Failures of one vendor on one site within the window that open that pair's breaker. */
export const PAIR_FAILURE_THRESHOLD = 4;
/** Failures of one vendor across all sites within the window that open the vendor's breaker. */
export const VENDOR_FAILURE_THRESHOLD = 8;
export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_OPEN_MS = 60_000;
/** How long a vendor that says its quota is spent stays closed when it names no reset. */
export const QUOTA_OPEN_MS = 15 * 60_000;
const MAX_OPEN_MS = 60 * 60_000;

/** Counts a failure and opens the breaker when the window holds enough of them. */
const FAIL = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if count >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

const pairKey = (vendor: string, domain: string): string => `${vendor}:${domain}`;
const failKey = (subject: string): string => `pi:breaker:fail:${subject}`;
const openKey = (subject: string): string => `pi:breaker:open:${subject}`;

/** Failures that say something about the vendor's reach to the site, not about our parser. */
const COUNTED: ReadonlySet<ScrapeFailureClass> = new Set([
  'blocked',
  'timeout',
  'provider_error',
  'empty_or_unrendered',
]);
/** Failures that are the vendor's own, whatever the site. */
const VENDOR_WIDE: ReadonlySet<ScrapeFailureClass> = new Set(['timeout', 'provider_error']);

/**
 * Circuit breakers for web-data vendors (ADR-102), per vendor and per vendor and site, with
 * their state in Redis so every replica agrees. An open breaker closes by itself after its
 * time; the next failure inside a fresh window can open it again. The supplier breakers
 * (per process, ADR-009) are a different thing and are left alone.
 */
@Injectable()
export class ScrapeBreakers {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** True when the vendor, or the vendor on this site, is being skipped. Open when unreadable. */
  async isOpen(vendor: ScrapeVendor, domain: string): Promise<boolean> {
    try {
      const open = await this.redis.exists(openKey(vendor), openKey(pairKey(vendor, domain)));
      return open > 0;
    } catch {
      return true;
    }
  }

  async failure(vendor: ScrapeVendor, domain: string, failure: ScrapeFailureClass): Promise<void> {
    if (!COUNTED.has(failure)) return;
    const pair = pairKey(vendor, domain);
    await this.redis.eval(
      FAIL,
      2,
      failKey(pair),
      openKey(pair),
      BREAKER_WINDOW_MS,
      PAIR_FAILURE_THRESHOLD,
      BREAKER_OPEN_MS,
    );
    if (VENDOR_WIDE.has(failure)) {
      await this.redis.eval(
        FAIL,
        2,
        failKey(vendor),
        openKey(vendor),
        BREAKER_WINDOW_MS,
        VENDOR_FAILURE_THRESHOLD,
        BREAKER_OPEN_MS,
      );
    }
  }

  async success(vendor: ScrapeVendor, domain: string): Promise<void> {
    await this.redis.del(failKey(pairKey(vendor, domain)), failKey(vendor));
  }

  /** Opens the vendor's breaker until its quota resets (or a default, never more than an hour). */
  async openVendor(vendor: ScrapeVendor, forMs: number = QUOTA_OPEN_MS): Promise<void> {
    const ms = Math.max(1000, Math.min(MAX_OPEN_MS, Math.round(forMs)));
    await this.redis.set(openKey(vendor), '1', 'PX', ms);
  }

  /** True while the vendor's own breaker is open (on every site). Open when unreadable. */
  async vendorOpen(vendor: ScrapeVendor): Promise<boolean> {
    try {
      return (await this.redis.exists(openKey(vendor))) > 0;
    } catch {
      return true;
    }
  }

  /** Which of these vendors are open on the site right now, for the console. */
  async openAmong(vendors: readonly ScrapeVendor[], domain: string): Promise<ScrapeVendor[]> {
    const open: ScrapeVendor[] = [];
    for (const vendor of vendors) if (await this.isOpen(vendor, domain)) open.push(vendor);
    return open;
  }
}
