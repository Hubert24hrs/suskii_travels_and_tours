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
import {
  INTERNAL_SECURITY,
  IS_INTERNAL,
  type InternalSecurityScheme,
} from '../internal/internal-route';

import { agentEnabled } from './agent-flags';

/**
 * Authentication of the agent service on the tool gateway (ADR-101): a bearer token equal to
 * AGENT_TOOLS_TOKEN, compared in constant time. It is a token of its own, so the agent service
 * cannot call the worker's internal routes and the worker cannot call tools. While the
 * assistant is off, or no token is configured, the routes do not exist (404).
 */
@Injectable()
export class AgentToolsTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.AGENT_TOOLS_TOKEN;
    if (!expected || !agentEnabled(this.config)) throw new NotFoundException();
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

/** Not user-authenticated; requires the agent service's own token. */
export const AgentServiceRoute = (): ClassDecorator & MethodDecorator =>
  applyDecorators(
    Public(),
    SetMetadata(IS_INTERNAL, true),
    SetMetadata(INTERNAL_SECURITY, 'agentToolsToken' satisfies InternalSecurityScheme),
    UseGuards(AgentToolsTokenGuard),
  );
