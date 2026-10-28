'use client';

import type { CookieChoices } from '@suskii/shared/lite';
import { lazy, Suspense, useEffect, useState } from 'react';

import type { AdTagConfig } from '../../lib/ad-tags';
import { CONSENT_EVENT } from '../../lib/consent-event';
import type { MarketingState } from '../../lib/marketing-state';
import type { CookieLabels } from '../cookies/cookie-settings';

// Each loads only when needed, so a visitor who said no gets no ad code at all (ADR-013, ADR-079).
const AdTags = lazy(() => import('./ad-tags').then((module) => ({ default: module.AdTags })));
const ConsentPrompt = lazy(() => import('../cookies/consent-prompt'));

/**
 * The first-visit prompt while the visitor has no choice, and the ad tags once marketing is
 * allowed, now or later in the visit. `initial` is what the server read from the consent cookie.
 */
export function Marketing({
  config,
  labels,
  initial,
}: {
  config: AdTagConfig;
  labels: CookieLabels;
  initial: MarketingState;
}) {
  const [allowed, setAllowed] = useState(initial === 'allowed');
  useEffect(() => {
    const onChoice = (event: Event): void => {
      setAllowed((event as CustomEvent<CookieChoices | undefined>).detail?.marketing === true);
    };
    addEventListener(CONSENT_EVENT, onChoice);
    return () => removeEventListener(CONSENT_EVENT, onChoice);
  }, []);
  return (
    <>
      {/* Stays mounted after a choice, so the list opened from "Choose" can confirm the save. */}
      {initial === 'ask' ? (
        <Suspense fallback={null}>
          <ConsentPrompt labels={labels} />
        </Suspense>
      ) : null}
      {allowed ? (
        <Suspense fallback={null}>
          <AdTags config={config} />
        </Suspense>
      ) : null}
    </>
  );
}
