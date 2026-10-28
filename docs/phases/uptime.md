# 99.9% uptime and a status page

Item 11 of the roadmap agreed with the owner (US and European standards for African markets): an
availability target travellers and partners can rely on, measured from outside, alerted on before
the month's budget is gone, and a public status page with incident notes written by staff.

## Why

Booking.com, Expedia and the airlines publish status pages; metasearch partners (ADR-081) and
company accounts (ADR-078) ask for an availability commitment before they send traffic. A
traveller whose payment fails during an outage should find out from us, in their language, not
from social media. An error budget also tells the team when to stop shipping features and fix
reliability.

## Where the platform stands

- Cloud Run services with startup and liveness probes (`/health`), readiness (`/ready`: Postgres
  and Redis), minimum instances per environment, the canary release with automatic rollback
  (ADR-060) and Cloudflare in front (ADR-059).
- Prometheus alert rules on the error rate (2% for 10 minutes), latency, payments, ticketing,
  queues and the worker; Grafana dashboards; Sentry for errors (ADR-046, ADR-047).
- Missing: an availability target and error budget, alerts on how fast the budget burns, checks
  from outside the platform (today's alerts go quiet when everything is down, because nothing
  reports), and a page travellers can open during an incident.

## Targets

| Service                      | Objective (30 days)          | Measured as                                                                                      |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| API                          | 99.9% (43 minutes of budget) | Share of API requests answered without a 5xx (4xx count as good), from the API's own HTTP metric |
| Booking path                 | 99.5% (3 hours 36 minutes)   | Share of quote, booking and payment requests without a 5xx (a supplier's refusal is a 4xx: good) |
| Website and API from outside | 99.9%                        | Share of uptime checks that pass, from three continents (Cloud Monitoring)                       |

Probes (`/health`, `/ready`) are left out of the request SLIs: they are not traveller traffic.

## Plan

| Step | Work                                                                                                                                                                                                                                                                               | Files                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1    | SLO recording rules (request and error ratios over 5m, 30m, 1h, 6h and 3d) and multi-window burn-rate alerts: page at 14.4x (1h and 5m) and 6x (6h and 30m), ticket at 1x (3d and 6h); promtool unit tests; CI checks every rule file                                              | `infra/observability/alerts`, `ci.yml`       |
| 2    | Uptime checks (Cloud Monitoring) on the website, the API's `/ready` and `/v1/status` through the edge, from three regions, and an alert policy to the on-call channels when a check fails from two regions for two minutes                                                         | `infra/terraform/modules/monitoring`, `live` |
| 3    | Edge cache rule for `/v1/status` that follows the API's `Cache-Control`, so Cloudflare answers with the last good copy (`stale-if-error`) while the origin is down                                                                                                                 | `infra/terraform/modules/edge`               |
| 4    | Status API: `GET /v1/status` (public, compressed, cached 30 s in Redis and at the edge): components (search, bookings, payments, accounts, support) from readiness, supplier circuit breakers across instances, paused payment providers and the ticketing backlog, plus incidents | `apps/api/src/status`                        |
| 5    | Incidents: staff open an incident (title, impact, affected components, first update), post updates and resolve it in the console; every change audited; new permission `status:manage` (operations and support); resolved incidents purged after a year                            | API admin routes, `apps/admin`               |
| 6    | Website: `/status` (overall state, components, open incidents with their timeline, the last 7 days) and a banner on every page while an incident is open (server-rendered, no JavaScript); app: the same banner on Home and Trips and a Status screen                              | `apps/web`, `apps/mobile`                    |
| 7    | Runbook for an SLO burn, ADR-087, settings, security docs, CHANGELOG and CLAUDE.md                                                                                                                                                                                                 | `docs`                                       |

## Decisions

- **Components, not suppliers.** The page names what a traveller does (search, book, pay, sign
  in, get help), never a supplier or payment provider: those names are commercial, and a partner
  outage is ours to explain.
- **Automatic and declared states.** Each component takes the worse of what the API measures and
  what an open incident declares (`minor` means degraded, `major` an outage). Measurement catches
  what staff have not noticed yet; incidents explain what measurement cannot see (the website, a
  supplier answering slowly).
- **Breakers across instances.** Circuit breakers live in each API instance; when one opens, the
  instance marks the supplier in Redis for two minutes, so every instance's status answer agrees.
  Search is degraded when some of a vertical's suppliers are marked and an outage when all are.
- **Truth over a green page.** When the database is down the API still answers `/v1/status` with
  the affected components in outage (incidents from the last good copy in Redis); Cloudflare's
  stale copy is only for when the API does not answer at all.
- **No nonce reuse.** The website's `/status` renders per request like every page (ADR-010);
  caching nonce'd HTML at the edge would hand every visitor the same CSP nonce. The JSON is what
  the edge keeps, and the app reads it directly. A third-party status host is the stronger
  option against shared fate and is recorded for the owner.

## Risks

- **Shared fate.** A status page served by the platform goes down with it: the edge copy of the
  JSON covers the app, the website page does not survive a website outage. Recorded for the owner.
- **Alert noise.** Burn-rate alerts with two windows each page only when the budget is really at
  risk, and only with enough traffic to judge; the ticket-level alert catches slow burns.
- **No real traffic yet.** Thresholds start from the SRE workbook defaults and are tuned after
  launch.
