import { createHmac, hkdfSync, randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { safeEqual } from './random';

/** Each purpose gets its own derived key, so a digest for one use is useless for another. */
export type HmacPurpose =
  | 'ip'
  | 'csrf'
  | 'otp'
  | 'recovery-code'
  | 'identifier'
  | 'newsletter'
  | 'booking-access'
  | 'booking-email'
  | 'mock-payment';

const PURPOSES: readonly HmacPurpose[] = [
  'ip',
  'csrf',
  'otp',
  'recovery-code',
  'identifier',
  'newsletter',
  'booking-access',
  'booking-email',
  'mock-payment',
];
const HKDF_SALT = 'suskii-api:hmac:v1';

/**
 * Keyed hashing for low-entropy or personal values (IP addresses, OTP codes, emails used as
 * rate-limit keys). Keys are derived from HMAC_SECRET with HKDF-SHA256.
 */
@Injectable()
export class HmacService {
  private readonly keys = new Map<HmacPurpose, Buffer>();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    let master: Buffer;
    if (config.HMAC_SECRET) {
      master = Buffer.from(config.HMAC_SECRET, 'utf8');
    } else {
      // Production refuses to boot without HMAC_SECRET (env schema); dev and tests get a
      // per-process key, so hashes do not survive restarts.
      new Logger(HmacService.name).warn('HMAC_SECRET is not set; using an ephemeral key');
      master = randomBytes(32);
    }
    for (const purpose of PURPOSES) {
      this.keys.set(purpose, Buffer.from(hkdfSync('sha256', master, HKDF_SALT, purpose, 32)));
    }
  }

  digest(purpose: HmacPurpose, value: string): string {
    const key = this.keys.get(purpose);
    if (!key) throw new Error(`Unknown HMAC purpose: ${purpose}`);
    return createHmac('sha256', key).update(value).digest('base64url');
  }

  verify(purpose: HmacPurpose, value: string, expected: string): boolean {
    return safeEqual(this.digest(purpose, value), expected);
  }
}
