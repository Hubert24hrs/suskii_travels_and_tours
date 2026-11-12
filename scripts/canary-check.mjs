#!/usr/bin/env node
/**
 * Canary gate for a production release (ADR-060): reads the candidate revision's requests from
 * Cloud Monitoring and fails when too many answered 5xx. With too little traffic to judge, it
 * passes and says so; the smoke tests then decide alone.
 *
 *   GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) node scripts/canary-check.mjs \
 *     --project my-project --service suskii-production-api --revision suskii-production-api-00042-abc \
 *     [--minutes 10] [--max-error-ratio 0.02] [--min-requests 50]
 *
 * Exits 1 when the candidate fails the gate, 2 when the metrics cannot be read.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const MONITORING = 'https://monitoring.googleapis.com/v3';

/** Sums Cloud Run request counts by response code class ("2xx", "5xx", ...). */
export function countByClass(timeSeries) {
  const counts = {};
  for (const series of timeSeries ?? []) {
    const responseClass = series.metric?.labels?.response_code_class ?? 'unknown';
    for (const point of series.points ?? []) {
      const value = Number(point.value?.int64Value ?? point.value?.doubleValue ?? 0);
      counts[responseClass] = (counts[responseClass] ?? 0) + value;
    }
  }
  return counts;
}

/** The gate's verdict for a set of counts. */
export function judge(counts, { maxErrorRatio, minRequests }) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const errors = counts['5xx'] ?? 0;
  if (total < minRequests) {
    return {
      pass: true,
      total,
      errors,
      reason: `only ${total} requests (fewer than ${minRequests}): smoke tests decide`,
    };
  }
  const ratio = errors / total;
  return ratio > maxErrorRatio
    ? {
        pass: false,
        total,
        errors,
        reason: `5xx ratio ${(ratio * 100).toFixed(2)}% is above ${(maxErrorRatio * 100).toFixed(2)}%`,
      }
    : {
        pass: true,
        total,
        errors,
        reason: `5xx ratio ${(ratio * 100).toFixed(2)}% is within ${(maxErrorRatio * 100).toFixed(2)}%`,
      };
}

/** The Monitoring query for one revision's request counts over the last `minutes`. */
export function requestCountQuery({ project, service, revision, minutes, now = new Date() }) {
  const filter = [
    'metric.type = "run.googleapis.com/request_count"',
    'resource.type = "cloud_run_revision"',
    `resource.labels.service_name = "${service}"`,
    `resource.labels.revision_name = "${revision}"`,
  ].join(' AND ');
  const params = new URLSearchParams({
    filter,
    'interval.startTime': new Date(now.getTime() - minutes * 60_000).toISOString(),
    'interval.endTime': now.toISOString(),
    'aggregation.alignmentPeriod': `${minutes * 60}s`,
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
    'aggregation.groupByFields': 'metric.labels.response_code_class',
  });
  return `${MONITORING}/projects/${encodeURIComponent(project)}/timeSeries?${params}`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      service: { type: 'string' },
      revision: { type: 'string' },
      minutes: { type: 'string', default: '10' },
      'max-error-ratio': { type: 'string', default: '0.02' },
      'min-requests': { type: 'string', default: '50' },
    },
  });
  const token = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (!values.project || !values.service || !values.revision || !token) {
    process.stderr.write(
      'canary-check: --project, --service, --revision and GOOGLE_OAUTH_ACCESS_TOKEN are required\n',
    );
    process.exit(2);
  }
  const url = requestCountQuery({
    project: values.project,
    service: values.service,
    revision: values.revision,
    minutes: Number(values.minutes),
  });
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    process.stderr.write(`canary-check: Cloud Monitoring answered ${response.status}\n`);
    process.exit(2);
  }
  const body = await response.json();
  const verdict = judge(countByClass(body.timeSeries), {
    maxErrorRatio: Number(values['max-error-ratio']),
    minRequests: Number(values['min-requests']),
  });
  process.stdout.write(
    `canary-check: ${values.revision}: ${verdict.total} requests, ${verdict.errors} 5xx; ${verdict.reason}\n`,
  );
  process.exit(verdict.pass ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(
      `canary-check: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  });
}
