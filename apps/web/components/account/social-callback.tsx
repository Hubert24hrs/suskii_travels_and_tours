'use client';

import { Card } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { rememberSession } from '../../lib/session';
import {
  APP_RETURN_URL,
  authorizeUrl,
  CALLBACK_PATH,
  isSocialProvider,
  isWellFormedToken,
  randomState,
  readCallback,
  savePending,
  takePending,
} from '../../lib/social-sign-in';
import { publicEnv } from '../../lib/env';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { signInWithProvider } from './social-sign-in';
import { safeNext } from './use-account';

/**
 * Where Google and Apple send the browser back (ADR-067). The ID token arrives in the fragment;
 * it is read once, removed from the address bar and only accepted when the state matches the
 * sign-in this tab started. A sign-in the app asked for goes back to the app's own address with
 * the app's state; the app then proves it holds the nonce's secret.
 */
export function SocialCallback() {
  const { t } = useAccountT();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const { idToken, state } = readCallback(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname);
    const pending = takePending();
    const fail = () => void Promise.resolve().then(() => setFailed(true));
    if (!pending || !idToken || state !== pending.state) {
      fail();
      return;
    }
    if (pending.appState) {
      const params = new URLSearchParams({
        provider: pending.provider,
        idToken,
        nonce: pending.nonce,
        state: pending.appState,
      });
      window.location.replace(`${APP_RETURN_URL}#${params.toString()}`);
      return;
    }
    void signInWithProvider(pending.provider, {
      idToken,
      nonce: pending.nonce,
      ...(pending.referralCode ? { referralCode: pending.referralCode } : {}),
    }).then(
      ({ data }) => {
        if (!data) return fail();
        if (data.status === 'mfa_required') {
          router.replace('/sign-in');
          return;
        }
        rememberSession(data.accessTokenExpiresAt);
        router.replace(safeNext(pending.next));
        router.refresh();
      },
      () => fail(),
    );
  }, [router]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      {failed ? (
        <>
          <p role="alert" className="font-body text-body text-danger">
            {t('auth.social.failed')}
          </p>
          <AppLink href="/sign-in" className="font-body text-body text-primary underline">
            {t('auth.signIn.submit')}
          </AppLink>
        </>
      ) : (
        <p role="status" className="font-body text-body text-foreground">
          {t('auth.social.returning')}
        </p>
      )}
    </Card>
  );
}

/**
 * The app's way to Google or Apple through the website (ADR-067): it brings a nonce the API bound
 * to a secret only the app holds, and its own state. This page only starts the provider step; the
 * callback hands the token back to the app's fixed address and nowhere else.
 */
export function AppSignInRelay({
  provider,
  nonce,
  state,
}: {
  provider: string | null;
  nonce: string | null;
  state: string | null;
}) {
  const { t } = useAccountT();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const clientId = provider === 'google' ? publicEnv.googleClientId : publicEnv.appleServicesId;
    if (
      !isSocialProvider(provider) ||
      !isWellFormedToken(nonce) ||
      !isWellFormedToken(state) ||
      !clientId
    ) {
      void Promise.resolve().then(() => setFailed(true));
      return;
    }
    const ownState = randomState();
    savePending({
      provider,
      state: ownState,
      nonce,
      next: null,
      referralCode: null,
      appState: state,
    });
    window.location.replace(
      authorizeUrl(provider, {
        clientId,
        redirectUri: `${window.location.origin}${CALLBACK_PATH}`,
        nonce,
        state: ownState,
      }),
    );
  }, [provider, nonce, state]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <p
        role={failed ? 'alert' : 'status'}
        className={
          failed ? 'font-body text-body text-danger' : 'font-body text-body text-foreground'
        }
      >
        {failed ? t('auth.social.failed') : t('auth.social.returning')}
      </p>
    </Card>
  );
}
