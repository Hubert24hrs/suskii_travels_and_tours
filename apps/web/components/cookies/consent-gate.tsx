'use client';

import { lazy, Suspense, useSyncExternalStore } from 'react';

import { readCookieConsent } from '../../lib/consent-cookie';

import type { CookieLabels } from './cookie-settings';

// The prompt's code loads only for a visitor who has not chosen yet (ADR-013, ADR-079).
const ConsentPrompt = lazy(() => import('./consent-prompt'));

// Decided once per page load: a visitor who chose earlier never loads the prompt, and once it
// has loaded it stays mounted, so its dialog can confirm a choice made from "Choose".
let needed: boolean | null = null;
const needsPrompt = (): boolean => (needed ??= readCookieConsent() === null);
const noSubscription = (): (() => void) => () => undefined;
// The server cannot read the browser's choice: it renders nothing, so hydration never differs.
const notOnServer = (): boolean => false;

/** Mounts the first-visit cookie prompt for visitors without a choice under the current policy. */
export function ConsentGate({ labels }: { labels: CookieLabels }) {
  const show = useSyncExternalStore(noSubscription, needsPrompt, notOnServer);
  if (!show) return null;
  return (
    <Suspense fallback={null}>
      <ConsentPrompt labels={labels} />
    </Suspense>
  );
}
