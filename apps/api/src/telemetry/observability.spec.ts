import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ADR-047: the dashboards and alert rules in infra/observability may only use metrics the code
 * defines, under the names the default OTLP-to-Prometheus translation gives them. A renamed or
 * removed instrument fails here instead of leaving a silent panel or an alert that never fires.
 */
const ROOT = join(__dirname, '..', '..', '..', '..');
const SOURCES = [
  'apps/api/src/telemetry/metrics.ts',
  'apps/api/src/telemetry/operations-metrics.ts',
  'apps/worker/src/telemetry.ts',
];
/** From the OpenTelemetry HTTP instrumentation (stable semantic conventions, telemetry.ts). */
const INSTRUMENTATION_SERIES = ['http_server_request_duration_seconds'];

const UNIT_SUFFIX: Record<string, string> = { ms: '_milliseconds', s: '_seconds', '1': '' };

interface Instrument {
  name: string;
  kind: string;
  unit: string | undefined;
}

function instruments(source: string): Instrument[] {
  const found: Instrument[] = [];
  const pattern = /create(Counter|Histogram|ObservableGauge|UpDownCounter|Gauge)\(\s*'([^']+)'/g;
  const matches = [...source.matchAll(pattern)];
  matches.forEach((match, index) => {
    const end = matches[index + 1]?.index ?? source.length;
    const options = source.slice(match.index, end);
    found.push({
      kind: match[1] ?? '',
      name: match[2] ?? '',
      unit: /unit:\s*'([^']+)'/.exec(options)?.[1],
    });
  });
  return found;
}

/** The series a Prometheus query may name for an instrument. */
function seriesOf(instrument: Instrument): string[] {
  const unit = instrument.unit === undefined ? '' : (UNIT_SUFFIX[instrument.unit] ?? '');
  const base = `${instrument.name.replace(/\./g, '_')}${unit}`;
  if (instrument.kind === 'Counter') return [`${base}_total`];
  if (instrument.kind === 'Histogram') return [`${base}_bucket`, `${base}_count`, `${base}_sum`];
  return [base];
}

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : /\.(json|ya?ml)$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}

describe('observability configuration', () => {
  const defined = SOURCES.flatMap((path) => instruments(readFileSync(join(ROOT, path), 'utf8')));
  const known = new Set([
    ...defined.flatMap(seriesOf),
    ...INSTRUMENTATION_SERIES.flatMap((base) => [`${base}_bucket`, `${base}_count`, `${base}_sum`]),
  ]);

  it('finds the instruments it checks against', () => {
    expect(defined.map((instrument) => instrument.name)).toEqual(
      expect.arrayContaining([
        'suskii.payment_webhooks',
        'suskii.ticketing.oldest_age',
        'suskii.web_vitals.lcp',
        'suskii.queue.jobs',
      ]),
    );
    expect(known).toContain('suskii_ticketing_oldest_age_seconds');
    expect(known).toContain('suskii_web_vitals_lcp_milliseconds_bucket');
    expect(known).toContain('suskii_payment_webhooks_total');
  });

  it('uses only defined metrics in dashboards and alert rules', () => {
    const unknown: string[] = [];
    let checked = 0;
    for (const file of files(join(ROOT, 'infra', 'observability'))) {
      const text = readFileSync(file, 'utf8');
      for (const [series] of text.matchAll(/\b(?:suskii|http_server)_[a-z0-9_]+\b/g)) {
        checked += 1;
        if (!known.has(series)) unknown.push(`${file.slice(ROOT.length + 1)}: ${series}`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(unknown).toEqual([]);
  });
});
