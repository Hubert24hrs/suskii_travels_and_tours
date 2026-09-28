import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

/**
 * Starts OpenTelemetry tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set (Grafana, Datadog or a
 * cloud collector); otherwise tracing is off and costs nothing. Must run before Nest, Express,
 * pg or ioredis are imported so their modules get instrumented.
 */
export function startTelemetry(env: NodeJS.ProcessEnv = process.env): NodeSDK | undefined {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return undefined;

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? 'suskii-api',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
  return sdk;
}
