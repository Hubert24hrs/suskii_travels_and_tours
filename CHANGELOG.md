# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow the delivery phases in
`PROJECT_SPEC.json` until the first production release.

## [Unreleased]

### Phase 4: Web homepage (2026-09-29)

#### Added

- Web homepage with every section of the spec in order, on live API data: hero with verified trust
  bar, search card, trust strip, fresh flight offers (origin chips, carousel on mobile, grid on
  desktop, each card a pre-filled search), top hotel destinations with "from" prices, Suskii Prime,
  flexible payment, packages and tours, why book with us, app download, deal alerts, FAQ and
  popular routes and destinations.
- Search card with six tabs. Flights: round trip, one way and multi-city (2-5 legs), airport
  autocomplete (edge-cached popular index with API fallback, recent places), swap, date range
  (two months on desktop, full-screen on mobile), travellers, cabin, direct only, flexible dates,
  last search restored. Hotels, packages, tours, visa and add-ons are validated forms that route to
  their pages. All forms use the shared Zod schemas and serialise to shareable URLs; the add-ons
  booking mode keeps the last name out of the URL.
- Pages: vertical landing pages, flight and hotel search entry pages (noindex, ready for phase 5
  results), programmatic `/flights/{origin}-to-{destination}` and `/hotels/{city}` pages, `/deals`,
  CMS info pages, newsletter confirm and unsubscribe, a helpful 404 and an error page.
- SEO: per-page metadata and canonical URLs, Open Graph and Twitter images, JSON-LD
  (TravelAgency, WebSite, FAQPage, BreadcrumbList), sitemap from the API's routes and destinations,
  robots.txt, web manifest and icons. Card illustrations served as cached SVG images from `/art`.
- Nonce-based CSP per request (`proxy.ts`) with `strict-dynamic`, HSTS, nosniff, frame and
  referrer policies (ADR-010). Currency and locale preferences in functional cookies.
- `@suskii/i18n`: typed catalogs (en-NG, en-GB, en-US), plural-aware translator and `Intl`
  formatters shared by web and, later, mobile.
- `@suskii/shared`: search URL serialisation for flights and hotels, form schemas for packages,
  tours, visa and add-ons, and a Zod-free `@suskii/shared/lite` entry for browser rendering.
- API: homepage content (`/v1/content/site`, `/home`, `/pages/{slug}`; verified trust signals and
  published blocks only), flight deals and routes, hotel destinations, city lookup, token-guarded
  internal refresh routes, and double opt-in deal alerts with Turnstile (ADR-011, ADR-012).
  Migration 3 adds deal routes and snapshots, destination content and snapshots, and newsletter
  subscriptions; the seed adds 22 starter routes and 9 destinations.
- Worker: BullMQ job schedulers refresh deals every 3 hours and destinations every 6 hours with
  retries, backoff and a rate limit, prune old snapshots daily; `refresh:once` for local setup.
- ui-web: filter chips, status badges on deal and destination cards, validation errors on the
  date and traveller pickers, `useDeferredOverlay` with lazily loaded popover and dialog panels.
- Web e2e suite (Playwright, 36 tests plus the Lighthouse gate) against the real API, worker and
  web builds: section order, trust guardrails, flight form validation, URL serialisation and
  persistence, multi-city, every tab's routing, deals filter and links, currency and locale,
  newsletter, 360/768/1024/1440 layouts with axe, metadata, JSON-LD, sitemap, robots, social
  images, `/art` input validation, CSP and security headers, the homepage JavaScript budget.
- Lighthouse script (median of three mobile runs, thresholds from the acceptance criteria) and a
  Tailwind class check that fails when a used utility generates no CSS.
- CI: Postgres and Redis service containers, web e2e and Lighthouse step, report artifacts, class
  check; the worker's BullMQ test now runs in CI.

#### Changed

- Homepage performance (ADR-013): schemas load on form interaction, overlays and the calendar on
  first open, only latin fonts are preloaded. JavaScript 328 kB to 202 kB gzip, Lighthouse
  performance 78 to 97 (median). The spec's 170 kB target is tracked for phase 11 behind a 210 kB
  ratchet.
- Shared code imports Zod as a namespace for tree shaking and runs it jitless in browsers, so the
  strict CSP reports no eval attempts.
- Mock hotel rates scale by country price level.

#### Fixed

- Hotel search reports malformed dates as validation issues instead of throwing.
- `cn()` merges container widths (`max-w-page` with `max-w-dialog`).
- Segmented controls wrap on small screens; deal cards contain their overlay link text.

### Phase 3: Search, catalog and supplier adapters (2026-09-29)

#### Added

- `@suskii/shared` money utilities (ADR-008): bigint minor units with ISO 4217 exponents, strict
  decimal parsing, explicit rounding modes, basis-point and ratio maths, largest-remainder
  allocation, exact rational FX and cross rates, `Intl` formatting and the `{ amountMinor, currency }`
  wire format. fast-check property tests against exact rational references.
- `@suskii/shared` time-zone helpers (local wall time to UTC with DST gap/overlap handling, day
  offsets) and flight/hotel search schemas (1-5 legs, spec traveller rules, 1-8 rooms, child ages).
- Migration 2: accent-folded `search_text` with GIN `pg_trgm` indexes on airports and cities;
  `markup_rules`, `fee_rules`, `promo_codes`, `promo_redemptions`, `offers` (quote snapshots) and
  anonymised `search_logs`.
- Catalog: `GET /v1/catalog/places` autocomplete ranked in SQL (IATA code, prefix, word prefix,
  typo-tolerant trigram similarity, boosts for major airports, Nigeria/Africa and multi-airport
  cities), `places/popular` (edge-cacheable index of about 1,170 airports), `airports/{iataCode}`,
  `countries`.
- Pricing engine: first matching markup rule by priority, stacking fee rules, promo codes (validity,
  verticals, minimum spend, caps, global and per-user limits, never discounting taxes), line-by-line
  conversion so breakdowns always sum. `FxProvider` with `MockFxProvider`, Redis cache and a 24 h
  last-known-good fallback. `POST /v1/pricing/promos/validate` with a single generic failure.
- Suppliers (ADR-009): Suskii-owned domain types, `FlightSupplier` / `HotelSupplier` interfaces,
  deterministic geographically plausible `MockFlightSupplier` and `MockHotelSupplier`, Zod-validated
  Duffel v2 flight adapter behind `FLIGHT_SUPPLIERS=duffel`, per-supplier circuit breakers and
  abort-aware timeouts, `pnpm --filter @suskii/api airlines:sync`.
- Search orchestration: `POST /v1/flights/searches` and `/v1/hotels/searches` call every enabled
  supplier in parallel inside a 12 s budget, return partial results with per-supplier outcomes (503
  only when all fail), de-duplicate itineraries, cache by normalised query in Redis and share
  concurrent identical fetches. Result pages with spec sorts, filters, facets, cursor pagination and
  display currency; offer and hotel detail; `410` with the original request once results expire.
- Quotes: `POST /v1/flights/offers/{offerId}/quote` and `/v1/hotels/rates/{rateId}/quote` re-price
  with the supplier, persist an `Offer` snapshot and report price changes.
- Search rate limits (per IP per minute and per day, per user), `X-Suskii-Client` sales channel,
  OpenTelemetry supplier latency/outcome and search metrics.
- Tests: 72 shared unit tests (money properties, time zones, schemas), 82 API unit tests (pricing
  engine properties, circuit breaker, timeouts, mock determinism, Duffel mapping and errors, result
  sorting/filters/facets) and 86 e2e tests (catalog, search end to end, caching, partial results
  with failing and hanging suppliers, circuit breaker, pricing rules, promos, quotes, expiry).

#### Changed

- The e2e harness runs the real reference-data seed; `resetState` also truncates pricing, offer and
  search tables.
- OpenAPI problem responses are generated for every referenced status; a test resolves every `$ref`.
- The seed strips OurAirports locality suffixes from city names (CDG and ORY group under Paris).
- `.env.example`: supplier flags, search timeouts and cache TTL, FX provider and cache TTL.

### Phase 2: Backend core (2026-09-29)

#### Added

- API platform: Zod-validated environment (production-only requirements, values never echoed),
  nestjs-pino with request ids and PII/credential redaction, OpenTelemetry (opt-in via OTLP
  endpoint), RFC 9457 problem details, strict security headers (CSP, HSTS preload,
  Permissions-Policy, no-store), CORS allowlist, 100 kB body cap, `/health` and `/ready`.
- Prisma 7 schema and init migration: identity, sessions and refresh-token families, MFA, social
  identities, verification tokens, idempotency keys, append-only audit log (database trigger),
  countries, cities, airports, airlines, trust signals, CMS blocks, FAQs. UUIDv7 ids.
- `@Contract()` route contracts (Zod): input validation, response filtering and a native OpenAPI 3.1
  generator; `apps/api/openapi.json` committed (ADR-005).
- `@suskii/api-client`: openapi-typescript schema, openapi-fetch client (bearer or CSRF header) and
  TanStack Query hooks; `pnpm generate:api`.
- Authentication (ADR-007): email + password (argon2id, HIBP k-anonymity check, enumeration-safe
  registration and reset, email verification), phone OTP, Google and Apple ID tokens with
  pre-hijacking defence, EdDSA access JWTs with JWKS and key rotation, rotating refresh tokens with
  reuse detection and family revocation, web cookies with session-bound CSRF tokens, device list and
  remote sign-out, TOTP MFA with encrypted secrets, replay protection and recovery codes.
- Authorisation: deny-by-default global guard, RBAC catalog in `@suskii/shared`, `@AdminRoute()`
  (staff role + MFA session + optional IP allowlist), admin endpoints for users, roles and the audit
  log.
- Abuse controls: lockout with exponential backoff, Redis sliding-window rate limits per IP, user,
  route, phone and email with `RateLimit-*` / `Retry-After`; `Idempotency-Key` interceptor
  (Postgres, 24 h: replay, in-flight conflict, payload mismatch).
- Audit log service for auth, session, MFA and RBAC events (hashed IPs, no PII).
- Email (SMTP/Mailpit, mock) and SMS (mock) providers behind interfaces.
- Reference data from OurAirports (249 countries, 4,008 airports with IANA zones, derived cities),
  idempotent seed with the five guardrail trust signals (three verified), draft CMS content and an
  optional local admin (ADR-006).
- Tests: 43 API unit tests (RFC 4226/6238 vectors, crypto, JWT rotation, contracts, config) and 65
  e2e tests against Postgres and Redis in Testcontainers.
- CI: e2e with Testcontainers, OpenAPI document and client drift check.
- `pnpm --filter @suskii/api keys:generate` (secrets), `data:build` (reference data).

#### Changed

- `.env.example`: new auth, cookie, CORS, email, SMS and telemetry variables; `KEY=` means unset.
- `registerRequestSchema` no longer takes a transport (registration never signs in directly).

### Phase 1: Design tokens and component libraries (2026-09-28)

#### Added

- `@suskii/design-tokens`: spec tokens (asserted equal to `PROJECT_SPEC.json`) plus WCAG-driven
  derived tokens; generated Tailwind v4 theme (web), Tailwind v3 preset (NativeWind) and CSS
  variables; WCAG contrast utilities and a 30-pairing contrast contract; compile tests proving only
  token utilities exist on both platforms.
- `@suskii/ui-web`: Button, Input, Tabs, SegmentedControl, Combobox, DateRangePicker,
  PassengerPicker, Card, DealCard, DestinationCard, Badge, TrustBar, Skeleton, Dialog (modal, sheet,
  fullscreen), Popover, Toast. Storybook 10 with the a11y addon. Vitest browser tests: axe on every
  story at mobile and desktop widths, keyboard interaction tests, tokens-only guard.
- `@suskii/ui-native`: native equivalents with NativeWind, `@gorhom/bottom-sheet` sheets, tested
  calendar logic, Reanimated skeleton with reduced-motion support; Jest + RNTL tests and a
  tokens-only guard.
- `@suskii/shared`: traveller rules (adults 1-9, infants <= adults, total <= 9) with Zod schema and
  stepper helpers.
- Web and admin apps styled through Tailwind v4 + tokens, fonts via `next/font` (latin + latin-ext).
- Mobile app wired for NativeWind, token fonts, gesture/bottom-sheet/safe-area providers, Jest.
- CI: Playwright Chromium (cached) for browser tests, Storybook build step.
- ADR-003 (UI stack and token pipeline), ADR-004 (accessible derived colour tokens).

#### Changed

- Spec's white-on-orange buttons use dark text; inputs use `border-strong`; focus uses a solid
  primary outline with the spec ring as a halo (ADR-004).

### Phase 0: Foundation and repo bootstrap (2026-09-28)

#### Added

- `PROJECT_SPEC.json` (owner spec), `CLAUDE.md` working guide, Windows-first `README.md`.
- Turborepo + pnpm 10 workspace with a dependency catalog, strict engine check (Node >= 24.9) and
  an allowlist for dependency install scripts.
- `@suskii/config`: strict TSConfig presets (base, library, node, nestjs, nextjs), type-aware
  ESLint flat-config factories (base, node, nest, next, expo), Prettier and Vitest base config.
- `@suskii/shared`: brand, currency (NGN default + 6), locale (en-NG default + 2) and vertical
  constants with Zod schemas and type guards. Dual ESM/CJS build via tsup.
- `apps/api`: NestJS 12 skeleton with URI versioning (`/v1`), version-neutral `GET /health`, Jest
  unit and e2e tests (supertest).
- `apps/worker`: Node ESM worker shell with Zod-validated env, pino logger with redaction, ordered
  component lifecycle with graceful shutdown, and a `GET /health` liveness server.
- `apps/web` and `apps/admin`: Next.js 16 App Router shells (admin is `noindex` through metadata
  and the `X-Robots-Tag` header).
- `apps/mobile`: Expo SDK 57 + Expo Router shell. CI bundles it for iOS and Android with
  `expo export`.
- `docker-compose.yml`: Postgres 16, Redis 7.4 (`noeviction`), Mailpit, with health checks, bound to
  `127.0.0.1`.
- `.env.example` with every variable from the spec (placeholders only).
- Husky + lint-staged (ESLint + Prettier on staged files) + commitlint (Conventional Commits).
- GitHub Actions CI: format check, lint, typecheck, unit tests, API e2e tests and build, using
  `turbo --affected` on pull requests. Dependabot for GitHub Actions.
- ADR-001 (architecture) and ADR-002 (toolchain and version pins).
