import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { BackgroundTasks } from '../common/background-tasks';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { BreachedPasswordChecker } from '../crypto/breached-password';
import { PasswordHasher } from '../crypto/password-hasher';
import { randomToken, sha256 } from '../crypto/random';
import { Prisma, type AuthMethod, type VerificationPurpose } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { EmailProvider } from '../notifications/email';
import {
  accountExistsTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
} from '../notifications/templates';

import type { AuthUserDto } from './auth.schemas';
import { invalidCredentials, invalidOrExpiredLink, invalidToken, passwordBreached } from './errors';
import { LoginThrottleService } from './login-throttle.service';
import { MfaService, type MfaChallenge, type MfaProof } from './mfa.service';
import { OtpService } from './otp.service';
import {
  SessionService,
  userWithRoles,
  type IssuedSession,
  type UserWithRoles,
} from './session.service';
import { SocialIdentityVerifier, type SocialProviderName } from './social.service';

export type SignInOutcome =
  | { status: 'authenticated'; session: IssuedSession; mfaEnabled: boolean }
  | { status: 'mfa_required'; challenge: MfaChallenge };

const TOKEN_TTL_MS: Record<VerificationPurpose, number> = {
  email_verification: 24 * 60 * 60 * 1000,
  password_reset: 30 * 60 * 1000,
};

export function toAuthUser(user: UserWithRoles, mfaEnabled: boolean): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    phone: user.phone,
    phoneVerified: user.phoneVerifiedAt !== null,
    displayName: user.displayName,
    roles: user.roles.map((role) => role.roleKey),
    mfaEnabled,
    hasPassword: user.passwordHash !== null,
  };
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Authentication flows. Every path that could reveal whether an account exists (registration,
 * password reset, failed sign-in) answers identically and does account-specific work (emails)
 * after the response.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly hasher: PasswordHasher,
    private readonly breached: BreachedPasswordChecker,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly otp: OtpService,
    private readonly social: SocialIdentityVerifier,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly background: BackgroundTasks,
  ) {}

  // --- Email + password ---------------------------------------------------------

  async register(
    input: { email: string; password: string; displayName?: string | undefined },
    context: RequestContext,
  ): Promise<void> {
    if (await this.breached.isBreached(input.password)) throw passwordBreached();
    // Hash before looking the email up, so new and existing emails take the same time.
    const passwordHash = await this.hasher.hash(input.password);
    let user: { id: string; email: string | null } | null = null;
    try {
      user = await this.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          displayName: input.displayName ?? null,
          roles: { create: { roleKey: 'customer' } },
        },
        select: { id: true, email: true },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    if (!user) {
      this.background.run('account-exists-email', () =>
        this.email.send({
          to: input.email,
          ...accountExistsTemplate(`${this.config.WEB_APP_URL}/sign-in`),
        }),
      );
      return;
    }
    const created = user;
    await this.audit.record({
      action: 'auth.registered',
      actorUserId: created.id,
      context,
      metadata: { method: 'password' },
    });
    this.background.run('verification-email', () =>
      this.sendEmailVerification(created.id, input.email),
    );
  }

  async login(
    input: { email: string; password: string },
    context: RequestContext,
  ): Promise<SignInOutcome> {
    await this.throttle.assertNotLocked('password', input.email);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: userWithRoles,
    });
    const valid = user?.passwordHash
      ? await this.hasher.verify(user.passwordHash, input.password)
      : await this.hasher.verifyDummy(input.password);

    if (!user || !valid || user.status !== 'active') {
      const lockedForSeconds = await this.throttle.recordFailure('password', input.email);
      await this.audit.record({
        action: lockedForSeconds ? 'auth.login.locked' : 'auth.login.failed',
        actorUserId: user?.id ?? null,
        context,
        metadata: { method: 'password', ...(lockedForSeconds ? { lockedForSeconds } : {}) },
      });
      throw invalidCredentials();
    }
    await this.throttle.reset('password', input.email);
    if (user.passwordHash && this.hasher.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.hasher.hash(input.password) },
      });
    }
    return this.completeSignIn(user, 'password', context);
  }

  /** Second step of a sign-in for accounts with MFA. */
  async verifyMfa(
    mfaToken: string,
    proof: MfaProof,
    context: RequestContext,
  ): Promise<SignInOutcome> {
    const challenge = await this.mfa.completeChallenge(mfaToken, proof, context);
    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      include: userWithRoles,
    });
    if (user?.status !== 'active') throw invalidCredentials();
    return this.startSession(user, challenge.authMethod, true, context);
  }

  private async completeSignIn(
    user: UserWithRoles,
    method: AuthMethod,
    context: RequestContext,
  ): Promise<SignInOutcome> {
    if (await this.mfa.isEnabled(user.id)) {
      return { status: 'mfa_required', challenge: await this.mfa.createChallenge(user.id, method) };
    }
    return this.startSession(user, method, false, context);
  }

  private async startSession(
    user: UserWithRoles,
    method: AuthMethod,
    mfaVerified: boolean,
    context: RequestContext,
  ): Promise<SignInOutcome> {
    const session = await this.sessions.start({ user, authMethod: method, mfaVerified, context });
    await this.audit.record({
      action: 'auth.login.succeeded',
      actorUserId: user.id,
      targetType: 'session',
      targetId: session.sessionId,
      context,
      metadata: { method, mfa: mfaVerified },
    });
    return {
      status: 'authenticated',
      session,
      mfaEnabled: mfaVerified || (await this.mfa.isEnabled(user.id)),
    };
  }

  // --- Phone OTP ------------------------------------------------------------------

  requestSignInCode(phone: string): Promise<void> {
    return this.otp.send('sign-in', phone);
  }

  async verifySignInCode(
    phone: string,
    code: string,
    context: RequestContext,
  ): Promise<SignInOutcome> {
    await this.otp.verify('sign-in', phone, code, context);
    const now = new Date();
    let user = await this.prisma.user.findUnique({ where: { phone }, include: userWithRoles });
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: { phone, phoneVerifiedAt: now, roles: { create: { roleKey: 'customer' } } },
          include: userWithRoles,
        });
        await this.audit.record({
          action: 'auth.registered',
          actorUserId: user.id,
          context,
          metadata: { method: 'otp' },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        user = await this.prisma.user.findUniqueOrThrow({
          where: { phone },
          include: userWithRoles,
        });
      }
    }
    if (user.status !== 'active') throw invalidCredentials();
    return this.completeSignIn(user, 'otp', context);
  }

  // --- Google / Apple ---------------------------------------------------------------

  async socialSignIn(
    provider: SocialProviderName,
    input: { idToken: string; nonce?: string | undefined; displayName?: string | undefined },
    context: RequestContext,
  ): Promise<SignInOutcome> {
    const identity = await this.social.verify(provider, input.idToken, input.nonce);
    const linked = await this.prisma.socialIdentity.findUnique({
      where: { provider_subject: { provider, subject: identity.subject } },
      include: { user: { include: userWithRoles } },
    });
    let user = linked?.user ?? null;

    if (!user) {
      const email = identity.emailVerified ? identity.email : null;
      const existing = email
        ? await this.prisma.user.findUnique({ where: { email }, include: userWithRoles })
        : null;
      if (existing) {
        user = await this.linkToExisting(existing, identity.subject, provider, email, context);
      } else {
        user = await this.prisma.user.create({
          data: {
            email,
            emailVerifiedAt: email ? new Date() : null,
            displayName: input.displayName ?? identity.name,
            roles: { create: { roleKey: 'customer' } },
            socialIdentities: { create: { provider, subject: identity.subject, email } },
          },
          include: userWithRoles,
        });
        await this.audit.record({
          action: 'auth.registered',
          actorUserId: user.id,
          context,
          metadata: { method: provider },
        });
      }
    }
    if (user.status !== 'active') throw invalidCredentials();
    return this.completeSignIn(user, provider, context);
  }

  /**
   * Links a provider identity to an account with the same verified email. If that account never
   * verified its email, someone else may have pre-registered it (account pre-hijacking), so its
   * password is removed and its sessions revoked before linking.
   */
  private async linkToExisting(
    existing: UserWithRoles,
    subject: string,
    provider: SocialProviderName,
    email: string | null,
    context: RequestContext,
  ): Promise<UserWithRoles> {
    const unverified = existing.emailVerifiedAt === null;
    if (unverified)
      await this.sessions.revokeAllForUser(existing.id, 'social_link_takeover_protection');
    return this.prisma.$transaction(async (tx) => {
      await tx.socialIdentity.create({ data: { userId: existing.id, provider, subject, email } });
      const updated = await tx.user.update({
        where: { id: existing.id },
        data: unverified ? { passwordHash: null, emailVerifiedAt: new Date() } : {},
        include: userWithRoles,
      });
      await this.audit.record(
        {
          action: 'auth.social.linked',
          actorUserId: existing.id,
          context,
          metadata: { provider, clearedUnverifiedPassword: unverified },
        },
        tx,
      );
      return updated;
    });
  }

  // --- Email verification and password reset ------------------------------------------

  private async createVerificationToken(
    userId: string,
    purpose: VerificationPurpose,
  ): Promise<string> {
    const token = randomToken(32);
    await this.prisma.$transaction([
      this.prisma.verificationToken.deleteMany({ where: { userId, purpose, usedAt: null } }),
      this.prisma.verificationToken.create({
        data: {
          userId,
          purpose,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
        },
      }),
    ]);
    return token;
  }

  private async sendEmailVerification(userId: string, email: string): Promise<void> {
    const token = await this.createVerificationToken(userId, 'email_verification');
    const url = `${this.config.WEB_APP_URL}/verify-email#token=${token}`;
    await this.email.send({ to: email, ...verifyEmailTemplate(url) });
  }

  async resendEmailVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email || user.emailVerifiedAt) return;
    const email = user.email;
    this.background.run('verification-email', () => this.sendEmailVerification(userId, email));
  }

  /** Marks a token used exactly once and returns its user, or throws `invalid-or-expired-link`. */
  private async consumeVerificationToken(
    tx: Prisma.TransactionClient,
    token: string,
    purpose: VerificationPurpose,
  ): Promise<string> {
    const record = await tx.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (record?.purpose !== purpose) throw invalidOrExpiredLink();
    const claimed = await tx.verificationToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalidOrExpiredLink();
    return record.userId;
  }

  async verifyEmail(token: string, context: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const userId = await this.consumeVerificationToken(tx, token, 'email_verification');
      await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      await this.audit.record({ action: 'auth.email.verified', actorUserId: userId, context }, tx);
    });
  }

  forgotPassword(email: string): void {
    this.background.run('password-reset-email', async () => {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (user?.status !== 'active') return;
      const token = await this.createVerificationToken(user.id, 'password_reset');
      const url = `${this.config.WEB_APP_URL}/reset-password#token=${token}`;
      await this.email.send({ to: email, ...passwordResetTemplate(url) });
    });
  }

  async resetPassword(token: string, password: string, context: RequestContext): Promise<void> {
    if (await this.breached.isBreached(password)) throw passwordBreached();
    const passwordHash = await this.hasher.hash(password);
    const user = await this.prisma.$transaction(async (tx) => {
      const userId = await this.consumeVerificationToken(tx, token, 'password_reset');
      // Following the emailed link proves control of the address.
      const updated = await tx.user.update({
        where: { id: userId },
        data: { passwordHash, emailVerifiedAt: new Date() },
      });
      await this.audit.record({ action: 'auth.password.reset', actorUserId: userId, context }, tx);
      return updated;
    });
    await this.sessions.revokeAllForUser(user.id, 'password_reset');
    if (user.email) await this.throttle.reset('password', user.email);
  }

  async changePassword(
    auth: { userId: string; sessionId: string },
    input: { currentPassword: string; newPassword: string },
    context: RequestContext,
  ): Promise<void> {
    const identifier = `user:${auth.userId}`;
    await this.throttle.assertNotLocked('password', identifier);
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw invalidToken();
    if (!user.passwordHash) {
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'no-password-set',
        'This account has no password',
        'Use "forgot password" to set one.',
      );
    }
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      await this.throttle.recordFailure('password', identifier);
      throw invalidCredentials();
    }
    await this.throttle.reset('password', identifier);
    if (await this.breached.isBreached(input.newPassword)) throw passwordBreached();
    await this.prisma.user.update({
      where: { id: auth.userId },
      data: { passwordHash: await this.hasher.hash(input.newPassword) },
    });
    await this.sessions.revokeAllForUser(auth.userId, 'password_changed', auth.sessionId);
    await this.audit.record({ action: 'auth.password.changed', actorUserId: auth.userId, context });
  }

  // --- Profile ----------------------------------------------------------------------------

  /** A valid access token can outlive its user by up to 15 minutes: answer 401, not 500. */
  async getUser(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: userWithRoles,
    });
    if (!user) throw invalidToken();
    return toAuthUser(user, await this.mfa.isEnabled(userId));
  }

  async updateProfile(userId: string, displayName: string): Promise<AuthUserDto> {
    const updated = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { displayName },
    });
    if (updated.count === 0) throw invalidToken();
    return this.getUser(userId);
  }

  async requestPhoneVerification(userId: string, phone: string): Promise<void> {
    await this.otp.send(`verify-phone:${userId}`, phone);
  }

  async verifyPhone(
    userId: string,
    phone: string,
    code: string,
    context: RequestContext,
  ): Promise<AuthUserDto> {
    await this.otp.verify(`verify-phone:${userId}`, phone, code, context);
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { phone, phoneVerifiedAt: new Date() },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'phone-unavailable',
        'Phone number unavailable',
        'This number is linked to another account.',
      );
    }
    await this.audit.record({ action: 'auth.phone.verified', actorUserId: userId, context });
    return this.getUser(userId);
  }
}
