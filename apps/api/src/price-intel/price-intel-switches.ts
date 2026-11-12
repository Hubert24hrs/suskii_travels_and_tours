import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { SCRAPE_VENDORS, type ScrapeVendor } from '@suskii/shared';

import { REDIS } from '../infra/redis';

/** The Redis set of everything switched off: `global`, `vendor:<name>`, `domain:<domain>`. */
export const KILL_SWITCH_KEY = 'pi:kill';
export const KILL_SCOPES = ['global', 'vendor', 'domain'] as const;
export type KillScope = (typeof KILL_SCOPES)[number];

export interface KillSwitch {
  scope: KillScope;
  /** The vendor or the domain; null for the global switch. */
  subject: string | null;
}

const member = (scope: KillScope, subject: string | null): string =>
  scope === 'global' ? 'global' : `${scope}:${subject ?? ''}`;

/**
 * Stop buttons for price intelligence (ADR-102): everything, one vendor or one site. One Redis
 * set every instance reads before each attempt, so a switch takes effect within seconds. It
 * fails closed: when Redis cannot say, nothing is read.
 */
@Injectable()
export class PriceIntelSwitches {
  private readonly logger = new Logger(PriceIntelSwitches.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** True when reading `domain` with `vendor` is switched off, or the switches cannot be read. */
  async stopped(vendor: ScrapeVendor | null, domain: string): Promise<boolean> {
    const members = ['global', member('domain', domain)];
    if (vendor) members.push(member('vendor', vendor));
    try {
      const answers = await this.redis.smismember(KILL_SWITCH_KEY, ...members);
      return answers.some((answer) => answer === 1);
    } catch {
      this.logger.warn('Kill switches could not be read; nothing is read until they can');
      return true;
    }
  }

  async list(): Promise<KillSwitch[]> {
    const members = await this.redis.smembers(KILL_SWITCH_KEY);
    return members
      .map((entry): KillSwitch | null => {
        if (entry === 'global') return { scope: 'global', subject: null };
        const separator = entry.indexOf(':');
        const scope = entry.slice(0, separator);
        const subject = entry.slice(separator + 1);
        if (scope === 'vendor' && (SCRAPE_VENDORS as readonly string[]).includes(subject)) {
          return { scope, subject };
        }
        return scope === 'domain' && subject ? { scope, subject } : null;
      })
      .filter((entry): entry is KillSwitch => entry !== null)
      .sort((a, b) => member(a.scope, a.subject).localeCompare(member(b.scope, b.subject)));
  }

  /** Switches off. Returns false when it was off already. */
  async stop(scope: KillScope, subject: string | null): Promise<boolean> {
    return (await this.redis.sadd(KILL_SWITCH_KEY, member(scope, subject))) === 1;
  }

  /** Switches back on. Returns false when it was not off. */
  async release(scope: KillScope, subject: string | null): Promise<boolean> {
    return (await this.redis.srem(KILL_SWITCH_KEY, member(scope, subject))) === 1;
  }
}
