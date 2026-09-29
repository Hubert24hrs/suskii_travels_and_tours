# Phase 4: Web homepage

Status: done, awaiting review

## Goal

Ship the public homepage (`PROJECT_SPEC.json#/homepage_spec`) on real API data: every section in
order, a fully working flight search form with shared Zod validation and URL-serialised queries,
working forms for the other five verticals, deals produced by the worker from mock suppliers, hotel
destinations from the CMS with minimum prices from hotel search, CMS-driven trust signals, and SEO
(metadata, JSON-LD, Open Graph image, sitemap).

## Acceptance criteria (from PROJECT_SPEC.json)

1. Lighthouse mobile >= 90 performance, 100 accessibility, 100 SEO on the homepage.
2. Responsive at 360, 768, 1024 and 1440 pixel widths.
3. Playwright homepage tests pass.

## Plan

### Shared foundations

| Package          | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@suskii/shared` | `search-url.ts`: flight and hotel forms to and from URL query parameters (shareable results links, deal links, mobile deep links later); strict parsing through the shared schemas. Form schemas for packages (destination, month or dates, travellers, budget), tours (destination or keyword, date, travellers), visa (nationality, destination, purpose, travel date) and add-ons (standalone or attached to a booking). fast-check round-trip tests. |
| `@suskii/i18n`   | New workspace (was README only): typed English message catalog with `en-NG`, `en-GB` and `en-US` overlays, a tiny translator (interpolation, plural forms through `Intl.PluralRules`), money, date, date-range and relative-time formatting. No runtime dependency, so the same catalogs serve React Native in phase 7.                                                                                                                                  |
| `@suskii/ui-web` | `DealCard` gains an optional status badge (used for "Sample fare" on mock quotes); a `FilterChip` toggle for the deals origin filter. Stories and axe tests as usual.                                                                                                                                                                                                                                                                                    |

### API (`apps/api`)

- **Migration 3**: `deal_routes` (origin and destination airports, slug, stay length, cabin, active,
  order), `deal_snapshots` (cheapest fare found per refresh: dates, airline, stops, duration,
  supplier price and pricing context, fetched at), `destination_contents` (CMS: city, slug,
  featured, order, optional image URL, published), `destination_hotel_snapshots` (hotel count and
  cheapest rate per refresh), `newsletter_subscriptions` (double opt-in state, consent record,
  hashed tokens, optional WhatsApp opt-in).
- **Seed**: starter deal routes from the five origin cities in the spec (Lagos, Abuja, Port
  Harcourt, Accra, Nairobi) and the nine hotel destinations it lists; the homepage CMS blocks are
  created published with the spec copy. Business facts (Prime price, support phone, social links,
  app store links, legal texts) stay empty and their UI stays hidden until the owner sets them.
- **Content** (`GET /v1/content/site`, `GET /v1/content/home`, `GET /v1/content/pages/{slug}`):
  published CMS blocks only, verified trust signals only (filtered in the query), published FAQs,
  and payment methods derived from the implemented payment providers (none until phase 6).
- **Deals** (`GET /v1/deals/flights`, `GET /v1/deals/routes/{slug}`): latest fresh snapshot per
  active route, priced at read time with the pricing engine (current markups, display currency,
  sales channel), labelled `sample: true` when the supplier is the mock, with `updatedAt`. Stale
  snapshots (older than `DEALS_MAX_AGE_HOURS`) are never returned.
- **Hotel destinations** (`GET /v1/destinations/hotels`, `GET /v1/destinations/hotels/{slug}`):
  featured, published CMS destinations with hotel count and "from" nightly price, priced at read
  time.
- **Internal routes** (`/v1/internal/...`, `@InternalRoute()`): list refresh targets, refresh one
  deal route, refresh one destination, prune old snapshots. Authenticated with a service token
  (`INTERNAL_API_TOKEN`, constant-time comparison), excluded from browser CORS use, rate limited.
  The refresh reuses the search orchestration (cache, circuit breakers, validation).
- **Newsletter** (`POST /v1/newsletter/subscriptions`, `/confirm`, `/unsubscribe`): email plus
  optional WhatsApp opt-in, explicit consent (versioned), Cloudflare Turnstile verification behind
  a `TurnstileVerifier` interface (mock adapter when no secret is set outside production), double
  opt-in email with a hashed, expiring token in the URL fragment, one generic response (no
  enumeration), strict rate limits per IP and per email.

### Worker (`apps/worker`)

BullMQ job schedulers: refresh all deal routes every `DEALS_REFRESH_INTERVAL_MINUTES` (default 180) and all hotel destinations every `DESTINATIONS_REFRESH_INTERVAL_MINUTES` (default 360), fanned
out to one job per route or destination with retries and exponential backoff, a rate limiter to
respect supplier quotas, and a daily prune. Jobs call the internal API with a typed client
(`openapi-fetch` + `@suskii/api-client` types). `pnpm --filter @suskii/worker refresh:once` runs a
full refresh without the queue (local development and e2e setup).

### Web (`apps/web`)

- **Rendering and security**: `proxy.ts` sets a per-request nonce CSP (`script-src 'nonce-…'
'strict-dynamic'`, `frame-ancestors 'none'`, Turnstile allowed) plus HSTS, Referrer-Policy,
  Permissions-Policy and nosniff. Nonces require dynamic rendering, so pages render per request and
  API data is cached with `fetch` revalidation (content 5 min, deals 5 min, catalog 1 day). ADR-010.
- **Preferences**: currency (header) and locale (footer) in functional cookies, set by a server
  action; server components format prices and dates accordingly.
- **Layout**: sticky header with a compact state on scroll, text wordmark, primary nav, currency
  selector, Manage booking, support contact (when set in the CMS), Sign in; hamburger drawer on
  mobile. Footer with company, support and legal links (published CMS pages only), social links,
  currency and locale, copyright.
- **Homepage sections, in spec order**: hero with verified trust bar; search module; trust strip;
  fresh flight offers (origin chips, carousel on mobile, 4-column grid on desktop, each card links
  to a pre-filled search); top hotel destinations; Suskii Prime promo; flexible payment explainer
  (honest terms from `features.flexible_payment`); packages and tours teaser; why book with us; app
  download (badges and QR code only when store links exist); newsletter; FAQ and popular routes and
  destinations link grid; footer.
- **Search module**: six tabs. Flights: trip type, from/to autocomplete (edge-cached popular index
  with API fallback, recent searches, cities grouping their airports), swap, date range (single for
  one way), 2-5 multi-city legs, travellers, cabin, direct only, flexible dates; shared Zod schema;
  last search persisted locally; submit navigates to `/flights/search?…`. Hotels, packages, tours,
  visa and add-ons are working, validated forms that route to their pages with the query in the
  URL. Non-default tab forms load on demand to keep the homepage JavaScript small.
- **Other routes**: vertical landing pages (`/flights`, `/hotels`, `/packages`, `/tours`, `/visa`,
  `/travel-add-ons`) with the right tab open and a pre-filled form; search entry pages
  (`/flights/search`, `/hotels/search`, noindex) showing the parsed search, ready for phase 5
  results; programmatic SEO pages `/flights/{origin}-to-{destination}` and `/hotels/{city}` with
  cached deal and price data; `/deals`; newsletter confirm and unsubscribe; CMS legal pages; a
  helpful 404.
- **SEO**: per-page metadata and canonical URLs, Open Graph and Twitter cards, a generated OG image,
  JSON-LD (Organization, WebSite, FAQPage, BreadcrumbList), `sitemap.xml` from the API's routes and
  destinations, `robots.txt`.
- **Imagery**: original SVG illustrations until licensed photography exists (brand assets are an
  open owner question; the photo hosts are also unreachable from the build sandbox). CMS image URLs
  render through `next/image` (AVIF/WebP) when set. ADR-010.

### Tests

- Unit: search URL round trips, vertical form schemas, i18n translator and formatters, deals and
  destination pricing, newsletter token handling, internal token guard, worker processors.
- API e2e: content (verified-only trust signals, published-only blocks), deals and destinations
  (freshness, sample label, currency), internal routes (token required), newsletter double opt-in.
- Playwright (`apps/web/e2e`, real API with mock suppliers, Postgres and Redis): every section in
  order, trust guardrails, flight form validation, URL serialisation, persistence, multi-city,
  other tabs routing, deals filter and links, currency switch, newsletter, responsive layout at 360,
  768, 1024 and 1440 (no horizontal overflow, nav and carousel behaviour), axe at each width,
  metadata, JSON-LD, sitemap, robots, OG image and security headers.
- Lighthouse (mobile preset) with thresholds from the acceptance criteria, and the homepage
  JavaScript budget (170 kB gzip target; see the implementation notes and ADR-013).

## Risks and mitigations

| Risk                                                                                  | Mitigation                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nonce CSP forces dynamic rendering (no ISR, no CDN HTML cache)                        | Data-level caching with revalidation, small server-rendered HTML, client JS only for interactive parts; measured with Lighthouse (ADR-010)                  |
| 170 kB JavaScript budget with forms, date picker, autocomplete and Zod                | Other tabs, schemas, overlays and the calendar load on demand; `@suskii/shared/lite` keeps Zod out; measured in e2e with a ratchet until phase 11 (ADR-013) |
| Showing unverified claims or fabricated prices                                        | Trust signals filtered to `verified` in the API query; deal prices only from snapshots with timestamps and a "Sample fare" label for mock supplier quotes   |
| Business facts missing (Prime price, support phone, legal texts, apps)                | CMS fields empty by default; their UI stays hidden until set; listed as owner decisions                                                                     |
| No licensed photography, photo hosts blocked from the sandbox                         | Original SVG illustrations; CMS image URLs supported for real photos later                                                                                  |
| Turnstile unreachable from the sandbox                                                | `TurnstileVerifier` interface; tests use the mock adapter; production refuses to start without a secret                                                     |
| Worker needs supplier access but suppliers live in the API                            | Worker schedules and retries; the API performs refreshes through token-guarded internal routes (ADR-011)                                                    |
| Docker daemon unavailable in this session                                             | Local Postgres 16 and Redis 7 run natively; e2e suites use `E2E_DATABASE_URL` / `E2E_REDIS_URL`; CI keeps Testcontainers                                    |
| Pages linked from the header that later phases build (sign in, manage booking, Prime) | Links point to their final routes; a helpful 404 page covers them until phases 5-9                                                                          |

## Implementation notes

What changed against the plan while building and measuring:

- **Performance work (ADR-013).** The first full build scored 78 on Lighthouse with 328 kB of
  JavaScript. Schemas now load on form interaction, `@suskii/shared/lite` gives render code a
  Zod-free entry, Radix popovers and dialogs (pickers, mobile menu) and the calendar load on first
  open, card art moved to cached SVG images under `/art`, and only the latin font subsets are
  preloaded. Result: 202 kB and a median score of 97 (accessibility, best practices and SEO 100).
  The e2e suite enforces a 210 kB ratchet; the spec's 170 kB target moves to phase 11.
- **Found and fixed by the new tests**: `cn()` could not merge `max-w-page` with `max-w-dialog`
  (container tokens were unknown to tailwind-merge); segmented controls and the route page
  overflowed at 360 px; the utility bar sat outside any landmark; Zod's eval probe tripped the CSP;
  unnamed hidden radio inputs; a generic "Learn more" link; the sitemap was prerendered at build time
  without API data.
- **E2E harness**: `apps/web/e2e/stack.ts` boots Postgres and Redis (Testcontainers, or
  `WEB_E2E_DATABASE_URL` / `WEB_E2E_REDIS_URL`), migrates and seeds, starts the built API with a
  per-run internal token, runs one worker refresh and starts the built web app. `E2E_BASE_URL`
  targets a running stack instead. Tests read copy from the i18n catalog and fail on console
  errors and DevTools issues (CSP, mixed content, unnamed fields).
- **CI**: the verify job gains Postgres and Redis service containers (web e2e and the worker's
  BullMQ test), a web e2e plus Lighthouse step using Playwright's headless shell, report artifacts,
  and the Tailwind class check after the build.
- **Session environment**: Docker was unavailable, so local runs used native Postgres 16 and
  Redis 7; image hosts and Cloudflare Turnstile are blocked from the sandbox (mock verifier, SVG
  art). CI keeps Testcontainers for the API suite.
