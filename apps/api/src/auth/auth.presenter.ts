import type { Response } from 'express';

import type { AuthTransport } from '@suskii/shared';

import type { AppConfig } from '../config/config';

import type { AuthSessionDto, MfaChallengeDto } from './auth.schemas';
import { toAuthUser, type SignInOutcome } from './auth.service';
import { setSessionCookies } from './cookies';
import type { IssuedSession } from './session.service';

/** Cookie transport: tokens go into httpOnly cookies. Token transport: tokens go in the body. */
export function presentSession(
  session: IssuedSession,
  mfaEnabled: boolean,
  transport: AuthTransport,
  response: Response,
  config: AppConfig,
): AuthSessionDto {
  const base = {
    status: 'authenticated' as const,
    user: toAuthUser(session.user, mfaEnabled),
    sessionId: session.sessionId,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
  };
  if (transport === 'cookie') {
    setSessionCookies(response, config, session);
    return { ...base, csrfToken: session.csrfToken };
  }
  return { ...base, accessToken: session.accessToken, refreshToken: session.refreshToken };
}

export function presentSignIn(
  outcome: SignInOutcome,
  transport: AuthTransport,
  response: Response,
  config: AppConfig,
): AuthSessionDto | MfaChallengeDto {
  if (outcome.status === 'mfa_required') {
    return {
      status: 'mfa_required',
      mfaToken: outcome.challenge.mfaToken,
      expiresAt: outcome.challenge.expiresAt.toISOString(),
      methods: ['totp', 'recovery_code'],
    };
  }
  return presentSession(outcome.session, outcome.mfaEnabled, transport, response, config);
}
