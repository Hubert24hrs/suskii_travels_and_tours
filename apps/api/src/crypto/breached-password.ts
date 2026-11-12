import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

/** Checks a candidate password against known breach corpora. */
export abstract class BreachedPasswordChecker {
  abstract isBreached(password: string): Promise<boolean>;
}

const RANGE_API = 'https://api.pwnedpasswords.com/range/';

/**
 * Have I Been Pwned range API with k-anonymity: only the first 5 hex characters of the SHA-1
 * are sent, with response padding enabled. Fails open (logs a warning) when the service is
 * unreachable, so an outage cannot block sign-ups; the length policy still applies.
 */
export class HibpBreachedPasswordChecker extends BreachedPasswordChecker {
  private readonly logger = new Logger(HibpBreachedPasswordChecker.name);

  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {
    super();
  }

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    try {
      const response = await this.fetchImpl(`${RANGE_API}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'suskii-api' },
        redirect: 'error',
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error(`HIBP responded ${response.status}`);
      const body = await response.text();
      return body.split('\n').some((line) => {
        const [candidate, count] = line.trim().split(':');
        return candidate === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.logger.warn(`Breached-password check skipped: ${(error as Error).message}`);
      return false;
    }
  }
}

/** Used when HIBP_ENABLED=false (offline development, tests). */
@Injectable()
export class DisabledBreachedPasswordChecker extends BreachedPasswordChecker {
  isBreached(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
