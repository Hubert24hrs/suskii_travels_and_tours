import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomToken, sha256 } from '../crypto/random';
import type { AuthMethod, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';

import { CsrfService } from './csrf.service';
import { invalidToken, sessionRevoked } from './errors';
import { AccessTokenService } from './tokens/access-token.service';

/** Absolute session lifetime; refresh tokens also expire after REFRESH_TOKEN_TTL_DAYS idle. */
export const SESSION_MAX_AGE_DAYS = 90;
const DAY_MS = 86_400_000;
const REFRESH_TOKEN_PREFIX = 'srt_';

const AMR: Record<AuthMethod, string> = {
  password: 'pwd',
  otp: 'otp',
  google: 'google',
  apple: 'apple',
};

export const userWithRoles = { roles: { select: { roleKey: true } } } as const;
export type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRoles }>;

export interface IssuedSession {
  sessionId: string;
  sessionExpiresAt: Date;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  csrfToken: string;
  user: UserWithRoles;
}

export interface SessionSummary {
  id: string;
  authMethod: AuthMethod;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  mfaVerified: boolean;
  current: boolean;
}

type Tx = Prisma.TransactionClient;

const revokedKey = (sessionId: string): string => `auth:revoked-session:${sessionId}`;

/**
 * Sessions and refresh-token families. Every refresh rotates the token; presenting a rotated or
 * revoked token again is treated as theft: the whole session is revoked and the event audited.
 * Revocation reaches access tokens immediately through a Redis denylist checked by the guard.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tokens: AccessTokenService,
    private readonly csrf: CsrfService,
    private readonly hmac: HmacService,
    private readonly audit: AuditService,
  ) {}

  async start(params: {
    user: UserWithRoles;
    authMethod: AuthMethod;
    mfaVerified: boolean;
    context: RequestContext;
  }): Promise<IssuedSession> {
    const now = new Date();
    const { session, refresh } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: params.user.id,
          authMethod: params.authMethod,
          userAgent: params.context.userAgent ?? null,
          ipHash: this.hmac.digest('ip', params.context.ip),
          mfaVerifiedAt: params.mfaVerified ? now : null,
          expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_DAYS * DAY_MS),
        },
      });
      return { session: created, refresh: await this.createRefreshToken(tx, created, now) };
    });
    return this.issue(params.user, session, refresh);
  }

  private async createRefreshToken(
    tx: Tx,
    session: { id: string; expiresAt: Date },
    now: Date,
  ): Promise<{ raw: string; expiresAt: Date }> {
    const raw = `${REFRESH_TOKEN_PREFIX}${randomToken(32)}`;
    const idleExpiry = now.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS;
    const expiresAt = new Date(Math.min(idleExpiry, session.expiresAt.getTime()));
    await tx.refreshToken.create({
      data: { sessionId: session.id, tokenHash: sha256(raw), expiresAt },
    });
    return { raw, expiresAt };
  }

  private async issue(
    user: UserWithRoles,
    session: { id: string; authMethod: AuthMethod; mfaVerifiedAt: Date | null; expiresAt: Date },
    refresh: { raw: string; expiresAt: Date },
  ): Promise<IssuedSession> {
    const mfa = session.mfaVerifiedAt !== null;
    const { token, expiresAt } = await this.tokens.sign({
      sub: user.id,
      sid: session.id,
      roles: user.roles.map((role) => role.roleKey),
      mfa,
      amr: [AMR[session.authMethod], ...(mfa ? ['mfa'] : [])],
    });
    return {
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt,
      accessToken: token,
      accessTokenExpiresAt: expiresAt,
      refreshToken: refresh.raw,
      refreshTokenExpiresAt: refresh.expiresAt,
      csrfToken: this.csrf.issue(session.id),
      user,
    };
  }

  /** Looks up the session a refresh token belongs to, without rotating it (logout, CSRF). */
  async sessionIdForRefreshToken(raw: string): Promise<string | null> {
    if (!raw.startsWith(REFRESH_TOKEN_PREFIX)) return null;
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      select: { sessionId: true },
    });
    return record?.sessionId ?? null;
  }

  async rotate(raw: string, context: RequestContext): Promise<IssuedSession> {
    if (!raw.startsWith(REFRESH_TOKEN_PREFIX)) throw invalidToken();
    const now = new Date();
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { session: { include: { user: { include: userWithRoles } } } },
    });
    if (!record) throw invalidToken();
    const { session } = record;

    if (record.rotatedAt || record.revokedAt) {
      await this.handleReuse(session.id, session.userId, context);
      throw sessionRevoked();
    }
    if (
      session.revokedAt ||
      record.expiresAt <= now ||
      session.expiresAt <= now ||
      session.user.status !== 'active'
    ) {
      throw invalidToken();
    }

    const refresh = await this.prisma.$transaction(async (tx) => {
      // Conditional claim: of two concurrent refreshes with the same token, exactly one wins;
      // the loser is indistinguishable from a replay and revokes the family.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now },
      });
      if (claimed.count !== 1) return null;
      await tx.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
      return this.createRefreshToken(tx, session, now);
    });
    if (!refresh) {
      await this.handleReuse(session.id, session.userId, context);
      throw sessionRevoked();
    }
    return this.issue(session.user, session, refresh);
  }

  private async handleReuse(
    sessionId: string,
    userId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.revoke(sessionId, 'refresh_token_reuse');
    await this.audit.record({
      action: 'auth.refresh_token.reused',
      actorUserId: userId,
      targetType: 'session',
      targetId: sessionId,
      context,
      metadata: { response: 'session_revoked' },
    });
  }

  async revoke(sessionId: string, reason: string): Promise<boolean> {
    const now = new Date();
    const [sessions] = await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    // Outstanding access tokens live at most ACCESS_TOKEN_TTL_SECONDS.
    await this.redis.set(
      revokedKey(sessionId),
      reason,
      'EX',
      this.config.ACCESS_TOKEN_TTL_SECONDS + 60,
    );
    return sessions.count > 0;
  }

  /** Signs a user out everywhere (password reset, role change, account disable). */
  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const active = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      select: { id: true },
    });
    for (const { id } of active) await this.revoke(id, reason);
    return active.length;
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(revokedKey(sessionId))) === 1;
  }

  async markMfaVerified(sessionId: string): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { mfaVerifiedAt: new Date() },
    });
  }

  async list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      authMethod: session.authMethod,
      userAgent: session.userAgent,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      mfaVerified: session.mfaVerifiedAt !== null,
      current: session.id === currentSessionId,
    }));
  }

  async ownerOf(sessionId: string): Promise<string | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    return session?.userId ?? null;
  }

  /** True when the session belongs to the user (ownership check before revoking). */
  async belongsTo(sessionId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.session.count({ where: { id: sessionId, userId } });
    return count === 1;
  }
}
