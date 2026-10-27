import { useCallback } from 'react';
import { Platform } from 'react-native';

import type { Schemas } from '../lib/api';
import { forgetAccountData } from '../lib/account-data';
import { attestationHeader } from '../lib/attestation';
import { biometrics } from '../lib/biometric';
import { offlineScanner } from '../lib/offline-scan';
import type { ProviderToken, SocialProvider } from '../lib/social-sign-in';

import { useApp } from './app-provider';

export type SignInOutcome =
  | { status: 'signed-in' }
  | { status: 'mfa'; challenge: Schemas['MfaChallenge'] }
  | { status: 'invalid' }
  | { status: 'locked' }
  | { status: 'error' };

export type CodeRequest =
  | { status: 'sent'; resendAfterSeconds: number }
  | { status: 'invalid' }
  | { status: 'locked' }
  | { status: 'error' };

export type RegisterOutcome =
  | SignInOutcome
  /** Registered, but this password does not open the account: the email already had one. */
  | { status: 'existing' }
  | { status: 'weak' };

export type FingerprintOutcome = 'enabled' | 'reauth' | 'unavailable' | 'error';

const outcomeOf = (status: number): SignInOutcome =>
  status === 401
    ? { status: 'invalid' }
    : status === 429
      ? { status: 'locked' }
      : { status: 'error' };

/** Sign-in (password or texted code), MFA, registration and sign-out with token transport. */
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

  /** Texts a sign-in code; answers the same whether or not the number has an account. */
  const requestCode = useCallback(
    async (phone: string): Promise<CodeRequest> => {
      const { data, response } = await api.POST('/v1/auth/otp/request', { body: { phone } });
      if (data) return { status: 'sent', resendAfterSeconds: data.resendAfterSeconds };
      return response.status === 400
        ? { status: 'invalid' }
        : response.status === 429
          ? { status: 'locked' }
          : { status: 'error' };
    },
    [api],
  );

  /** Signs in (or creates the account) with a texted code; MFA still applies. */
  const verifyCode = useCallback(
    async (phone: string, code: string, referralCode?: string): Promise<SignInOutcome> => {
      const { data, response } = await api.POST('/v1/auth/otp/verify', {
        body: {
          phone,
          code,
          transport: 'token',
          ...(referralCode ? { referralCode } : {}),
        },
      });
      if (!data) return outcomeOf(response.status);
      if (data.status === 'mfa_required') return { status: 'mfa', challenge: data };
      await session.save(data);
      return { status: 'signed-in' };
    },
    [api, session],
  );

  /**
   * Creates the account, then signs straight in: the API lets an unconfirmed email sign in, and
   * always answers registration the same way, so a password that does not open the account means
   * the email already had one.
   */
  const register = useCallback(
    async (email: string, password: string, referralCode?: string): Promise<RegisterOutcome> => {
      const attestation = await attestationHeader(api);
      const { response, error } = await api.POST('/v1/auth/register', {
        params: attestation ? { header: { 'X-Suskii-Attestation': attestation } } : {},
        body: { email, password, ...(referralCode ? { referralCode } : {}) },
      });
      if (response.status === 202) {
        const outcome = await signIn(email, password);
        return outcome.status === 'invalid' ? { status: 'existing' } : outcome;
      }
      // Common, breached or built on the brand or the email (the API's password policy).
      const type = (error as { type?: unknown } | undefined)?.type;
      if (type === 'urn:suskii:problem:password-breached') return { status: 'weak' };
      if (type === 'urn:suskii:problem:password-guessable') return { status: 'weak' };
      return response.status < 500 ? { status: 'invalid' } : { status: 'error' };
    },
    [api, signIn],
  );

  /** Which sign-in providers to offer; null when the API cannot say. */
  const socialProviders = useCallback(async (): Promise<Schemas['SocialProviders'] | null> => {
    const { data } = await api.GET('/v1/auth/social/providers');
    return data ?? null;
  }, [api]);

  /** Signs in (or up) with a Google or Apple ID token; MFA still applies (ADR-067). */
  const socialSignIn = useCallback(
    async (
      provider: SocialProvider,
      token: Extract<ProviderToken, { status: 'token' }>,
      referralCode?: string,
    ): Promise<SignInOutcome> => {
      const body = {
        idToken: token.idToken,
        nonce: token.nonce,
        transport: 'token' as const,
        ...(token.bindingSecret ? { bindingSecret: token.bindingSecret } : {}),
        ...(token.displayName ? { displayName: token.displayName } : {}),
        ...(referralCode ? { referralCode } : {}),
      };
      const { data, response } =
        provider === 'google'
          ? await api.POST('/v1/auth/google', { body })
          : await api.POST('/v1/auth/apple', { body });
      if (!data) return outcomeOf(response.status);
      if (data.status === 'mfa_required') return { status: 'mfa', challenge: data };
      await session.save(data);
      return { status: 'signed-in' };
    },
    [api, session],
  );

  /**
   * Fingerprint sign-in: the system prompt unlocks this phone's device credential, which the API
   * trades for a session. A credential the API no longer accepts is forgotten ('expired').
   */
  const fingerprintSignIn = useCallback(
    async (
      prompt: string,
    ): Promise<SignInOutcome | { status: 'expired' } | { status: 'cancelled' }> => {
      const credential = await biometrics.read(prompt);
      if (credential === 'cancelled') return { status: 'cancelled' };
      if (!credential) return { status: 'expired' };
      const attestation = await attestationHeader(api);
      const { data, response } = await api.POST('/v1/auth/device', {
        params: attestation ? { header: { 'X-Suskii-Attestation': attestation } } : {},
        body: { ...credential, transport: 'token' },
      });
      if (!data) {
        if (response.status === 401) {
          await biometrics.forget();
          return { status: 'expired' };
        }
        return outcomeOf(response.status);
      }
      if (data.status === 'mfa_required') return { status: 'mfa', challenge: data };
      await session.save(data);
      return { status: 'signed-in' };
    },
    [api, session],
  );

  /** Turns fingerprint sign-in on for this phone; only soon after signing in. */
  const enableFingerprint = useCallback(
    async (prompt: string): Promise<FingerprintOutcome> => {
      if (!(await biometrics.available())) return 'unavailable';
      const { data, response } = await api.POST('/v1/me/device-credentials', {
        body: { label: Platform.OS === 'ios' ? 'iPhone' : 'Android' },
      });
      if (!data) return response.status === 401 ? 'reauth' : 'error';
      if (await biometrics.save(data, prompt)) return 'enabled';
      // The phone refused to store it: the API must not keep a credential nobody holds.
      await api.DELETE('/v1/me/device-credentials/{id}', {
        params: { path: { id: data.credentialId } },
      });
      return 'error';
    },
    [api],
  );

  /** Turns fingerprint sign-in off for this phone, here and at the API. */
  const disableFingerprint = useCallback(async (): Promise<void> => {
    const id = biometrics.credentialId();
    await biometrics.forget();
    if (id) {
      try {
        await api.DELETE('/v1/me/device-credentials/{id}', { params: { path: { id } } });
      } catch {
        // Offline: the credential is gone from the phone; the API's copy is useless without it.
      }
    }
  }, [api]);

  /** The signed-in account's data on this phone: trips, documents, scanning keys, queries, tokens. */
  const clearLocal = useCallback(async (): Promise<void> => {
    forgetAccountData(queryClient);
    await session.clear();
  }, [session, queryClient]);

  /** Forgets the account on this phone entirely (account deletion), fingerprint sign-in too. */
  const forgetAccount = useCallback(async (): Promise<void> => {
    await clearLocal();
    await biometrics.forget();
  }, [clearLocal]);

  /**
   * Uploads queued offline scans, stops account pushes, revokes the refresh token, then forgets
   * the account locally.
   */
  const signOut = useCallback(async (): Promise<void> => {
    const refreshToken = session.refreshToken();
    const agent = session.user?.id;
    try {
      // An operator agent's offline scans go up while the session still exists; without signal
      // they stay queued for this agent's next sign-in.
      if (agent && offlineScanner.pending(agent).length > 0) await offlineScanner.sync(api, agent);
      await api.DELETE('/v1/me/push-token');
      if (refreshToken) await api.POST('/v1/auth/logout', { body: { refreshToken } });
    } catch {
      // Offline: the session expires on the server; local state goes regardless.
    }
    // Fingerprint sign-in stays: it is how this person signs in again.
    await clearLocal();
  }, [api, session, clearLocal]);

  return {
    user,
    signIn,
    verifyMfa,
    requestCode,
    verifyCode,
    register,
    socialProviders,
    socialSignIn,
    fingerprintSignIn,
    enableFingerprint,
    disableFingerprint,
    signOut,
    forgetAccount,
  };
}
