import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { BRAND, isStaff, type Role } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { FieldEncryption } from '../crypto/field-encryption';
import { HmacService } from '../crypto/hmac.service';
import { PasswordHasher } from '../crypto/password-hasher';
import { randomToken, safeEqual, sha256 } from '../crypto/random';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from '../crypto/totp';
import type { AuthMethod } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';

import { invalidCode } from './errors';
import { LoginThrottleService } from './login-throttle.service';

const CHALLENGE_TTL_SECONDS = 5 * 60;
const RECOVERY_CODE_COUNT = 10;

interface StoredChallenge {
  userId: string;
  authMethod: AuthMethod;
}

export interface MfaChallenge {
  mfaToken: string;
  expiresAt: Date;
}

export type MfaProof = { code: string } | { recoveryCode: string };

const challengeKey = (token: string): string => `auth:mfa-challenge:${sha256(token)}`;
const factorContext = (userId: string): string => `mfa-factor:${userId}:totp`;
const normaliseRecoveryCode = (code: string): string =>
  code.toLowerCase().replace(/[^a-z2-7]/g, '');

/** TOTP enrolment, verification with replay protection, recovery codes and sign-in challenges. */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly encryption: FieldEncryption,
    private readonly hmac: HmacService,
    private readonly throttle: LoginThrottleService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
  ) {}

  async isEnabled(userId: string): Promise<boolean> {
    const factor = await this.prisma.mfaFactor.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
      select: { confirmedAt: true },
    });
    return Boolean(factor?.confirmedAt);
  }

  // --- Sign-in challenge ------------------------------------------------------

  async createChallenge(userId: string, authMethod: AuthMethod): Promise<MfaChallenge> {
    const mfaToken = randomToken(32);
    const payload: StoredChallenge = { userId, authMethod };
    await this.redis.set(
      challengeKey(mfaToken),
      JSON.stringify(payload),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return { mfaToken, expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000) };
  }

  /** Verifies the second factor for a pending sign-in; the challenge is single-use. */
  async completeChallenge(
    mfaToken: string,
    proof: MfaProof,
    context: RequestContext,
  ): Promise<StoredChallenge> {
    const raw = await this.redis.get(challengeKey(mfaToken));
    if (!raw) throw invalidCode();
    const challenge = JSON.parse(raw) as StoredChallenge;
    await this.verifyProof(challenge.userId, proof, context);
    // GETDEL makes the challenge single-use even under concurrent submissions.
    const consumed = await this.redis.getdel(challengeKey(mfaToken));
    if (!consumed) throw invalidCode();
    return challenge;
  }

  /** Checks a TOTP or recovery code with lockout; throws `invalid-code` on failure. */
  async verifyProof(userId: string, proof: MfaProof, context: RequestContext): Promise<void> {
    await this.throttle.assertNotLocked('mfa', userId);
    const ok =
      'code' in proof
        ? await this.verifyTotpCode(userId, proof.code)
        : await this.consumeRecoveryCode(userId, proof.recoveryCode, context);
    if (!ok) {
      await this.throttle.recordFailure('mfa', userId);
      await this.audit.record({
        action: 'auth.mfa.challenge_failed',
        actorUserId: userId,
        context,
        metadata: { method: 'code' in proof ? 'totp' : 'recovery_code' },
      });
      throw invalidCode();
    }
    await this.throttle.reset('mfa', userId);
  }

  private async verifyTotpCode(userId: string, code: string): Promise<boolean> {
    const factor = await this.prisma.mfaFactor.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
    });
    if (!factor?.confirmedAt) return false;
    const secret = this.encryption.decrypt(factor.secretCiphertext, factorContext(userId));
    const lastUsedStep = factor.lastUsedStep === null ? null : Number(factor.lastUsedStep);
    const match = verifyTotp(secret, code, { lastUsedStep });
    if (!match) return false;
    // Conditional update: a concurrent request with the same code cannot also succeed.
    const updated = await this.prisma.mfaFactor.updateMany({
      where: {
        id: factor.id,
        OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(match.step) } }],
      },
      data: { lastUsedStep: BigInt(match.step) },
    });
    return updated.count === 1;
  }

  private async consumeRecoveryCode(
    userId: string,
    code: string,
    context: RequestContext,
  ): Promise<boolean> {
    const normalised = normaliseRecoveryCode(code);
    const unused = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    let matchId: string | null = null;
    for (const candidate of unused) {
      if (await this.recoveryCodeMatches(userId, candidate.codeHash, normalised)) {
        matchId = candidate.id;
        break;
      }
    }
    if (!matchId) return false;
    // Conditional on `usedAt: null`, so two concurrent uses of one code cannot both pass.
    const used = await this.prisma.mfaRecoveryCode.updateMany({
      where: { id: matchId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) return false;
    const remaining = await this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
    await this.audit.record({
      action: 'auth.mfa.recovery_code_used',
      actorUserId: userId,
      context,
      metadata: { remaining },
    });
    return true;
  }

  // --- Enrolment ----------------------------------------------------------------

  async startEnrolment(
    userId: string,
    account: string,
  ): Promise<{ secret: string; otpauthUri: string }> {
    if (await this.isEnabled(userId)) {
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'mfa-already-enabled',
        'MFA is already enabled',
      );
    }
    const secret = generateTotpSecret();
    const secretCiphertext = this.encryption.encrypt(secret, factorContext(userId));
    await this.prisma.mfaFactor.upsert({
      where: { userId_type: { userId, type: 'totp' } },
      create: { userId, type: 'totp', secretCiphertext },
      update: { secretCiphertext, confirmedAt: null, lastUsedStep: null },
    });
    return { secret, otpauthUri: otpauthUri({ secret, issuer: BRAND.shortName, account }) };
  }

  async confirmEnrolment(userId: string, code: string, context: RequestContext): Promise<string[]> {
    await this.throttle.assertNotLocked('mfa', userId);
    const factor = await this.prisma.mfaFactor.findUnique({
      where: { userId_type: { userId, type: 'totp' } },
    });
    if (!factor || factor.confirmedAt) {
      throw new ProblemDetailsException(
        HttpStatus.CONFLICT,
        'mfa-enrolment-not-started',
        'Start MFA enrolment first',
      );
    }
    const secret = this.encryption.decrypt(factor.secretCiphertext, factorContext(userId));
    const match = verifyTotp(secret, code);
    if (!match) {
      await this.throttle.recordFailure('mfa', userId);
      throw invalidCode();
    }
    await this.throttle.reset('mfa', userId);
    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      await tx.mfaFactor.update({
        where: { id: factor.id },
        data: { confirmedAt: new Date(), lastUsedStep: BigInt(match.step) },
      });
      const codes = await this.replaceRecoveryCodes(tx, userId);
      await this.audit.record({ action: 'auth.mfa.enabled', actorUserId: userId, context }, tx);
      return codes;
    });
    return recoveryCodes;
  }

  async regenerateRecoveryCodes(
    userId: string,
    proof: MfaProof,
    context: RequestContext,
  ): Promise<string[]> {
    await this.verifyProof(userId, proof, context);
    return this.prisma.$transaction(async (tx) => {
      const codes = await this.replaceRecoveryCodes(tx, userId);
      await this.audit.record(
        { action: 'auth.mfa.recovery_codes_regenerated', actorUserId: userId, context },
        tx,
      );
      return codes;
    });
  }

  async disable(
    userId: string,
    roles: Role[],
    proof: MfaProof,
    context: RequestContext,
  ): Promise<void> {
    if (isStaff(roles)) {
      throw new ProblemDetailsException(
        HttpStatus.FORBIDDEN,
        'mfa-mandatory',
        'MFA is mandatory for staff accounts',
      );
    }
    await this.verifyProof(userId, proof, context);
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaFactor.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await this.audit.record({ action: 'auth.mfa.disabled', actorUserId: userId, context }, tx);
    });
  }

  /**
   * Recovery codes carry 50 bits, below the 112 bits for which ASVS 5.0 V6.5.2 allows a plain
   * hash, so they are stored with argon2id (salted, slow). Codes issued before phase 11 were a
   * keyed HMAC and keep working until used or replaced.
   */
  private recoveryCodeMatches(
    userId: string,
    stored: string,
    normalised: string,
  ): Promise<boolean> {
    if (stored.startsWith('$argon2')) return this.hasher.verify(stored, normalised);
    return Promise.resolve(
      safeEqual(stored, this.hmac.digest('recovery-code', `${userId}:${normalised}`)),
    );
  }

  private async replaceRecoveryCodes(
    tx: Pick<PrismaService, 'mfaRecoveryCode'>,
    userId: string,
  ): Promise<string[]> {
    // 10 codes of 50 bits each, formatted xxxxx-xxxxx for readability.
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = base32Encode(crypto.getRandomValues(new Uint8Array(7)))
        .slice(0, 10)
        .toLowerCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    const hashes = await Promise.all(
      codes.map((code) => this.hasher.hash(normaliseRecoveryCode(code))),
    );
    await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    await tx.mfaRecoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    });
    return codes;
  }
}
