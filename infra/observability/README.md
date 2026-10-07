# Observability

Dashboards and alert rules for Suskii (ADR-046, ADR-047). They work with any Prometheus-compatible
backend that receives OpenTelemetry metrics, for example Grafana Cloud, Google Managed Prometheus,
Amazon Managed Prometheus, or a self-hosted Prometheus with `--web.enable-otlp-receiver`.

## What sends what

| Source  | How                                                | Enabled by                                                       |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| API     | OTLP traces and metrics (`apps/api/src/telemetry`) | `OTEL_EXPORTER_OTLP_ENDPOINT`                                    |
| Worker  | OTLP metrics: queue depth and job outcomes         | `OTEL_EXPORTER_OTLP_ENDPOINT`                                    |
| Website | Core Web Vitals beacons to the API, then OTLP      | `NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE` (on)                        |
| All     | Errors to Sentry: stack, scrubbed message, tags    | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_DSN` |

Metric names follow the default OTLP-to-Prometheus translation: dots become underscores, counters
gain `_total`, and units become suffixes. For example, `suskii.ticketing.oldest_age` (seconds) is
`suskii_ticketing_oldest_age_seconds`, and `suskii.web_vitals.lcp` (milliseconds) is
`suskii_web_vitals_lcp_milliseconds_bucket`. HTTP metrics use the stable semantic conventions:
`http_server_request_duration_seconds` with `http_route` and `http_response_status_code`.

## Files

- `dashboards/suskii-overview.json`: API traffic, errors and latency; the quote-to-booking funnel;
  payments and webhooks.
- `dashboards/suskii-operations.json`: ticketing backlog and age, refunds, risk reviews, queues,
  database connections, supplier latency and errors.
- `dashboards/suskii-web-vitals.json`: LCP, INP and CLS at the 75th percentile, by page template
  and device, against the spec's targets.
- `alerts/suskii.rules.yml`: Prometheus alert rules. `severity: page` means money or tickets are at
  risk now; `severity: ticket` can wait for working hours. Each alert names its runbook.
- `alerts/suskii.rules.test.yml`: unit tests for the rules.

Import a dashboard in Grafana (Dashboards, New, Import) and pick the Prometheus data source.
Load the rules into Prometheus (`rule_files`) or Grafana-managed alerting, and route on the
`severity` label in Alertmanager.

## Checks

- CI runs `promtool check rules` and `promtool test rules` on every change.
- `apps/api/src/telemetry/observability.spec.ts` fails if a dashboard or rule names a metric the
  code does not define.

```bash
promtool check rules infra/observability/alerts/suskii.rules.yml
promtool test rules infra/observability/alerts/suskii.rules.test.yml
```

## Open for the owner

- The metrics backend and Sentry organisation (and their data regions).
- Who receives `page` alerts, and through which tool (PagerDuty, Opsgenie, a phone rota).
