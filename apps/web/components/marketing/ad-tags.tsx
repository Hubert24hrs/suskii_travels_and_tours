'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { trackAd, type AdEventParams } from '../../lib/ad-events';
import { adTagsOn, type AdTagConfig } from '../../lib/ad-tags';
import { CONSENT_EVENT, hasCookieConsent } from '../../lib/consent-cookie';

/**
 * Starts the configured ad tags once the visitor allows marketing, now or later in the visit
 * (ADR-079). Their code loads only then, so pages without consent ship none of it. Reports a
 * PageView when they start and on every later navigation; nothing leaves before the tags run.
 */
export function AdTags({ config }: { config: AdTagConfig }): null {
  const pathname = usePathname();
  const started = useRef(false);
  const firstPath = useRef(true);

  useEffect(() => {
    if (!adTagsOn(config)) return;
    const start = (): void => {
      if (started.current || !hasCookieConsent('marketing')) return;
      started.current = true;
      void import('../../lib/ad-tags-loader').then(({ startAdTags }) => startAdTags(config));
    };
    start();
    window.addEventListener(CONSENT_EVENT, start);
    return () => window.removeEventListener(CONSENT_EVENT, start);
  }, [config]);

  // The tags report the page they start on; this covers each later navigation.
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    trackAd('PageView');
  }, [pathname]);

  return null;
}

/** Reports one event when a server-rendered page shows, e.g. ViewContent on a product page. */
export function TrackAd({
  event,
  params,
}: {
  event: Parameters<typeof trackAd>[0];
  params?: AdEventParams;
}): null {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    trackAd(event, params);
  }, [event, params]);
  return null;
}
