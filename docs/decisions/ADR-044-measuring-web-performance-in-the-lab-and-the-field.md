# ADR-044: Measuring web performance in the lab and the field

- Status: Accepted
- Date: 2026-10-07
- Deciders: Claude Code (implementer), pending owner review

## Context

`PROJECT_SPEC.json#/performance/web_targets` sets LCP 2 s, INP 200 ms and CLS 0.1. These are Core
Web Vitals, which are defined on real visits at the 75th percentile. Before phase 11:

- the Lighthouse gate checked only category scores;
- nothing measured real visits.

Measurements on the homepage (local production build, Lighthouse 13, mobile preset):

| Metric | Simulated throttling | Applied (DevTools) throttling |
| ------ | -------------------- | ----------------------------- |
| LCP    | 2.4 s to 2.9 s       | 1.69 s to 1.76 s              |
| FCP    | 1.0 s                | 1.7 s                         |
| TBT    | 80 to 90 ms          | 215 to 508 ms                 |
| CLS    | 0                    | 0                             |

The browser itself painted the LCP element (the hero heading) at about 200 ms, together with FCP.
Simulated LCP is an estimate: it charges every request that finished before the observed paint.
On a fast machine, Next's async scripts (168 kB) sometimes arrive before that paint and sometimes
after it. A phone on 4G gets the HTML and CSS long before the scripts, so simulated LCP swings
with a race that real visitors never run.

Applied throttling reproduces the real loading order, so its LCP is stable. Its TBT is noisy
instead: React hydration is about 65 ms of work, which becomes about 260 ms on a CPU slowed four
times.

## Decisions

1. **The lab gate measures each metric where it is stable.** `apps/web/scripts/lighthouse.ts`
   (run by the web e2e suite) judges medians of three runs per method:
   - **Simulated throttling** (what PageSpeed Insights reports):
     - performance score at least 90, accessibility 100, SEO 100;
     - CLS at most 0.1;
     - TBT at most 200 ms.
   - **Applied throttling:** LCP at most 2.5 s, and CLS at most 0.1.
   - The limits are Lighthouse's mobile "good" boundaries. They guard against regressions; they
     are not the spec's targets.
2. **The spec's targets are judged in the field.**
   - The website reports Core Web Vitals from real visits, with `web-vitals` 6. It sends LCP, INP
     and CLS, plus FCP and TTFB, which help explain them.
   - `POST /v1/telemetry/web-vitals` records the values as OpenTelemetry histograms
     (`suskii.web_vitals.*`), grouped by page template and device class. The buckets are fine
     around each "good" threshold, so the 75th percentile reads accurately.
   - Phase 11E's dashboards and alerts compare the 75th percentiles with the spec.
3. **Off the critical path.**
   - `WebVitalsReporter` in the root layout is a few lines. The library loads five seconds after
     the `load` event, or at the first interaction if that comes sooner. The library reads
     buffered performance entries, so loading late loses nothing.
   - The reporter therefore never competes with rendering. It loads after the homepage's initial
     JavaScript and is not part of it.
   - A visitor who leaves within five seconds without interacting sends nothing. Those visits
     are missing from the data.
4. **Beacons.**
   - The page keeps the latest value of each metric and sends them with `navigator.sendBeacon`
     whenever it is hidden. `sendBeacon` is the documented way to report as a page closes.
   - A string body goes as `text/plain`, a CORS-safelisted type, so there is no preflight.
   - The API reads a `text/plain` body as JSON only on routes in `BEACON_PATHS`
     (`common/beacon-body.middleware.ts`), capped at 8 KB. Elsewhere such bodies stay unparsed,
     so a cross-site form cannot post JSON to any other route.
   - The contract flag `beacon: true` documents `text/plain` in the OpenAPI document. Building
     the document fails if the flag and `BEACON_PATHS` disagree.
5. **No personal data.**
   - A report holds the page template (from a fixed list in `@suskii/shared`; ids, slugs and
     query strings never leave the browser), `mobile` or `desktop`, and the values.
   - It carries no account, URL or identifier. The API keeps nothing but histogram counts and
     leaves these requests out of the access log.
   - Nothing is stored in the browser, so no cookie consent is needed (ADR-042).
   - The route is public and rate-limited per IP (120 per 10 minutes). Values are bounded per
     metric, and each metric appears at most once per report.
6. **Sampling.** `NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE` (0 to 1, default 1) sets the share of page
   views that report. Lower it if traffic grows large.

## Consequences

- Field data starts with launch. Until then, the lab gate is the only check, and it uses
  Lighthouse's limits rather than the spec's.
- Metrics belong to the page the visit landed on. CLS and INP keep adding up across client-side
  navigation until the page is hidden.
- Someone could skew the histograms with made-up reports. The rate limit and value bounds keep
  that small, and the data is never used for anything but dashboards.
- Hydration costs about 260 ms of main-thread time on a slow phone. Field INP will show whether
  it hurts. If it does, the next step is deferring hydration of the search card (ADR-013,
  option 3).
