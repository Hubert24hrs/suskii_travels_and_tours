import { Injectable } from '@nestjs/common';

import { passwordGuessableBy } from '@suskii/shared';

import { passwordBreached, passwordGuessable } from '../auth/errors';

import { BreachedPasswordChecker } from './breached-password';
import { COMMON_PASSWORDS_TEXT } from './common-passwords';

/** Lower-cased for comparison: "Password123!" is as weak as "password123!". */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set(COMMON_PASSWORDS_TEXT.split('\n'));

export interface PasswordContext {
  email?: string | null | undefined;
  displayName?: string | null | undefined;
}

/**
 * Checks a new password beyond its length (ASVS 5.0 V6.2.4, V6.2.11, V6.2.12), cheapest first:
 * the bundled list of the most used passwords (always on, so an HIBP outage or HIBP_ENABLED=false
 * never lets "1q2w3e4r5t" through), the brand words and the person's own details, then Have I
 * Been Pwned. Any composition is allowed otherwise (V6.2.5).
 */
@Injectable()
export class PasswordPolicy {
  constructor(private readonly breached: BreachedPasswordChecker) {}

  async check(password: string, context: PasswordContext = {}): Promise<void> {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) throw passwordBreached();
    const accountWords = [
      context.email?.split('@')[0],
      ...(context.displayName?.split(/\s+/) ?? []),
    ];
    if (passwordGuessableBy(password, accountWords)) throw passwordGuessable();
    if (await this.breached.isBreached(password)) throw passwordBreached();
  }
}
