'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { forgetBookingTokens } from '../../lib/booking-token';
import { browserApi, type Schemas } from '../../lib/browser-api';
import { ensureFreshSession, expireSession, forgetSession, hasSession } from '../../lib/session';

export type AuthUser = Schemas['AuthUser'];

export type AccountPhase =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'ready'; user: AuthUser }
  | { kind: 'error' };

const subscribe = (notify: () => void) => {
  window.addEventListener('suskii:session', notify);
  window.addEventListener('storage', notify);
  window.addEventListener('focus', notify);
  return () => {
    window.removeEventListener('suskii:session', notify);
    window.removeEventListener('storage', notify);
    window.removeEventListener('focus', notify);
  };
};

/** Whether this browser has a session cookie; false on the server and during hydration. */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, hasSession, () => false);
}

/**
 * The signed-in user from `GET /v1/me`. An access cookie that expired between refreshes gets one
 * refresh and one retry; a session the API no longer knows means signed out.
 */
export function useAccount(): {
  phase: AccountPhase;
  reload: () => void;
  replaceUser: (user: AuthUser) => void;
} {
  const [phase, setPhase] = useState<AccountPhase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async (retried: boolean): Promise<void> => {
      if (!hasSession()) {
        if (!cancelled) setPhase({ kind: 'signedOut' });
        return;
      }
      try {
        const { data, response } = await browserApi().GET('/v1/me');
        if (cancelled) return;
        if (data) {
          setPhase({ kind: 'ready', user: data });
        } else if (response.status === 401 && !retried) {
          expireSession();
          if (await ensureFreshSession()) await load(true);
          else if (!cancelled) setPhase({ kind: 'signedOut' });
        } else if (response.status === 401) {
          forgetSession();
          setPhase({ kind: 'signedOut' });
        } else {
          setPhase({ kind: 'error' });
        }
      } catch {
        if (!cancelled) setPhase({ kind: 'error' });
      }
    };
    void load(false);
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return {
    phase,
    reload: () => setAttempt((n) => n + 1),
    replaceUser: (user) => setPhase({ kind: 'ready', user }),
  };
}

/** Ends this session on the API (cookies cleared) and locally, guest booking tokens included. */
export async function signOut(): Promise<void> {
  try {
    await browserApi().POST('/v1/auth/logout', { body: {} });
  } finally {
    forgetSession();
    forgetBookingTokens();
  }
}

/** A same-site path to return to after signing in; anything else goes to the account. */
export function safeNext(value: string | null | undefined, fallback = '/account'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return fallback;
  }
  return value;
}
