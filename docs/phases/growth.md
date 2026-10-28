# Growth

Item 8 of the standards plan agreed with the owner on 2026-10-27: "social media ads (TikTok,
Facebook, Instagram), SEO landing pages, metasearch, referrals and Prime, price alerts and deals",
with Prime "yearly, priced per country".

## Where the platform stands

- Referrals (ADR-031), price alerts (ADR-032), deals and the route and city pages (ADR-011) and
  Suskii Prime (ADR-030) exist. Prime plans carry one price per currency.
- Cookie consent (ADR-042) records each choice before storing it and has `analytics` and
  `marketing` categories with nothing in them yet. It lists what the first marketing tag must
  bring: a first-visit prompt with equal Accept and Reject, a policy version bump, a consent check
  before loading, and a listener for later choices.
- The CSP is nonce-based with `strict-dynamic` (ADR-010): scripts our own bundle inserts are
  trusted, so script hosts need no allowlist.
- Deal snapshots keep every refresh's cheapest fare per route (carrier, stops, duration, dates)
  for `SNAPSHOT_RETENTION_DAYS` (7).
- Route pages show the search form, the latest fare and other routes; there are no hub or airline
  pages.
- Nothing lets a metasearch engine price our flights or lands its clicks.

## Parts

One pull request each, in this order.

| Part | Work                                                                                                                                                                                                                                                                    | Decision |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1    | Ads with consent: Meta Pixel and TikTok Pixel on the website after `marketing` consent, the first-visit prompt, server-side Purchase events (Meta Conversions API, TikTok Events API) for consented bookings                                                            | ADR-079  |
| 2    | SEO pages: route facts from a daily fare history (cheapest and typical fare, airlines, direct flights, fastest time, cheapest month), `/flights/from/[city]`, `/flights/to/[city]`, `/airlines/[code]`, internal links, sitemap                                         | ADR-080  |
| 3    | Metasearch: partners with hashed API keys created in the console, `GET /v1/metasearch/flights` with all-in prices and sealed deep links, per-partner limits, a landing page that re-quotes the itinerary and says when the price moved, partner attribution on bookings | ADR-081  |
| 4    | Prime per country: price entries may name a country, the edge's country picks the entry (else the currency's), console editing, the quote keeps the resolved price                                                                                                      | ADR-082  |

## Part 1: ads with consent

| Step | Work                                                                                                                                                                                                                         | Files                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1    | Shared: policy version 2, the booking's `marketing` attribution schema (consent id and the networks' click ids), ad network names                                                                                            | `packages/shared`                        |
| 2    | Database: `ad_conversions` (booking, consent id, click ids, status, attempts, next attempt); data registry entry and a retention rule                                                                                        | `apps/api/prisma`, `src/privacy`         |
| 3    | API: keep the attribution only when the recorded consent allows marketing; `AdConversionsProvider` (mock, Meta, TikTok); the sweep that sends paid bookings' Purchase events with retries; internal route, metrics, settings | `apps/api/src/marketing`, `src/bookings` |
| 4    | Worker: the sweep every `AD_CONVERSION_SWEEP_MINUTES`                                                                                                                                                                        | `apps/worker`                            |
| 5    | Website: runtime pixel settings, CSP hosts when configured, the first-visit prompt, the tag loader after consent, standard events, the attribution at checkout, cookie catalog entries; copy in every catalog                | `apps/web`, `packages/i18n`              |
| 6    | Tests: shared and API unit tests, API e2e (consent check, sweep, retries, privacy), website e2e (prompt, nothing before consent, events after it, stubbed networks), Lighthouse with the prompt                              | `apps/*/test`, `apps/web/e2e`            |
| 7    | Docs: ADR-079, ADR-042 note, security docs (data classification, external communications, crypto inventory), store forms, settings in Terraform and Helm, CHANGELOG, CLAUDE.md                                               | `docs`, `infra`                          |

Risks:

- **Consent bypass.** A tag that loads before consent, or a server event for someone who said no,
  breaks the NDPA and the GDPR. The tags load only from the consent listener; the server re-reads
  the recorded consent and never trusts the browser's flag. E2e tests prove that nothing reaches a
  network host before consent.
- **Homepage speed.** The prompt and the loader must not move the 170 kB budget or the Lighthouse
  gate. Both load only when needed; the prompt is fixed-position.
- **No real provider in tests.** The networks' hosts are stubbed in every website test and the API
  uses the mock adapter.

## Part 1 outcome

Built. Ads stay off until the owner sets the pixel ids and tokens (staging first, with the test
event codes).

- The base homepage was 101 bytes under its 170 kB budget, so the prompt and the tags had to stay
  out of the code every page loads. The server reads the consent cookie per request; the prompt
  loads only without a choice and the tags only while marketing is allowed. The header's
  signed-in check stopped pulling in the session refresh code. The homepage ships 173,815 bytes
  in 11 scripts (base 173,979).
- Content ids are booking verticals on both the website and the server.

| Check                            | Result                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint and typecheck               | 25 of 25 tasks                                                                                                                                 |
| API unit tests with coverage     | 594 passed (51 suites)                                                                                                                         |
| API e2e                          | 524 of 524 outside the S3 suite (no container runtime locally; CI runs it); the ad conversion suite 5 of 5                                     |
| Shared, i18n, worker, app (Jest) | 248, 33, 50 and 250 passed                                                                                                                     |
| Website e2e                      | 117 of 118 (main and slow-3G projects all pass)                                                                                                |
| Lighthouse (local)               | Total blocking time only, median 248 ms at CPU benchmark 1,252; the base fails the same way on this machine (262 ms at 1,238). CI is the judge |

## Part 2: SEO pages from fare history

Route pages today show the search form, the latest fare and other routes from the same city.
Search engines rank pages that answer the questions travellers ask ("how much is a flight from
Lagos to London", "which airlines fly it", "is there a direct flight", "when is it cheapest").
The deal refresh already finds those answers every few hours and throws most of them away.

| Step | Work                                                                                                                                                                                                                           | Files                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 1    | Database: `route_fares`, the cheapest fare a refresh found per route, day and departure date (supplier cost, carrier, stops, duration), kept `ROUTE_FARE_RETENTION_DAYS` (400); data registry entry, no personal data          | `apps/api/prisma`, `src/privacy`                 |
| 2    | API: the refresh records every departure date it searched; `RouteFactsService` turns 30, 90 and 365 days of fares into facts priced at read time (markup, tax, currency) and only once enough days exist                       | `apps/api/src/deals`                             |
| 3    | API: `facts` on the route detail (additive); city hubs `GET /v1/deals/cities` and `/cities/{slug}` (routes from and to a city); airline pages `GET /v1/deals/airlines` and `/airlines/{code}` (routes the airline was seen on) | `apps/api/src/deals`, `openapi.json`, api-client |
| 4    | Website: facts on route pages; `/flights/from/[city]`, `/flights/to/[city]`, `/airlines/[code]`; links between them; metadata, canonical paths, breadcrumbs, sitemap; copy in every catalog                                    | `apps/web`, `packages/i18n`                      |
| 5    | Tests: unit tests for the fact rules, API e2e (recording, facts, hubs, airlines, thresholds, pruning), website e2e (pages, links, sitemap, hydration, axe)                                                                     | `apps/api`, `apps/web/e2e`                       |
| 6    | Docs: ADR-080, CHANGELOG, CLAUDE.md, data classification (internal), business limits                                                                                                                                           | `docs`                                           |

Risks:

- **Misleading prices.** A "typical fare" must say what it is: one adult, return, the route's
  cabin, priced today with today's rules from fares found in the last 90 days. Facts appear only
  with enough observation days (`ROUTE_FACTS_MIN_DAYS`, 3), and sample (mock) fares stay badged.
- **Supplier cost leaking.** `route_fares` holds supplier cost; only priced values leave the API,
  as everywhere else.
- **Thin pages.** Hub and airline pages render only with at least one route; empty ones answer
  404 and stay out of the sitemap.
- **Homepage budget.** Nothing here touches the homepage.

## Part 2 outcome

Built. Facts start appearing three days after the first deployed refreshes; hubs and airline
pages appear as soon as a route has fares.

- The new pages are server-rendered and add no JavaScript to the homepage.
- The IDOR matrix classifies the new hub and airline routes as public reads of published
  routes.

| Check                            | Result                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint and typecheck               | 25 of 25 tasks                                                                                                                              |
| API unit tests with coverage     | 601 passed (52 suites), coverage gates met                                                                                                  |
| API e2e                          | 530 of 530 outside the S3 suite (no container runtime locally; CI runs it); the route facts suite 6 of 6                                    |
| Shared, i18n, worker, app (Jest) | 249, 33, 50 and 250 passed                                                                                                                  |
| Website e2e                      | 121 of 122: every journey, SEO, hydration and slow-3G test passes                                                                           |
| Lighthouse (local)               | Total blocking time only, median 253 ms; nothing here touches the homepage and the base fails the same way on this machine. CI is the judge |
| Tailwind classes, security list  | `check:classes` clean, `security:checklist --check` up to date                                                                              |

## Part 3: metasearch

Metasearch engines (Google Flights, Skyscanner, KAYAK, Wego, Momondo) send a large share of
flight bookings to online travel agencies. Each one asks the agency's live API for fares on a
route and dates, shows the price beside the airlines' own, and sends the traveller to the agency
through a deep link. Google's partner rules set the bar: a deep link to a page showing the chosen
itinerary (not a search page), at least 95% of links working, and at least 90% of prices matching
on arrival, checked by crawlers every day.

| Step | Work                                                                                                                                                                                                                                                        | Files                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1    | Database: `metasearch_partners` (name, code, key HMAC and prefix, limits, active) and `metasearch_landings` (partner, outcome, shown and landed totals); quotes and bookings carry the landing; data registry entries and a retention rule                  | `apps/api/prisma`, `src/privacy`          |
| 2    | API: `GET /v1/metasearch/flights` behind the partner's `X-Api-Key`, per-partner limits per minute and per day, all-in prices from the website's pricing, sealed deep links (`METASEARCH_LINK_TTL_HOURS`); no search analytics row for partner traffic       | `apps/api/src/metasearch`, `src/search`   |
| 3    | API: `POST /v1/metasearch/landings` finds the itinerary again, quotes it with the supplier, compares the total with the partner's price (same, lower, higher, gone, expired), records the landing and ties the quote to it; bookings copy it from the quote | `apps/api/src/metasearch`, `src/bookings` |
| 4    | Admin API and console: partners (create and rotate show the key once, step-up), limits and deactivation, a 30-day report per partner (landings by outcome, price accuracy, bookings and value per currency)                                                 | `apps/api/src/metasearch`, `apps/admin`   |
| 5    | Website: `/flights/go/[token]` re-quotes and goes straight to checkout when the price held or fell, says what changed when it rose, and offers the same search when the flight is gone; private, never indexed                                              | `apps/web`, `packages/i18n`               |
| 6    | Tests: unit tests (keys, sealed links, outcomes), API e2e (keys, limits, prices match the website, landings, attribution, console routes, audit), website e2e (landing outcomes), admin e2e (create, rotate, report)                                        | `apps/*`                                  |
| 7    | Docs: ADR-081, security docs (authentication, access control, crypto inventory, data classification, business limits), settings in Terraform and Helm, CHANGELOG, CLAUDE.md                                                                                 | `docs`, `infra`                           |

Risks:

- **Price accuracy.** A partner price that does not hold on arrival costs the listing. The API
  prices partner fares exactly as the website prices a guest's search, and the landing quotes the
  same itinerary with the supplier before showing anything. Landings record every outcome, so the
  console shows each partner's accuracy before the partner does.
- **Supplier search costs.** Partners can ask far more often than people do, and suppliers charge
  for excessive look-to-book ratios. Partner requests share the search cache, are capped per
  minute and per day per partner, and invalid keys are limited per address.
- **Key leaks.** Keys are 256-bit random values stored only as an HMAC, shown once, rotated in
  one step (the old key stops at once), and every creation and rotation is audited and needs a
  recent authenticator check.
- **Tampered links.** Deep links are sealed (AES-256-GCM), so the itinerary, price and partner
  cannot be changed, and they carry no personal data.
