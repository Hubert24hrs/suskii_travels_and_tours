import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countByClass, judge, requestCountQuery } from './canary-check.mjs';

const series = (responseClass, ...values) => ({
  metric: { labels: { response_code_class: responseClass } },
  points: values.map((value) => ({ value: { int64Value: String(value) } })),
});

test('sums request counts by response code class', () => {
  assert.deepEqual(countByClass([series('2xx', 90, 5), series('5xx', 3), series('4xx', 2)]), {
    '2xx': 95,
    '5xx': 3,
    '4xx': 2,
  });
  assert.deepEqual(countByClass(undefined), {});
});

test('fails a candidate above the 5xx ratio and passes one within it', () => {
  const limits = { maxErrorRatio: 0.02, minRequests: 50 };
  assert.equal(judge({ '2xx': 95, '5xx': 5 }, limits).pass, false);
  assert.match(judge({ '2xx': 95, '5xx': 5 }, limits).reason, /5\.00% is above 2\.00%/);
  assert.equal(judge({ '2xx': 99, '5xx': 1 }, limits).pass, true);
  // 4xx answers are the clients' mistakes, not the release's.
  assert.equal(judge({ '2xx': 50, '4xx': 50 }, limits).pass, true);
});

test('leaves a quiet candidate to the smoke tests', () => {
  const verdict = judge({ '5xx': 3 }, { maxErrorRatio: 0.02, minRequests: 50 });
  assert.equal(verdict.pass, true);
  assert.match(verdict.reason, /smoke tests decide/);
});

test('queries one revision over the window, grouped by response class', () => {
  const url = new URL(
    requestCountQuery({
      project: 'p-1',
      service: 'suskii-production-api',
      revision: 'suskii-production-api-00042-abc',
      minutes: 10,
      now: new Date('2026-10-25T12:00:00Z'),
    }),
  );
  assert.equal(url.pathname, '/v3/projects/p-1/timeSeries');
  assert.match(
    url.searchParams.get('filter') ?? '',
    /revision_name = "suskii-production-api-00042-abc"/,
  );
  assert.equal(url.searchParams.get('interval.startTime'), '2026-10-25T11:50:00.000Z');
  assert.equal(
    url.searchParams.get('aggregation.groupByFields'),
    'metric.labels.response_code_class',
  );
});
