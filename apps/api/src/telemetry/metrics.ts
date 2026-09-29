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
