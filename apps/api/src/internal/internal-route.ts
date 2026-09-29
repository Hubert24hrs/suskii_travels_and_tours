import {
  applyDecorators,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { Public } from '../auth/decorators';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { safeEqual } from '../crypto/random';

export const IS_INTERNAL = 'suskii:internal-route';

/**
 * Service-to-service authentication for `/v1/internal` (the worker, ADR-011): a bearer token
 * equal to INTERNAL_API_TOKEN, compared in constant time. Without a configured token the routes
 * do not exist (404), so a forgotten variable never opens them.
 */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.INTERNAL_API_TOKEN;
    if (!expected) throw new NotFoundException();
    const header = context.switchToHttp().getRequest<Request>().headers.authorization;
    const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!presented || !safeEqual(presented, expected)) {
      throw new ProblemDetailsException(
        HttpStatus.UNAUTHORIZED,
        'invalid-service-token',
        'A valid service token is required',
      );
    }
    return true;
  }
}

/** Not user-authenticated; requires the internal service token instead. */
export const InternalRoute = (): ClassDecorator & MethodDecorator =>
  applyDecorators(Public(), SetMetadata(IS_INTERNAL, true), UseGuards(InternalTokenGuard));
