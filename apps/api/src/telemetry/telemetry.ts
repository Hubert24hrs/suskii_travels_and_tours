import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

/**
 * Starts OpenTelemetry traces and metrics when OTEL_EXPORTER_OTLP_ENDPOINT is set (Grafana,
 * Datadog or a cloud collector); otherwise both are off and instruments are no-ops. Must run
 * before Nest, Express, pg or ioredis are imported so their modules get instrumented.
 */
export function startTelemetry(env: NodeJS.ProcessEnv = process.env): NodeSDK | undefined {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return undefined;

  const base = endpoint.replace(/\/$/, '');
  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? 'suskii-api',
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: 60_000,
      }),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
  return sdk;
}
