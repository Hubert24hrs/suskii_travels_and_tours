import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { isStaff } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { randomToken, sha256 } from '../crypto/random';
import type { AuthMethod, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { currentPrime } from '../prime/prime-status';

import { CsrfService } from './csrf.service';
import { invalidToken, sessionRevoked } from './errors';
import { AccessTokenService } from './tokens/access-token.service';

/** Absolute session lifetime; refresh tokens also expire after REFRESH_TOKEN_TTL_DAYS idle. */
export const SESSION_MAX_AGE_DAYS = 90;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
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

/** How long sessions of this account may live and how many it may hold (ADR-037). */
interface SessionPolicy {
  maxAgeMs: number;
  idleMs: number;
  maxActive: number;
  staff: boolean;
}

const revokedKey = (sessionId: string): string => `auth:revoked-session:${sessionId}`;

/** Sessions that can still be refreshed: not revoked, not expired, with a live refresh token. */
export function liveSessionWhere(now: Date): Prisma.SessionWhereInput {
  return {
    revokedAt: null,
    expiresAt: { gt: now },
    refreshTokens: { some: { rotatedAt: null, revokedAt: null, expiresAt: { gt: now } } },
  };
}

/**
 * Ends every session matching `where` in batches and denylists their access tokens; shared by
 * `SessionService` and the incident command (`sessions:revoke`). Returns the number ended.
 */
export async function revokeSessionsWhere(
  prisma: Pick<PrismaService, 'session' | 'refreshToken' | '$transaction'>,
  redis: Pick<Redis, 'pipeline'>,
  where: Prisma.SessionWhereInput,
  reason: string,
  accessTokenTtlSeconds: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    const batch = await prisma.session.findMany({
      where: { ...where, revokedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 500,
    });
    if (batch.length === 0) return total;
    const ids = batch.map((session) => session.id);
    const now = new Date();
    await prisma.$transaction([
      prisma.session.updateMany({
        where: { id: { in: ids }, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      }),
      prisma.refreshToken.updateMany({
        where: { sessionId: { in: ids }, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
    // Outstanding access tokens live at most ACCESS_TOKEN_TTL_SECONDS.
    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.set(revokedKey(id), reason, 'EX', accessTokenTtlSeconds + 60);
    await pipeline.exec();
    total += ids.length;
  }
}

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
    const policy = this.policyFor(params.user);
    const { session, refresh } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: params.user.id,
          authMethod: params.authMethod,
          userAgent: params.context.userAgent ?? null,
          ipHash: this.hmac.digest('ip', params.context.ip),
          mfaVerifiedAt: params.mfaVerified ? now : null,
          expiresAt: new Date(now.getTime() + policy.maxAgeMs),
        },
      });
      return { session: created, refresh: await this.createRefreshToken(tx, created, policy, now) };
    });
    await this.enforceLimit(params.user.id, session.id, policy, params.context);
    return this.issue(params.user, session, refresh);
  }

  /** Staff get short, idle-limited sessions and fewer devices; everyone else the defaults. */
  private policyFor(user: UserWithRoles): SessionPolicy {
    const staff = isStaff(user.roles.map((role) => role.roleKey));
    return staff
      ? {
          staff,
          maxAgeMs: this.config.STAFF_SESSION_MAX_HOURS * 60 * MINUTE_MS,
          idleMs: this.config.STAFF_SESSION_IDLE_MINUTES * MINUTE_MS,
          maxActive: this.config.STAFF_MAX_ACTIVE_SESSIONS,
        }
      : {
          staff,
          maxAgeMs: SESSION_MAX_AGE_DAYS * DAY_MS,
          idleMs: this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
          maxActive: this.config.MAX_ACTIVE_SESSIONS,
        };
  }

  /**
   * Concurrent-session cap (ASVS V7.1.2): beyond the policy's limit the least recently used live
   * sessions end, never the one just started, and each eviction is audited.
   */
  private async enforceLimit(
    userId: string,
    keepSessionId: string,
    policy: SessionPolicy,
    context: RequestContext,
  ): Promise<void> {
    const others = await this.prisma.session.findMany({
      where: { userId, id: { not: keepSessionId }, ...liveSessionWhere(new Date()) },
      select: { id: true },
      orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
    });
    for (const { id } of others.slice(policy.maxActive - 1)) {
      if (!(await this.revoke(id, 'session_limit'))) continue;
      await this.audit.record({
        action: 'auth.session.evicted',
        actorUserId: userId,
        targetType: 'session',
        targetId: id,
        context,
        metadata: { reason: 'session_limit', limit: policy.maxActive, staff: policy.staff },
      });
    }
  }

  private async createRefreshToken(
    tx: Tx,
    session: { id: string; expiresAt: Date },
    policy: SessionPolicy,
    now: Date,
  ): Promise<{ raw: string; expiresAt: Date }> {
    const raw = `${REFRESH_TOKEN_PREFIX}${randomToken(32)}`;
    const idleExpiry = now.getTime() + policy.idleMs;
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
    const prime = await currentPrime(this.prisma, user.id);
    const { token, expiresAt } = await this.tokens.sign({
      sub: user.id,
      sid: session.id,
      roles: user.roles.map((role) => role.roleKey),
      mfa,
      amr: [AMR[session.authMethod], ...(mfa ? ['mfa'] : [])],
      ...(prime
        ? {
            prm: {
              until: Math.floor(prime.until.getTime() / 1000),
              share: prime.benefits.markupShareBps,
              waived: prime.benefits.waivedFeeCodes,
              priority: prime.benefits.prioritySupport,
            },
          }
        : {}),
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
    // Roles are read again: an account that became staff gets the staff lifetime from now on.
    const policy = this.policyFor(session.user);
    if (
      session.revokedAt ||
      record.expiresAt <= now ||
      session.expiresAt <= now ||
      session.createdAt.getTime() + policy.maxAgeMs <= now.getTime() ||
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
      return this.createRefreshToken(tx, session, policy, now);
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
    const count = await revokeSessionsWhere(
      this.prisma,
      this.redis,
      { id: sessionId },
      reason,
      this.config.ACCESS_TOKEN_TTL_SECONDS,
    );
    // Denylist the access token even when the row is gone (account deletion removes it first).
    if (count === 0) {
      await this.redis.set(
        revokedKey(sessionId),
        reason,
        'EX',
        this.config.ACCESS_TOKEN_TTL_SECONDS + 60,
      );
    }
    return count > 0;
  }

  /** Signs a user out everywhere (password reset, role change, account disable, staff action). */
  async revokeAllForUser(
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    return revokeSessionsWhere(
      this.prisma,
      this.redis,
      { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      reason,
      this.config.ACCESS_TOKEN_TTL_SECONDS,
    );
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(revokedKey(sessionId))) === 1;
  }

  /** Records an authenticator check for the session (enrolment, step-up); returns its time. */
  async markMfaVerified(sessionId: string): Promise<Date> {
    const now = new Date();
    await this.prisma.session.update({ where: { id: sessionId }, data: { mfaVerifiedAt: now } });
    return now;
  }

  /** When step-up proof for the session runs out (null when it has none or it already ran out). */
  async stepUpUntil(sessionId: string): Promise<Date | null> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { mfaVerifiedAt: true },
    });
    if (!session?.mfaVerifiedAt) return null;
    const until = new Date(
      session.mfaVerifiedAt.getTime() + this.config.STEP_UP_WINDOW_MINUTES * MINUTE_MS,
    );
    return until > new Date() ? until : null;
  }

  async list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, ...liveSessionWhere(new Date()) },
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
