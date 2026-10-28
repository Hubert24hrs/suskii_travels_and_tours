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

| Part | Work                                                                                                                                                                                                                                                              | Decision |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1    | Ads with consent: Meta Pixel and TikTok Pixel on the website after `marketing` consent, the first-visit prompt, server-side Purchase events (Meta Conversions API, TikTok Events API) for consented bookings                                                      | ADR-079  |
| 2    | SEO pages: route facts from a daily fare history (cheapest and typical fare, airlines, direct flights, fastest time, cheapest month), `/flights/from/[city]`, `/flights/to/[city]`, `/airlines/[code]`, internal links, sitemap                                   | ADR-080  |
| 3    | Metasearch: partners with hashed API keys created in the console, `GET /v1/meta/flights` with all-in prices and sealed deep links, per-partner limits, a landing page that re-quotes the itinerary and says when the price moved, partner attribution on bookings | ADR-081  |
| 4    | Prime per country: price entries may name a country, the edge's country picks the entry (else the currency's), console editing, the quote keeps the resolved price                                                                                                | ADR-082  |

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
