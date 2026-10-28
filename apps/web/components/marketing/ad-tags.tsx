'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { trackAd, type AdEventParams } from '../../lib/ad-events';
import type { AdTagConfig } from '../../lib/ad-tags';

// Once per page load, even if the visitor withdraws and allows marketing again.
let started = false;

/**
 * Starts the configured ad tags (ADR-079). Mounted by `Marketing` only while the visitor allows
 * marketing, so their code loads only then. The tags report the page they start on; this reports
 * each later navigation.
 */
export function AdTags({ config }: { config: AdTagConfig }): null {
  const pathname = usePathname();
  const firstPath = useRef(true);

  useEffect(() => {
    if (started) return;
    started = true;
    void import('../../lib/ad-tags-loader').then(({ startAdTags }) => startAdTags(config));
  }, [config]);

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
