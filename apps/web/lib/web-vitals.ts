import {
  webVitalsPage,
  type WebVitalName,
  type WebVitalsDevice,
  type WebVitalsPage,
} from '@suskii/shared/lite';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

import { publicEnv } from './env';

export interface WebVitalsReport {
  page: WebVitalsPage;
  device: WebVitalsDevice;
  metrics: { name: WebVitalName; value: number }[];
}

/**
 * Field Core Web Vitals (ADR-044): the latest value of each metric for this page view, sent with
 * `navigator.sendBeacon` whenever the page is hidden. Only the page template and device class go
 * with them; ids, URLs and anything about the visitor stay in the browser. Loaded on demand by
 * `WebVitalsReporter`; the library reads buffered entries, so loading late loses nothing.
 */
export function reportWebVitals(landingPath: string): void {
  const endpoint = `${publicEnv.apiBaseUrl.replace(/\/$/, '')}/v1/telemetry/web-vitals`;
  const page = webVitalsPage(landingPath);
  const device: WebVitalsDevice = matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop';
  const latest = new Map<WebVitalName, number>();
  const record = (metric: Metric): void => {
    latest.set(metric.name, metric.value);
  };
  const flush = (): void => {
    if (latest.size === 0) return;
    const report: WebVitalsReport = {
      page,
      device,
      metrics: [...latest].map(([name, value]) => ({ name, value })),
    };
    latest.clear();
    // A string body is sent as text/plain: no CORS preflight, and it leaves even as the page closes.
    navigator.sendBeacon(endpoint, JSON.stringify(report));
  };
  onTTFB(record);
  onFCP(record);
  onLCP(record);
  onCLS(record);
  onINP(record);
  // Registered after the library's own listeners, so the final CLS, INP and LCP are already in.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
