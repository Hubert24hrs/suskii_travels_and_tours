'use client';

import { useSyncExternalStore } from 'react';

import { hasSession } from '../../lib/session';

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

/**
 * Whether this browser has a session cookie; false on the server and during hydration. Kept apart
 * from `use-account` so the header does not load the API client on every page (ADR-013).
 */
export function useSignedIn(): boolean {
  return useSyncExternalStore(subscribe, hasSession, () => false);
}
