import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { PasswordHasher } from '../crypto/password-hasher';
import { PrismaService } from '../infra/prisma.service';

import type { AuthContext } from './auth-context';
import type { ReauthProof, REAUTH_METHODS } from './auth.schemas';
import { invalidCredentials, invalidToken } from './errors';
import { LoginThrottleService } from './login-throttle.service';
import { MfaService } from './mfa.service';
import { OtpService } from './otp.service';

export type ReauthMethod = (typeof REAUTH_METHODS)[number];

/** Accounts with neither a password nor a verified phone prove themselves by signing in again. */
export const RECENT_SIGN_IN_MINUTES = 10;

export interface ReauthRequirements {
  method: ReauthMethod;
  mfa: boolean;
  recentSignInMinutes: number;
}

const reauthRequired = (requirements: ReauthRequirements): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNAUTHORIZED,
    'reauthentication-required',
    'Confirm it is you',
    requirements.method === 'recent_sign_in'
      ? `Sign in again, then retry within ${RECENT_SIGN_IN_MINUTES} minutes.`
      : 'Send the requested proof with this request.',
    { method: requirements.method, mfa: requirements.mfa },
  );

/**
 * A fresh proof of identity for requests that hand over or destroy the account's data (ADR-029):
 * the password (or a texted code without one, or a sign-in within the last few minutes for
 * Google or Apple accounts), plus a TOTP or recovery code when MFA is on. Failures count towards
 * the same lockouts as sign-in.
 */
@Injectable()
export class ReauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly throttle: LoginThrottleService,
    private readonly mfa: MfaService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
  ) {}

  async requirements(userId: string): Promise<ReauthRequirements> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, phone: true, phoneVerifiedAt: true },
    });
    if (!user) throw invalidToken();
    const method: ReauthMethod = user.passwordHash
      ? 'password'
      : user.phone && user.phoneVerifiedAt
        ? 'sms_code'
        : 'recent_sign_in';
    return {
      method,
      mfa: await this.mfa.isEnabled(userId),
      recentSignInMinutes: RECENT_SIGN_IN_MINUTES,
    };
  }

  /** Texts a code to the verified phone of an account that has no password. */
  async sendCode(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, phone: true, phoneVerifiedAt: true },
    });
    if (!user) throw invalidToken();
    if (user.passwordHash || !user.phone || !user.phoneVerifiedAt) {
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'reauth-code-unavailable',
        'No code needed',
        'This account confirms sensitive requests another way; see getReauthRequirements.',
      );
    }
    await this.otp.send(`reauth:${userId}`, user.phone);
  }

  /**
   * For changes to how the account signs in (phone number, authenticator enrolment, signing out
   * devices; ASVS 5.0 V7.5.1, V7.5.2): a full sign-in in the last few minutes is proof enough,
   * otherwise the same proof as `verify`.
   */
  async confirmRecent(
    auth: AuthContext,
    proof: ReauthProof | undefined,
    context: RequestContext,
  ): Promise<void> {
    if (await this.signedInRecently(auth.sessionId)) return;
    await this.verify(auth, proof ?? {}, context);
  }

  private async signedInRecently(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { createdAt: true },
    });
    return (
      session !== null &&
      session.createdAt.getTime() >= Date.now() - RECENT_SIGN_IN_MINUTES * 60_000
    );
  }

  async verify(auth: AuthContext, proof: ReauthProof, context: RequestContext): Promise<void> {
    const requirements = await this.requirements(auth.userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { passwordHash: true, phone: true },
    });

    switch (requirements.method) {
      case 'password': {
        if (!proof.password || !user.passwordHash) throw reauthRequired(requirements);
        const identifier = `user:${auth.userId}`;
        await this.throttle.assertNotLocked('password', identifier);
        if (!(await this.hasher.verify(user.passwordHash, proof.password))) {
          await this.throttle.recordFailure('password', identifier);
          await this.audit.record({
            action: 'account.reauth_failed',
            actorUserId: auth.userId,
            context,
            metadata: { method: 'password' },
          });
          throw invalidCredentials();
        }
        await this.throttle.reset('password', identifier);
        break;
      }
      case 'sms_code':
        if (!proof.code || !user.phone) throw reauthRequired(requirements);
        await this.otp.verify(`reauth:${auth.userId}`, user.phone, proof.code, context);
        break;
      case 'recent_sign_in':
        if (!(await this.signedInRecently(auth.sessionId))) throw reauthRequired(requirements);
        break;
    }

    if (requirements.mfa) {
      if (proof.mfaCode !== undefined) {
        await this.mfa.verifyProof(auth.userId, { code: proof.mfaCode }, context);
      } else if (proof.recoveryCode !== undefined) {
        await this.mfa.verifyProof(auth.userId, { recoveryCode: proof.recoveryCode }, context);
      } else {
        throw reauthRequired(requirements);
      }
    }
  }
}
