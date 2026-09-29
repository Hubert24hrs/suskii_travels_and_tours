import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { HmacService } from '../crypto/hmac.service';
import { randomDigits } from '../crypto/random';
import { REDIS } from '../infra/redis';
import { otpSmsBody } from '../notifications/templates';
import { SmsProvider } from '../notifications/sms';

import { invalidCode } from './errors';
import { LoginThrottleService } from './login-throttle.service';

export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_RESEND_SECONDS = 60;
const MAX_ATTEMPTS_PER_CODE = 5;

/** `sign-in` for passwordless phone sign-in; `verify-phone:<userId>` for adding a phone. */
export type OtpPurpose = 'sign-in' | `verify-phone:${string}`;

interface StoredCode {
  codeHash: string;
  attempts: number;
}

/**
 * Phone one-time codes: 6 digits, 5-minute TTL, stored as keyed hashes, at most 5 guesses per
 * code plus the lockout counter, and a 60-second resend cooldown per number.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly hmac: HmacService,
    private readonly sms: SmsProvider,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
  ) {}

  private keys(purpose: OtpPurpose, phone: string): { code: string; cooldown: string } {
    const id = this.hmac.digest('identifier', `${purpose}:${phone}`);
    return { code: `auth:otp:${id}`, cooldown: `auth:otp-cooldown:${id}` };
  }

  /** Sends a code unless one was sent in the last minute. The response is the same either way. */
  async send(purpose: OtpPurpose, phone: string): Promise<void> {
    const keys = this.keys(purpose, phone);
    const acquired = await this.redis.set(keys.cooldown, '1', 'EX', OTP_RESEND_SECONDS, 'NX');
    if (acquired !== 'OK') return;
    const code = randomDigits(6);
    const stored: StoredCode = {
      codeHash: this.hmac.digest('otp', `${phone}:${code}`),
      attempts: 0,
    };
    await this.redis.set(keys.code, JSON.stringify(stored), 'EX', OTP_TTL_SECONDS);
    await this.sms.send({
      to: phone,
      body: otpSmsBody(code),
      template: `otp:${purpose.split(':')[0]}`,
    });
  }

  /** Consumes the code on success; throws `invalid-code` (or 429 when locked) otherwise. */
  async verify(
    purpose: OtpPurpose,
    phone: string,
    code: string,
    context: RequestContext,
  ): Promise<void> {
    await this.throttle.assertNotLocked('otp', phone);
    const keys = this.keys(purpose, phone);
    const raw = await this.redis.get(keys.code);
    const stored = raw ? (JSON.parse(raw) as StoredCode) : null;
    if (stored && this.hmac.verify('otp', `${phone}:${code}`, stored.codeHash)) {
      // DEL returns 1 for exactly one concurrent verifier.
      if ((await this.redis.del(keys.code)) === 1) {
        await this.throttle.reset('otp', phone);
        return;
      }
    }
    if (stored) {
      const attempts = stored.attempts + 1;
      if (attempts >= MAX_ATTEMPTS_PER_CODE) await this.redis.del(keys.code);
      else await this.redis.set(keys.code, JSON.stringify({ ...stored, attempts }), 'KEEPTTL');
    }
    await this.throttle.recordFailure('otp', phone);
    await this.audit.record({
      action: 'auth.otp.failed',
      context,
      metadata: { purpose: purpose.split(':')[0] ?? purpose },
    });
    throw invalidCode();
  }
}
