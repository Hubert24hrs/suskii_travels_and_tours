import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { PrimeBenefits, Role } from '@suskii/shared';

import { authenticationRequired } from './errors';

/** The authenticated caller, attached to the request by the global AuthGuard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  roles: Role[];
  mfa: boolean;
  via: 'bearer' | 'cookie';
  /** Suskii Prime when the token was issued (ADR-030); null for non-members. */
  prime: { until: Date; benefits: PrimeBenefits } | null;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/** Injects the AuthContext; only valid on routes that are not `@Public()`. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw authenticationRequired();
    return auth;
  },
);
