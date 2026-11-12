# ADR-087: Availability objectives and the status page

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Roadmap item 11 asks for 99.9% uptime and a status page. The platform has probes, a canary with
automatic rollback, threshold alerts and Sentry (ADR-046, ADR-047, ADR-060), but no availability
target, no error budget, nothing that checks the site from outside (when everything is down,
nothing reports and the alerts go quiet), and no page travellers or partners can open during an
incident. Metasearch partners (ADR-081) and company accounts (ADR-078) ask for an availability
commitment.

## Decision

1. **Objectives.** Over 30 days: the API answers 99.9% of requests without a 5xx (43 minutes of
   budget); the booking path (quotes, bookings, payments, not staff routes) 99.5%; the website,
   `/ready` and `/v1/status` pass 99.9% of uptime checks. A 4xx is a good event: the API did its
   job. Probes are not traveller traffic and are left out.
2. **Burn-rate alerts.** Recording rules keep the error ratio over 5 minutes, 30 minutes, 1 hour,
   6 hours and 3 days. Alerts follow the Google SRE workbook's multi-window, multi-burn-rate method:
   page at 14.4x (1 hour and 5 minutes) and 6x (6 hours and 30 minutes), ticket at 1x (3 days and
   6 hours). Paging alerts also need some traffic, so one failed request at night never pages.
   Promtool tests cover a fast outage, errors inside the budget, a quiet night, the booking path
   and a slow burn (`infra/observability/alerts/suskii.slo.rules*.yml`).
3. **Checks from outside.** Cloud Monitoring requests the website, `/ready` and `/v1/status`
   through Cloudflare every minute from three continents (Africa has no checker region yet), and
   alerts the on-call channels when a check fails from two regions for two minutes
   (`infra/terraform/modules/monitoring`).
4. **Components, not suppliers.** The status page names what a traveller does: search, bookings,
   payments, accounts, support. It never names a supplier or payment provider; those names are
   commercial, and a partner's outage is ours to explain.
5. **Measured and declared states.** `GET /v1/status` measures every 30 seconds: Postgres and
   Redis (readiness), supplier circuit breakers, paused payment providers and the oldest booking
   waiting for ticketing (30 minutes makes bookings degraded). Each component takes the worse of
   what is measured and what open incidents declare (`minor` degraded, `major` outage). Search is
   degraded when some of a vertical's suppliers fail and an outage only when every supplier of
   both verticals does.
6. **Breakers across instances.** Breakers live in each API instance (ADR-009). When one opens,
   the instance marks the supplier in Redis for two minutes (`status:breaker:<vertical>:<name>`),
   and a failed probe marks it again, so every instance's answer agrees. Marks are best effort: a
   Redis error never fails a search.
7. **One measurement for everyone.** The page is cached in Redis for 30 seconds and the answer
   says `public, max-age=30, stale-while-revalidate=30, stale-if-error=86400`. A Cloudflare cache
   rule keeps it at the edge as the API says, so the last good copy is served while the origin
   does not answer. When the database is down the API still answers, truthfully: the components
   that need it show an outage and incidents come from the last copy saved in Redis.
8. **Incidents.** Staff with the new `status:manage` (operations, support, super admins) open an
   incident (title, impact, components, stage, first update), post updates and resolve it in the
   console. A resolved incident takes no more updates (409 `incident-resolved`; a conditional
   update claims the change). Every change is audited with names only; the public text has no
   author. Resolved incidents are purged a year after they end (`status-incidents`).
9. **Where travellers see it.** The website's `/status` (footer, sitemap) and a server-rendered
   strip above the header on every page while an incident is open; the app's Status screen
   (Account) and the same banner on Home and Trips. A failed status read shows nothing.
10. **No cached HTML.** The website's status page renders per request like every page (ADR-010).
    Caching its HTML at the edge would hand every visitor the same CSP nonce. The JSON is what the
    edge keeps; the app reads it directly.

## Consequences

- The team has a number to protect. When the month's budget is gone, reliability work comes
  before features (runbook `slo-burn.md`).
- Shared fate remains for the website: if the website itself is down, so is `/status` on it. The
  app still gets the edge's copy of the JSON. A third-party status host is the stronger option and
  is recorded for the owner.
- Thresholds come from the workbook defaults and need tuning once real traffic exists.
- Uptime checks reach the site through Cloudflare. If the zone's security level or bot settings
  challenge Google's checkers, the checks fail; the fix is a setting, never a WAF bypass by user
  agent.

## Alternatives considered

- **A hosted status page (Statuspage, Instatus, Better Stack).** Independent of our platform, but
  another vendor with personal data of subscribers and a monthly cost; recorded for the owner as
  the step after this one.
- **Threshold alerts only.** Already present (2% for 10 minutes); they page late on slow burns and
  early on blips, and say nothing about the monthly commitment.
- **Supplier names on the page.** Clearer to engineers, but commercial information and confusing
  to travellers.
