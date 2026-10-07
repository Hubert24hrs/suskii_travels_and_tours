'use client';

import { useEffect } from 'react';

import { publicEnv } from '../lib/env';

/** Reporting starts this long after the load event, or at the first interaction if sooner. */
const START_AFTER_LOAD_MS = 5_000;
const FIRST_INTERACTION = ['pointerdown', 'keydown', 'scroll'] as const;

/**
 * Starts field Core Web Vitals reporting off the critical path (ADR-044): its code loads only
 * once the page has settled or the visitor acts, so it never competes with rendering or counts
 * toward the homepage budget. Nothing is stored in the browser.
 */
export function WebVitalsReporter(): null {
  useEffect(() => {
    if (!(Math.random() < publicEnv.webVitalsSampleRate)) return;
    // The page the visit landed on: metrics belong to it even after client-side navigation.
    const landingPath = location.pathname;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const afterLoad = (): void => {
      timer = setTimeout(start, START_AFTER_LOAD_MS);
    };
    const stop = (): void => {
      clearTimeout(timer);
      removeEventListener('load', afterLoad);
      for (const type of FIRST_INTERACTION) removeEventListener(type, start);
    };
    function start(): void {
      stop();
      void import('../lib/web-vitals').then(({ reportWebVitals }) => reportWebVitals(landingPath));
    }
    for (const type of FIRST_INTERACTION) addEventListener(type, start, { passive: true });
    if (document.readyState === 'complete') afterLoad();
    else addEventListener('load', afterLoad);
    return stop;
  }, []);
  return null;
}
