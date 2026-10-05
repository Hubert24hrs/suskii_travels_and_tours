import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { APP_CONFIG, type AppConfig } from '../config/config';

import type { AuthContext, AuthenticatedRequest } from './auth-context';
import { readCookie, sessionCookieNames } from './cookies';
import { CsrfService } from './csrf.service';
import { IS_PUBLIC } from './decorators';
import { authenticationRequired, csrfFailed, invalidToken, sessionRevoked } from './errors';
import { SessionService } from './session.service';
import { AccessTokenService } from './tokens/access-token.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global, deny-by-default authentication. Accepts a bearer access token (mobile) or the access
 * cookie (web). Cookie-authenticated state-changing requests must carry a CSRF token bound to the
 * session. Revoked sessions are rejected immediately. On `@Public()` routes a missing or invalid
 * credential simply leaves the request anonymous.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly csrf: CsrfService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const isPublic =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    try {
      request.auth = await this.authenticate(request);
    } catch (error) {
      if (isPublic) return true;
      throw error;
    }
    if (!request.auth && !isPublic) throw authenticationRequired();
    return true;
  }

  private async authenticate(request: AuthenticatedRequest): Promise<AuthContext | undefined> {
    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : undefined;
    const cookie = readCookie(request, sessionCookieNames(this.config).access);
    const token = bearer ?? cookie;
    if (!token) return undefined;
    const via = bearer ? 'bearer' : 'cookie';

    let claims;
    try {
      claims = await this.tokens.verify(token);
    } catch {
      throw invalidToken();
    }
    if (await this.sessions.isRevoked(claims.sid)) throw sessionRevoked();

    if (via === 'cookie' && !SAFE_METHODS.has(request.method)) {
      const csrfHeader = request.headers['x-csrf-token'];
      const csrfToken = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
      if (!this.csrf.verify(claims.sid, csrfToken)) throw csrfFailed();
    }
    return {
      userId: claims.sub,
      sessionId: claims.sid,
      roles: claims.roles,
      mfa: claims.mfa,
      via,
      prime: claims.prm
        ? {
            until: new Date(claims.prm.until * 1000),
            benefits: {
              markupShareBps: claims.prm.share,
              waivedFeeCodes: claims.prm.waived,
              prioritySupport: claims.prm.priority,
            },
          }
        : null,
    };
  }
}
