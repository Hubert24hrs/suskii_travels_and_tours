# ADR-047: Metrics, dashboards and alerts

- Status: Accepted
- Date: 2026-10-07
- Deciders: Claude Code (implementer), pending owner review

## Context

`PROJECT_SPEC.json#/observability` asks for:

- business metrics: search-to-book conversion, payment success rate, ticketing failure rate,
  and supplier latency and error rate;
- alerts on payment webhook failures, ticketing backlog, error-rate spikes, queue depth and
  database connections.

Before phase 11:

- the API exported OpenTelemetry traces and metrics for searches and suppliers only;
- the worker exported nothing;
- there were no dashboards or alert rules.

The cloud and the metrics backend are still open questions for the owner.

## Decisions

1. **OpenTelemetry everywhere, the backend later.**
   - The API and the worker export OTLP metrics when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
   - Dashboards and rules assume a Prometheus-compatible backend with the default
     OTLP-to-Prometheus translation. Most managed options on GCP, AWS and Grafana Cloud are
     Prometheus-compatible.
   - The API opts into the stable HTTP semantic conventions, so the HTTP metric is
     `http.server.request.duration` (seconds) with `http.route` and `http.response.status_code`.
2. **Business counters where the outcome is known.**
   - The funnel: `suskii.quotes` (vertical), `suskii.bookings.created` (vertical, channel) and
     `suskii.booking.transitions` (event, new status).
   - Payments: `suskii.payment_webhooks` (provider, result: processed, duplicate, ignored,
     rejected, unconfirmed, provider_unavailable, failed) and `suskii.payments` (provider,
     outcome).
   - Fulfilment and money back: `suskii.ticketing.attempts` (outcome) and `suskii.refunds`
     (outcome).
   - Counters inside a transaction count the attempt; a rolled-back transaction is rare and
     shows up as a retry.
3. **Operational gauges read at export time.** `OperationsMetrics` reads the database once a
   minute per API replica:
   - `suskii.bookings.in_flight` (status);
   - `suskii.ticketing.oldest_age`, the age of the oldest booking waiting for a ticket;
   - `suskii.refunds.open` (status) and `suskii.payment_risk_reviews.open`;
   - `suskii.db.connections` (state, from `pg_stat_activity`, plus `max`).

   The queries use existing indexes. The callbacks only run when an exporter collects. Every
   replica reports the same database-wide values, so rules take the maximum, not the sum.

4. **Worker metrics.** `suskii.queue.jobs` (queue, state), read from Redis at export time, and
   `suskii.worker.jobs` (queue, job, outcome).
5. **Dashboards and rules as files** (`infra/observability`):
   - three Grafana dashboards (API and payments, operations, web vitals);
   - 19 Prometheus alert rules with `page` or `ticket` severity and a runbook each.

   Two checks keep them honest:

   - CI runs `promtool check rules` and `promtool test rules`, with a pinned, checksum-verified
     promtool.
   - A unit test fails when a dashboard or rule names a metric the code does not define.

6. **Thresholds** (starting values, to be tuned with real traffic):
   - **Payments:**
     - any failed webhook processing pages;
     - more than three provider-unavailable results in 10 minutes pages;
     - a payment success rate under 50% (with more than 20 attempts in the hour) pages.
   - **Ticketing:**
     - the oldest booking waiting more than 30 minutes pages;
     - more than 10 bookings waiting for 15 minutes is a ticket;
     - an exhausted ticketing attempt pages.
   - **API:**
     - an error rate above 2% (with real traffic) for 10 minutes pages;
     - p95 outside search above 300 ms for 15 minutes is a ticket.
   - **Suppliers:** more than 20% of calls failing pages.
   - **Workers:** more than 100 waiting jobs is a ticket; missing worker metrics page.
   - **Database:** connections above 80% of the limit page.
   - **Web vitals:** field p75 above the spec's targets for an hour is a ticket.

## Consequences

- Once a backend exists, the dashboards import as they are. Rules load into Prometheus or
  Grafana-managed alerting; `severity` routes them in Alertmanager.
- The gauges add five small queries per minute per API replica, but only when metrics are
  exported.
- Conversion figures from counters are approximate, by up to the rare rolled-back
  transaction. The console's reports (ADR-036) read the database and stay the reference for
  finance.
- Open for the owner: the metrics backend, the on-call tool, and who receives `page` alerts.
