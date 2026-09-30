import { useCallback } from 'react';

import type { Schemas } from '../lib/api';
import { attestationHeader } from '../lib/attestation';
import { tripStore } from '../lib/trips';

import { useApp } from './app-provider';

export type SignInOutcome =
  | { status: 'signed-in' }
  | { status: 'mfa'; challenge: Schemas['MfaChallenge'] }
  | { status: 'invalid' }
  | { status: 'locked' }
  | { status: 'error' };

const outcomeOf = (status: number): SignInOutcome =>
  status === 401
    ? { status: 'invalid' }
    : status === 429
      ? { status: 'locked' }
      : { status: 'error' };

/** Sign-in, MFA, registration and sign-out with token transport (ADR-020). */
export function useAuth() {
  const { api, session, user, queryClient } = useApp();

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInOutcome> => {
      const attestation = await attestationHeader(api);
      const { data, response } = await api.POST('/v1/auth/login', {
        params: attestation ? { header: { 'X-Suskii-Attestation': attestation } } : {},
        body: { email, password, transport: 'token' },
      });
      if (!data) return outcomeOf(response.status);
      if (data.status === 'mfa_required') return { status: 'mfa', challenge: data };
      await session.save(data);
      return { status: 'signed-in' };
    },
    [api, session],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string): Promise<SignInOutcome> => {
      const recovery = !/^\d{6}$/.test(code);
      const { data, response } = await api.POST('/v1/auth/mfa/verify', {
        body: recovery
          ? { mfaToken, recoveryCode: code, transport: 'token' }
          : { mfaToken, code, transport: 'token' },
      });
      if (!data) return outcomeOf(response.status);
      await session.save(data);
      return { status: 'signed-in' };
    },
    [api, session],
  );

  const register = useCallback(
    async (email: string, password: string): Promise<'accepted' | 'invalid' | 'error'> => {
      const attestation = await attestationHeader(api);
      const { response } = await api.POST('/v1/auth/register', {
        params: attestation ? { header: { 'X-Suskii-Attestation': attestation } } : {},
        body: { email, password },
      });
      return response.status === 202 ? 'accepted' : response.status < 500 ? 'invalid' : 'error';
    },
    [api],
  );

  /** Stops account pushes, revokes the refresh token, then forgets the account locally. */
  const signOut = useCallback(async (): Promise<void> => {
    const refreshToken = session.refreshToken();
    try {
      await api.DELETE('/v1/me/push-token');
      if (refreshToken) await api.POST('/v1/auth/logout', { body: { refreshToken } });
    } catch {
      // Offline: the session expires on the server; local state goes regardless.
    }
    tripStore.forgetAccount();
    queryClient.clear();
    await session.clear();
  }, [api, session, queryClient]);

  return { user, signIn, verifyMfa, register, signOut };
}
