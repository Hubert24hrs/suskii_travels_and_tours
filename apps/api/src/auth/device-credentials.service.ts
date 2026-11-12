import { HttpStatus, Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { HmacService } from '../crypto/hmac.service';
import { randomToken } from '../crypto/random';
import { PrismaService } from '../infra/prisma.service';

import type { AuthContext } from './auth-context';
import { invalidCredentials } from './errors';
import { RECENT_SIGN_IN_MINUTES } from './reauth.service';

/** Phones with fingerprint sign-in per account; turning it on for another retires the oldest. */
export const MAX_DEVICE_CREDENTIALS = 5;

export interface DeviceCredentialSummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const notFound = (): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.NOT_FOUND, 'not-found', 'Not found');

/**
 * Fingerprint sign-in (ADR-067). A phone that turns it on gets a random secret once, keeps it in
 * its secure store behind the biometric prompt, and later trades it for a session. The API keeps
 * only an HMAC of the id and secret. A credential is created only from a session started in the
 * last few minutes, ends with every session of the account (`revokeForUser`), and signs in like
 * any other method: MFA still applies.
 */
@Injectable()
export class DeviceCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hmac: HmacService,
    private readonly audit: AuditService,
  ) {}

  private digest(id: string, secret: string): string {
    return this.hmac.digest('device-credential', `${id}:${secret}`);
  }

  async create(
    auth: AuthContext,
    label: string,
    context: RequestContext,
  ): Promise<{ credentialId: string; secret: string }> {
    const session = await this.prisma.session.findUnique({
      where: { id: auth.sessionId },
      select: { createdAt: true },
    });
    if (!session || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MINUTES * 60_000) {
      throw new ProblemDetailsException(
        HttpStatus.UNAUTHORIZED,
        'reauthentication-required',
        'Confirm it is you',
        `Sign in again, then turn on fingerprint sign-in within ${RECENT_SIGN_IN_MINUTES} minutes.`,
        { method: 'recent_sign_in', mfa: false },
      );
    }
    const id = uuidv7();
    const secret = randomToken(32);
    await this.prisma.$transaction(async (tx) => {
      const active = await tx.deviceCredential.findMany({
        where: { userId: auth.userId, revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      const retired = active.slice(MAX_DEVICE_CREDENTIALS - 1).map((credential) => credential.id);
      if (retired.length > 0) {
        await tx.deviceCredential.updateMany({
          where: { id: { in: retired } },
          data: { revokedAt: new Date() },
        });
      }
      await tx.deviceCredential.create({
        data: { id, userId: auth.userId, secretHash: this.digest(id, secret), label },
      });
      await this.audit.record(
        {
          action: 'auth.device_credential.created',
          actorUserId: auth.userId,
          targetType: 'device_credential',
          targetId: id,
          context,
          metadata: { retired: retired.length },
        },
        tx,
      );
    });
    return { credentialId: id, secret };
  }

  async list(userId: string): Promise<DeviceCredentialSummary[]> {
    const rows = await this.prisma.deviceCredential.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /** Turns fingerprint sign-in off for one phone; other people's credentials are not found. */
  async revoke(auth: AuthContext, id: string, context: RequestContext): Promise<void> {
    const { count } = await this.prisma.deviceCredential.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw notFound();
    await this.audit.record({
      action: 'auth.device_credential.revoked',
      actorUserId: auth.userId,
      targetType: 'device_credential',
      targetId: id,
      context,
      metadata: { reason: 'user' },
    });
  }

  /** The account a valid, unrevoked credential belongs to; anything else is "invalid". */
  async verify(credentialId: string, secret: string): Promise<string> {
    const credential = await this.prisma.deviceCredential.findUnique({
      where: { id: credentialId },
    });
    // Same work whether or not the id exists, so timing does not tell them apart.
    const expected = credential?.secretHash ?? this.digest(credentialId, 'absent');
    const matches = this.hmac.verify('device-credential', `${credentialId}:${secret}`, expected);
    if (!credential || !matches || credential.revokedAt) throw invalidCredentials();
    await this.prisma.deviceCredential.update({
      where: { id: credential.id },
      data: { lastUsedAt: new Date() },
    });
    return credential.userId;
  }
}
