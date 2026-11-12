'use client';

import { Button } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { browserApi } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { ErrorLine } from './account-shell';
import { useSignedIn } from './use-signed-in';

const STORAGE_KEY = 'suskii:company-invite';
const NEXT = '/company/join';

/**
 * Moves the token from an invitation link (`/company/join#invite=…`) into this tab's session
 * storage and off the address bar, so it survives signing in and stays out of history.
 */
function adoptInvite(): string | null {
  try {
    const match = /^#invite=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
    if (match?.[1]) {
      sessionStorage.setItem(STORAGE_KEY, match[1]);
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const forgetInvite = (): void => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage held nothing.
  }
};

type Outcome = { kind: 'joined'; company: string } | { kind: 'invalid' } | { kind: 'member' };

/** Accepts a company invitation for the signed-in account (ADR-078). */
export function JoinCompany() {
  const { t } = useAccountT();
  const signedIn = useSignedIn();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // The fragment only exists in the browser; read it once the page is interactive.
  useEffect(() => {
    queueMicrotask(() => setToken(adoptInvite()));
  }, []);

  if (token === undefined) return null;
  if (outcome?.kind === 'joined') {
    return (
      <div className="flex flex-col items-start gap-4" data-testid="company-joined">
        <p role="status" className="font-body text-body text-success">
          {t('account.company.join.joined', { company: outcome.company })}
        </p>
        <AppLink
          href="/account/company"
          className="font-body text-body font-bold text-primary underline focus-visible:focus-ring"
        >
          {t('account.company.join.open')}
        </AppLink>
      </div>
    );
  }
  if (!token) {
    return (
      <p className="font-body text-body text-foreground">{t('account.company.join.missing')}</p>
    );
  }
  if (!signedIn) {
    return (
      <div className="flex flex-wrap gap-3">
        <AppLink
          href={`/sign-in?next=${encodeURIComponent(NEXT)}`}
          className="inline-flex min-h-12 items-center rounded-md bg-primary px-6 font-body text-body font-bold text-on-primary focus-visible:focus-ring"
        >
          {t('auth.signIn.submit')}
        </AppLink>
        <AppLink
          href={`/register?next=${encodeURIComponent(NEXT)}`}
          className="inline-flex min-h-12 items-center rounded-md border border-border-strong px-6 font-body text-body font-bold text-foreground focus-visible:focus-ring"
        >
          {t('auth.register.submit')}
        </AppLink>
      </div>
    );
  }

  const accept = async () => {
    setBusy(true);
    try {
      const { data, response } = await browserApi().POST('/v1/me/company/invitations/accept', {
        body: { token },
      });
      if (data) {
        forgetInvite();
        setOutcome({ kind: 'joined', company: data.name });
      } else setOutcome(response.status === 409 ? { kind: 'member' } : { kind: 'invalid' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-4">
      <Button onClick={() => void accept()} loading={busy} data-testid="company-accept">
        {t('account.company.join.accept')}
      </Button>
      <ErrorLine
        message={
          outcome?.kind === 'invalid'
            ? t('account.company.join.invalid')
            : outcome?.kind === 'member'
              ? t('account.company.join.member')
              : null
        }
      />
    </div>
  );
}
