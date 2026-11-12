import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Redis } from 'ioredis';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { ProblemDetailsException } from '../common/problem-details';
import { requestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { HmacService } from '../crypto/hmac.service';
import { REDIS } from '../infra/redis';

import { RATE_LIMIT_POLICIES, SKIP_RATE_LIMIT, type RateLimitPolicy } from './rate-limit.decorator';
import { consume, type WindowResult } from './sliding-window';

/** Every route: per caller (user, else IP) per route. */
const DEFAULT_ROUTE_POLICY = { limit: 120, windowSeconds: 60 };
/** Every request from one IP across all routes. */
const GLOBAL_IP_POLICY: RateLimitPolicy = {
  name: 'global-ip',
  limit: 600,
  windowSeconds: 60,
  by: 'ip',
};

/**
 * Redis sliding-window rate limits per IP, user and route. Responses carry RateLimit-Limit,
 * RateLimit-Remaining and RateLimit-Reset for the tightest policy; rejections are 429
 * problem+json with Retry-After. Fails open if Redis is unreachable (logged), so an outage of the
 * limiter cannot take the API down.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly hmac: HmacService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.config.RATE_LIMIT_ENABLED || context.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean | undefined>(SKIP_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const routeId = `${context.getClass().name}.${context.getHandler().name}`;
    const custom =
      this.reflector.getAllAndOverride<RateLimitPolicy[] | undefined>(RATE_LIMIT_POLICIES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const policies: RateLimitPolicy[] = [
      GLOBAL_IP_POLICY,
      { name: `route:${routeId}`, ...DEFAULT_ROUTE_POLICY, by: request.auth ? 'user' : 'ip' },
      ...custom,
    ];

    let tightest: WindowResult | null = null;
    try {
      for (const policy of policies) {
        const subject = this.subject(policy, request);
        if (!subject) continue;
        const result = await consume(
          this.redis,
          `rl:${policy.name}:${subject}`,
          policy.limit,
          policy.windowSeconds,
        );
        if (!result.allowed) {
          this.setHeaders(response, result);
          throw new ProblemDetailsException(
            HttpStatus.TOO_MANY_REQUESTS,
            'rate-limited',
            'Too many requests',
            'Slow down and try again later.',
            { retryAfterSeconds: result.resetSeconds },
            { 'Retry-After': String(result.resetSeconds) },
          );
        }
        if (!tightest || result.remaining / result.limit < tightest.remaining / tightest.limit) {
          tightest = result;
        }
      }
    } catch (error) {
      if (error instanceof ProblemDetailsException) throw error;
      this.logger.warn(`Rate limiter unavailable, failing open: ${(error as Error).message}`);
      return true;
    }
    if (tightest) this.setHeaders(response, tightest);
    return true;
  }

  private subject(policy: RateLimitPolicy, request: AuthenticatedRequest): string | null {
    if (policy.by === 'ip') return this.hmac.digest('ip', requestContext(request).ip);
    if (policy.by === 'user') {
      return request.auth
        ? `u:${request.auth.userId}`
        : this.hmac.digest('ip', requestContext(request).ip);
    }
    const body = request.body as Record<string, unknown> | undefined;
    const value = body?.[policy.by.body];
    if (typeof value !== 'string' || value.length === 0) return null;
    return this.hmac.digest('identifier', `${policy.by.body}:${value.trim().toLowerCase()}`);
  }

  private setHeaders(response: Response, result: WindowResult): void {
    response.setHeader('RateLimit-Limit', String(result.limit));
    response.setHeader('RateLimit-Remaining', String(result.remaining));
    response.setHeader('RateLimit-Reset', String(result.resetSeconds));
  }
}
