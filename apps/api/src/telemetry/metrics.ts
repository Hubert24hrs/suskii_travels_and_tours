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

// Business flow (ADR-047). Counters are recorded where the outcome is known; those inside a
// transaction count the attempt (a rolled-back transaction is rare and retried).

/** Quotes (Offer rows) by vertical: the step before checkout in the search-to-book funnel. */
export const quotes = meter.createCounter('suskii.quotes', {
  description: 'Quotes created by vertical',
});

export const bookingsCreated = meter.createCounter('suskii.bookings.created', {
  description: 'Bookings created at checkout by vertical and sales channel',
});

export const bookingTransitions = meter.createCounter('suskii.booking.transitions', {
  description: 'Booking status changes by event and new status',
});

/** Webhook deliveries by provider and result (processed, duplicate, rejected, ...). */
export const paymentWebhooks = meter.createCounter('suskii.payment_webhooks', {
  description: 'Payment webhook deliveries by provider and result',
});

/** Verified payment events by provider and outcome (paid, failed, expired, held_for_review). */
export const payments = meter.createCounter('suskii.payments', {
  description: 'Payment outcomes by provider',
});

export const ticketingAttempts = meter.createCounter('suskii.ticketing.attempts', {
  description: 'Ticketing attempts by outcome (confirmed, retrying, exhausted)',
});

export const refundAttempts = meter.createCounter('suskii.refunds', {
  description: 'Refund executions by outcome (succeeded, processing, failed, needs_review)',
});

/** New or reopened ledger reconciliation discrepancies by kind and subject (ADR-051). */
export const reconciliationDiscrepancies = meter.createCounter(
  'suskii.reconciliation.discrepancies',
  { description: 'Ledger reconciliation discrepancies raised, by kind and subject' },
);

/** Driver payouts by outcome (sent, paid, failed) and provider (ADR-051). */
export const driverPayouts = meter.createCounter('suskii.driver_payouts', {
  description: 'Driver payouts by outcome and provider',
});

// Cars (ADR-049 to ADR-053). Attributes are outcomes only: no ride, trip or person ids.

/** Bus seat hold attempts by outcome (held, seat_taken, hold_limit). */
export const busHolds = meter.createCounter('suskii.bus.holds', {
  description: 'Bus seat hold attempts by outcome',
});

/** Boarding pass scans by result and whether the scanner was offline (synced later). */
export const busTicketScans = meter.createCounter('suskii.bus.ticket_scans', {
  description: 'Bus boarding pass scans by result and offline flag',
});

/** Ride searches that ended, by outcome (assigned, no_driver). */
export const rideMatches = meter.createCounter('suskii.ride.matches', {
  description: 'Ride searches that ended, by outcome',
});

/** SOS alerts by who raised them (rider, driver). */
export const rideSos = meter.createCounter('suskii.ride.sos', {
  description: 'Ride SOS alerts by who raised them',
});

/** AI trip search (ADR-061): parses by outcome (parsed, not_understood, budget, unavailable). */
export const aiSearchRequests = meter.createCounter('suskii.ai_search.requests', {
  description: 'Natural-language flight searches by outcome and failure reason',
});

export const aiSearchDuration = meter.createHistogram('suskii.ai_search.duration', {
  unit: 'ms',
  description: 'Natural-language search latency by outcome',
});

/** Spend in micro-dollars, from the provider's reported usage at the configured prices. */
export const aiSearchCost = meter.createCounter('suskii.ai_search.cost', {
  unit: 'usd_micros',
  description: 'AI search spend in micro-dollars by provider',
});

export const aiSearchTokens = meter.createCounter('suskii.ai_search.tokens', {
  description: 'AI search tokens by kind (input, output, cache_read, cache_write)',
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
