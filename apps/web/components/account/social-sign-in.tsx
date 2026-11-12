'use client';

import { Button, Dialog, DialogContent, Input } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, type Schemas } from '../../lib/browser-api';
import { publicEnv } from '../../lib/env';
import { rememberSession } from '../../lib/session';
import {
  authorizeUrl,
  CALLBACK_PATH,
  randomState,
  savePending,
  SOCIAL_PROVIDERS,
  type SocialProvider,
} from '../../lib/social-sign-in';

import { useAccountT } from './account-messages';
import { safeNext } from './use-account';

type SignInResult = Schemas['AuthSession'] | Schemas['MfaChallenge'];

const CLIENT_IDS: Record<SocialProvider, string> = {
  google: publicEnv.googleClientId,
  apple: publicEnv.appleServicesId,
};

/** Sends a provider ID token to the API (cookie session); the caller handles the outcome. */
export async function signInWithProvider(
  provider: SocialProvider,
  body: {
    idToken: string;
    nonce: string;
    displayName?: string;
    referralCode?: string;
  },
): Promise<{ data?: SignInResult; response: Response }> {
  const request = { body: { ...body, transport: 'cookie' as const } };
  return provider === 'google'
    ? browserApi().POST('/v1/auth/google', request)
    : browserApi().POST('/v1/auth/apple', request);
}

/**
 * "Continue with Google" and "Continue with Apple" (ADR-067): shown when the API offers the
 * provider and this site has its client id. On a test stack the API's mock stands in, and the
 * button asks for the email to sign in as instead of leaving for the provider.
 */
export function SocialSignIn({
  next,
  referralCode,
  onMfa,
}: {
  next: string | null;
  referralCode?: string | null;
  /** Continues an MFA challenge in the sign-in form; without it, the sign-in page takes over. */
  onMfa?: (mfaToken: string) => void;
}) {
  const { t } = useAccountT();
  const router = useRouter();
  const [providers, setProviders] = useState<Schemas['SocialProviders'] | null>(null);
  const [mock, setMock] = useState<SocialProvider | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void browserApi()
      .GET('/v1/auth/social/providers')
      .then(({ data }) => {
        if (live && data) setProviders(data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const offered = SOCIAL_PROVIDERS.filter(
    (provider) => providers?.[provider] && (providers.mock || CLIENT_IDS[provider] !== ''),
  );
  if (offered.length === 0) return null;

  const finish = (result: SignInResult) => {
    if (result.status === 'mfa_required') {
      if (onMfa) onMfa(result.mfaToken);
      else router.replace('/sign-in');
      return;
    }
    rememberSession(result.accessTokenExpiresAt);
    router.replace(safeNext(next));
    router.refresh();
  };

  const nonce = async (): Promise<string | null> => {
    const { data } = await browserApi().POST('/v1/auth/social/nonce', { body: {} });
    return data?.nonce ?? null;
  };

  const start = async (provider: SocialProvider) => {
    setError(null);
    if (providers?.mock) {
      setMock(provider);
      return;
    }
    setBusy(provider);
    try {
      const issued = await nonce();
      if (!issued) throw new Error('no nonce');
      const state = randomState();
      savePending({
        provider,
        state,
        nonce: issued,
        next,
        referralCode: referralCode ?? null,
        appState: null,
      });
      window.location.assign(
        authorizeUrl(provider, {
          clientId: CLIENT_IDS[provider],
          redirectUri: `${window.location.origin}${CALLBACK_PATH}`,
          nonce: issued,
          state,
        }),
      );
    } catch {
      setError(t('auth.social.failed'));
      setBusy(null);
    }
  };

  const submitMock = async (event: FormEvent) => {
    event.preventDefault();
    if (!mock) return;
    setBusy(mock);
    setError(null);
    try {
      const issued = await nonce();
      const minted = issued
        ? await browserApi().POST('/v1/auth/social/mock-token', {
            body: {
              provider: mock,
              email,
              nonce: issued,
              ...(name.trim() ? { name: name.trim() } : {}),
            },
          })
        : null;
      const idToken = minted?.data?.idToken;
      if (!issued || !idToken) throw new Error('mock token refused');
      const { data } = await signInWithProvider(mock, {
        idToken,
        nonce: issued,
        ...(referralCode ? { referralCode } : {}),
      });
      if (!data) throw new Error('sign-in refused');
      setMock(null);
      finish(data);
    } catch {
      setError(t('auth.social.failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="social-sign-in">
      <p className="text-center font-body text-body-sm text-muted">{t('auth.social.or')}</p>
      {offered.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="secondary"
          loading={busy === provider && !mock}
          onClick={() => void start(provider)}
          data-testid={`social-${provider}`}
        >
          {t(provider === 'google' ? 'auth.social.google' : 'auth.social.apple')}
        </Button>
      ))}
      {error && !mock ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {error}
        </p>
      ) : null}
      <Dialog open={mock !== null} onOpenChange={(open) => (open ? undefined : setMock(null))}>
        <DialogContent
          title={t('auth.social.mockTitle')}
          description={t('auth.social.mockIntro')}
          closeLabel={t('common.close')}
        >
          <form
            method="post"
            className="flex flex-col gap-4"
            onSubmit={(event) => void submitMock(event)}
          >
            <Input
              label={t('auth.social.mockEmail')}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              data-testid="social-mock-email"
            />
            <Input
              label={t('auth.social.mockName')}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              data-testid="social-mock-name"
            />
            {error ? (
              <p role="alert" className="font-body text-body-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={busy !== null} data-testid="social-mock-submit">
              {t('auth.social.mockSubmit')}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
