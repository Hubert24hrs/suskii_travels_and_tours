import { metrics } from '@opentelemetry/api';

/**
 * Business and supplier metrics (PROJECT_SPEC.json#/observability). Instruments are no-ops
 * unless telemetry is enabled, so recording is always safe. Attributes never carry PII.
 */
const meter = metrics.getMeter('suskii-api');

export const supplierDuration = meter.createHistogram('suskii.supplier.duration', {
  unit: 'ms',
  description: 'Supplier call latency by supplier, vertical, operation and outcome',
});

export const supplierCalls = meter.createCounter('suskii.supplier.calls', {
  description: 'Supplier calls by supplier, vertical, operation and outcome',
});

export const searches = meter.createCounter('suskii.search.requests', {
  description: 'Searches by vertical, cache hit and completeness',
});

/**
 * Field Core Web Vitals from the website (ADR-044), by page template and device class. Buckets
 * are finer around the "good" thresholds so dashboards can read the 75th percentile accurately.
 */
const PAINT_BUCKETS_MS = [
  250, 500, 750, 1000, 1250, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000, 5000, 6000, 8000,
  10_000, 15_000, 30_000,
];

export const webVitals = {
  LCP: meter.createHistogram('suskii.web_vitals.lcp', {
    unit: 'ms',
    description: 'Largest Contentful Paint from real visits, by page template and device',
    advice: { explicitBucketBoundaries: PAINT_BUCKETS_MS },
  }),
  INP: meter.createHistogram('suskii.web_vitals.inp', {
    unit: 'ms',
    description: 'Interaction to Next Paint from real visits, by page template and device',
    advice: {
      explicitBucketBoundaries: [
        25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 2000, 5000,
      ],
    },
  }),
  CLS: meter.createHistogram('suskii.web_vitals.cls', {
    unit: '1',
    description: 'Cumulative Layout Shift from real visits, by page template and device',
    advice: {
      explicitBucketBoundaries: [0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.5, 1],
    },
  }),
  FCP: meter.createHistogram('suskii.web_vitals.fcp', {
    unit: 'ms',
    description: 'First Contentful Paint from real visits, by page template and device',
    advice: { explicitBucketBoundaries: PAINT_BUCKETS_MS },
  }),
  TTFB: meter.createHistogram('suskii.web_vitals.ttfb', {
    unit: 'ms',
    description: 'Time to First Byte from real visits, by page template and device',
    advice: {
      explicitBucketBoundaries: [100, 200, 400, 600, 800, 1000, 1500, 2000, 3000, 5000, 10_000],
    },
  }),
} as const;
