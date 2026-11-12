'use client';

import { Button, Dialog, DialogContent, Input } from '@suskii/ui-web';
import Image from 'next/image';
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
    /** "Remember me" as the sign-in form has it (ADR-108); on when left out. */
    remember?: boolean;
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
 * button asks for the email to sign in as instead of leaving for the provider. The two sit side
 * by side under "or continue with" (ADR-108): each shows the provider's mark and its name, and
 * is named in full ("Continue with Google") for a screen reader.
 */
export function SocialSignIn({
  next,
  referralCode,
  remember,
  onMfa,
}: {
  next: string | null;
  referralCode?: string | null;
  /** The sign-in form's "Remember me"; a form without the box leaves it out (on). */
  remember?: boolean;
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
        ...(remember === false ? { remember: false } : {}),
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
        ...(remember === undefined ? {} : { remember }),
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
    <div className="flex flex-col gap-4" data-testid="social-sign-in">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <p className="font-body text-body-sm text-muted">{t('auth.social.orContinue')}</p>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <div className={offered.length > 1 ? 'grid grid-cols-2 gap-3' : 'grid gap-3'}>
        {offered.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="ghost"
            // The name a screen reader hears stays the provider's own wording.
            aria-label={t(provider === 'google' ? 'auth.social.google' : 'auth.social.apple')}
            loading={busy === provider && !mock}
            onClick={() => void start(provider)}
            data-testid={`social-${provider}`}
            className="border border-border-strong bg-surface px-4 text-foreground hover:bg-background"
          >
            <Image
              src={`/brand/providers/${provider}.svg`}
              alt=""
              width={20}
              height={20}
              unoptimized
              className="size-5"
            />
            {t(provider === 'google' ? 'auth.social.googleShort' : 'auth.social.appleShort')}
          </Button>
        ))}
      </div>
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
