# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository. The full product and engineering
spec is in [`PROJECT_SPEC.json`](./PROJECT_SPEC.json). Read it before starting a phase. This file is
the working summary and is updated at the end of every phase.

## What we are building

**Suskii Travels and Tour** is a one-stop travel shop: flights, hotels, packages, tours, visa assistance
and travel add-ons, with flexible payment. It ships as:

- `apps/web`: Next.js public website (SEO-heavy, SSR/ISR)
- `apps/mobile`: Expo React Native app (iOS + Android, EAS cloud builds only)
- `apps/admin`: Next.js admin console (RBAC, MFA mandatory)
- `apps/api`: **one** NestJS API shared by all three clients (PostgreSQL + Redis)
- `apps/worker`: BullMQ workers (fare refresh, deals, ticketing reconciliation, notifications, installments)

Primary market: Nigeria, then wider Africa, then global. Default currency `NGN`, default locale `en-NG`.

## Execution protocol (non-negotiable)

1. Phases run strictly in order (see `PROJECT_SPEC.json#/phases`). Don't start phase N+1 until phase N
   meets all its acceptance criteria.
2. At the start of a phase, write the plan to `docs/phases/phase-<n>.md` (files, risks), then implement.
3. At the end of a phase: lint, typecheck, test and build every affected workspace, fix all failures,
   update `CHANGELOG.md` and this file, make one conventional commit per logical unit, then **stop** and
   print a phase report (what was built, how to run it, test results, open issues, decisions needed).
4. Ambiguity: pick the most secure, conventional option, record it as
   `docs/decisions/ADR-<nnn>-<title>.md`, and continue.
5. No `TODO: implement` code in completed phases. Stubs only behind clearly named mock adapters
   (`MockFlightSupplier`, and so on).

## Phase status

| Phase | Name                                             | Status                                  |
| ----- | ------------------------------------------------ | --------------------------------------- |
| 0     | Foundation and repo bootstrap                    | Done                                    |
| 1     | Design tokens and component libraries            | Done                                    |
| 2     | Backend core                                     | Done                                    |
| 3     | Search, catalog and supplier adapters            | Done                                    |
| 4     | Web homepage                                     | Done                                    |
| 5     | Flight and hotel booking flow (web)              | Done                                    |
| 6     | Payments, flexible payment and refunds           | Done                                    |
| 7     | Mobile app                                       | Done                                    |
| 8     | Packages, tours, visa and add-ons                | Done                                    |
| 9     | Accounts, Suskii Prime, referrals, notifications | Done                                    |
| 10    | Admin console                                    | Done                                    |
| 11    | Hardening                                        | Done                                    |
| 12    | Deployment and release                           | Built; acceptance needs owner accounts  |
| 13    | Optional: AI trip search                         | Built; model eval needs the owner's key |

Cars (buses, rides and car rental; task `suskii-cars-v1`, outside the numbered phases): P0 to P11
done (merged). Plan, decisions and status: `docs/phases/cars.md`; audit: `docs/audits/e2e-audit.md`.

Partner supply (outside the numbered phases, ADR-069 to ADR-071): Hotelbeds hotels, cross-supplier
hotel merging, affiliate partner offers with click and conversion tracking. Built; each partner
needs the owner's account, then one run of `partner-sandbox.yml` (`docs/phases/partner-supply.md`). Own rides and the own fleet stay off
in production (ADR-069).

Standards plan (agreed with the owner on 2026-10-27, US and European standards for African
markets): item 1, all-in prices with a tax table per country, is built (`docs/phases/all-in-pricing.md`);
the rates wait for the owner's accountant. Item 2, a one-tap full refund when the airline cancels or
significantly changes a flight, is built (`docs/phases/refund-offer.md`). Item 3, payment methods
(mobile money, transfers, USSD, Apple Pay and Google Pay, cash at an agent, Stripe 3D Secure), is
built (`docs/phases/payment-methods.md`); the channel names wait for one sandbox payment per method.
Item 4, search results in under 3 seconds on slow 3G and a mid-range Android with a data saver, is
built and tested in CI (`docs/phases/fast-on-slow-3g.md`, 2.1 s median). Item 5, French, Swahili,
Arabic (right to left) and Portuguese on the website and in the app, is built
(`docs/phases/languages.md`); the translations wait for a native speaker's review. Item 6,
verified reviews of finished trips with moderation, is built (`docs/phases/verified-reviews.md`).
Item 7, company accounts (members in roles, a travel policy, approval before payment and spend
reports), is built (`docs/phases/company-accounts.md`); the company wallet and invoiced credit
come next. Item 8, growth, runs in four parts (`docs/phases/growth.md`): part 1, ads with consent
(Meta and TikTok tags after marketing consent, server-side Purchase events), is built and waits
for the owner's pixel ids and tokens; part 2, SEO pages from fare history (route facts, flight
hubs, airline pages), is built; part 3, metasearch (partner keys, the live price API, sealed deep
links, landings that re-quote, partner attribution), is built and waits for partner agreements;
part 4, Suskii Prime priced per country, is built and waits for the owner's prices per market.
Item 9, 24/7 support, runs in three parts (`docs/phases/support.md`): part 1, conversations tied to
bookings with a console inbox, SLA timers and a Prime queue, is built and waits for people on
shift; part 2, WhatsApp through the Cloud API, is built and waits for the owner's Meta app,
number and approved template; part 3, an after-hours assistant that answers from the FAQs and the
traveller's booking (ADR-085), is built and waits for the owner's staffed hours, `LLM_API_KEY`
and one run of the assistant eval. Item 10, Expedia Rapid hotels (ADR-086), is built and waits for
the owner's Expedia Partner Solutions account, one sandbox run and certification
(`docs/phases/expedia-rapid.md`). Item 12, an accessibility audit against WCAG 2.2 AA, is built
and checked in CI (`docs/phases/accessibility.md`, `docs/accessibility/wcag-2.2-aa.md`); the
manual screen reader pass waits for devices and testers. Items 11 and 13 come next.

Phase 12 status: images, Terraform (GCP + Cloudflare), the Helm chart, the pipelines and the store
content are built; the compose release rehearsal passes. Deploying, the kind rehearsal and store
submission wait for the owner's accounts (`docs/phases/phase-12.md`, Outcome).

Phase 13 status: AI trip search is built behind `AI_SEARCH_ENABLED` (website, app, API, evals);
the pipeline scores 50/50 with recorded model answers. The 95% criterion against the real model
needs `LLM_API_KEY` and one run of `ai-eval.yml` (`docs/phases/phase-13.md`, Outcome). Started
at the owner's request while phase 12's acceptance still waits for accounts.

## Repository layout

```
apps/
  api/        NestJS 12 API (CJS output, URI versioning /v1, Jest), Prisma 7, openapi.json
  worker/     Node ESM worker process (Vitest)
  web/        Next.js 16 App Router (nonce CSP, Playwright e2e + Lighthouse in e2e/)
  admin/      Next.js 16 App Router staff console (noindex, RBAC + MFA, Playwright e2e in e2e/)
  mobile/     Expo SDK 57 + Expo Router + NativeWind 4 (Jest)
packages/
  config/         Shared TSConfig presets, ESLint flat-config factories, Prettier, Vitest base
  shared/         Domain constants, money, time zones, traveller rules, Zod schemas (ESM/CJS)
  design-tokens/  Single token source -> Tailwind v4 theme (web), v3 preset (NativeWind), CSS vars
  ui-web/         Radix-based web components (TS source), Storybook 10, Vitest browser + axe tests
  ui-native/      NativeWind components (TS source), bottom sheets, Jest + RNTL tests
  api-client/     Generated OpenAPI types + openapi-fetch client + TanStack Query hooks (TS source)
  i18n/           Typed message catalogs (en-NG/GB/US), translator, Intl formatters (TS source)
infra/        terraform/ (GCP platform + Cloudflare edge, applied per environment), helm/suskii (optional),
              observability/ (Grafana dashboards, Prometheus alert rules)
load/         k6 load test (load/k6/api.js), run in CI against the e2e stack
scripts/      Repo-level tools: security-checklist.mjs (ASVS/MASVS checklist generator)
docs/         decisions/ (ADRs), phases/ (plans), security/ (threat model, checklist, inventories), runbooks/,
              release/ (store listing, privacy forms), deployment/ (AWS mapping)
```

## Commands

Run from the repo root. All scripts are cross-platform (PowerShell, bash, zsh).

| Command                                            | What it does                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm install`                                     | Install all workspaces (pnpm 10.33, Node 24 LTS >= 24.9 enforced)                 |
| `pnpm infra:up`                                    | `docker compose up -d --wait` (Postgres 16, Redis 7, Mailpit)                     |
| `pnpm infra:down`                                  | Stop local infra (data kept in named volumes)                                     |
| `pnpm dev`                                         | Run every app in watch mode through Turborepo                                     |
| `pnpm build`                                       | Build every workspace (dependencies first)                                        |
| `pnpm lint`                                        | ESLint (type-aware) in every workspace                                            |
| `pnpm typecheck`                                   | `tsc --noEmit` in every workspace                                                 |
| `pnpm test`                                        | Unit tests (Vitest; Vitest browser for ui-web; Jest for API/native)               |
| `pnpm build:storybook`                             | Static Storybook for ui-web                                                       |
| `pnpm --filter @suskii/ui-web dev`                 | Storybook dev server on port 6006                                                 |
| `pnpm test:e2e`                                    | API, web and admin e2e suites, one after the other (Docker or URLs)               |
| `pnpm --filter @suskii/web test:e2e`               | Web e2e + Lighthouse against built web, API and worker (see notes)                |
| `pnpm --filter @suskii/admin test:e2e`             | Admin e2e: staff journeys, audit log, axe (built admin and API)                   |
| `pnpm --filter @suskii/web lighthouse [url]`       | Lighthouse gate on a running site (median of `LIGHTHOUSE_RUNS`)                   |
| `pnpm --filter @suskii/web check:classes`          | Fail if a Tailwind class used in web/ui-web generates no CSS                      |
| `pnpm --filter @suskii/worker refresh:once`        | Refresh every deal route and destination once (API must run)                      |
| `pnpm generate:api`                                | Rebuild `apps/api/openapi.json` and the api-client schema                         |
| `pnpm --filter @suskii/api db:deploy` / `db:seed`  | Apply migrations / seed reference data (idempotent)                               |
| `pnpm --filter @suskii/api db:migrate`             | Create a migration after editing `prisma/schema.prisma`                           |
| `pnpm --filter @suskii/api db:seed:demo`           | Sample packages, tours, add-ons and visa data (refused in prod)                   |
| `docker compose --profile av up -d clamav`         | ClamAV for real scans (`ANTIVIRUS_PROVIDER=clamav`, about 1 GB)                   |
| `pnpm --filter @suskii/api keys:generate`          | Print fresh JWT keys, encryption key and HMAC secret                              |
| `pnpm --filter @suskii/api data:build`             | Refresh `prisma/data` from OurAirports (review the diff)                          |
| `pnpm --filter @suskii/api airlines:sync`          | Upsert airlines from Duffel (needs `DUFFEL_API_TOKEN`)                            |
| `pnpm --filter @suskii/mobile android`             | Build and run the development build on an Android emulator                        |
| `pnpm --filter @suskii/mobile scan:bundle dist`    | Secret scan of the mobile export (`--self-test` checks the scanner)               |
| `pnpm --filter @suskii/web e2e:stack`              | Run the e2e stack (API, worker refresh, web) for Maestro flows                    |
| Actions, Test server, Run workflow                 | Hosted test server for phones (`test-server.yml`, up to 5.5 hours)                |
| `node scripts/brand-assets.mjs`                    | Rebuild app and web icons, splash and header mark from `brand/` (ADR-068)         |
| `pnpm format` / `format:check`                     | Prettier write / check                                                            |
| `pnpm security:checklist` (`--check` in CI)        | Regenerate `docs/security/checklist.md` from the reviewed mapping                 |
| `pnpm --filter @suskii/api test:cov`               | API unit tests with the 80% gates (also `@suskii/shared`)                         |
| `pnpm --filter @suskii/ui-web test:visual`         | Screenshot tests (baselines from the `visual-baselines` workflow)                 |
| `k6 run load/k6/api.js`                            | Load test a running stack (`API_URL`, `LOAD_SCALE`, `LOAD_DURATION`)              |
| `promtool check rules` / `test rules`              | Validate `infra/observability/alerts` (CI pins promtool)                          |
| `pnpm --filter @suskii/api keys:reencrypt`         | Rewrite field encryption under the current key (dry run first)                    |
| `pnpm --filter @suskii/api sessions:revoke`        | Incident sign-out (`--user`, `--staff` or `--all`, dry run first)                 |
| `pnpm --filter @suskii/api eval:natural-search`    | AI trip search eval: 50 messages, fails below 95% (`--recorded`: no model)        |
| `pnpm --filter @suskii/api eval:support-assistant` | Support assistant eval: 40 conversations, 90% and no unsafe answer (`--recorded`) |
| `pnpm --filter @suskii/api sandbox:duffel`         | Duffel flights and Stays test-mode check (ADR-062; test token, `--book`)          |
| `pnpm --filter @suskii/api test:sandbox`           | Our API's booking journey against Duffel test mode (manual workflow only)         |
| `pnpm --filter @suskii/api sandbox:partners`       | Hotelbeds, Expedia, Viator and Travelpayouts check (owner keys, read-only)        |
| `pnpm --filter @suskii/api rides:demo`             | Sample drivers take local rides; type the rider's PIN (not in prod)               |
| `pnpm --filter @suskii/api staff:bootstrap`        | First super admin of a new environment (`--email`, `--yes`; once)                 |
| `pnpm release:rehearse`                            | Compose deploy, ops command, broken release, rollback (`:local` images)           |
| `node scripts/helm-rehearsal.mjs`                  | Same on kind with the Helm chart (needs kind and Helm; runs in CI)                |
| `pnpm smoke --api URL [--web URL] [--admin URL]`   | Post-deploy smoke tests (public routes only, safe on production)                  |
| `pnpm check:migrations` / `pnpm test:scripts`      | Expand/contract guard on new migrations / node:test script suites                 |
| `docker compose --profile s3 up -d s3`             | S3-compatible store for `OBJECT_STORAGE=s3` locally (ADR-057)                     |
| `pnpm --filter @suskii/api dev`                    | Run a single workspace                                                            |

Local ports: web `3000`, admin `3001`, API `4000`, worker health `4100`, Expo Metro `8081`,
Postgres `5432`, Redis `6379`, Mailpit SMTP `1025` and UI `8025`. Docker ports bind to `127.0.0.1` only.

Tooling notes for agents:

- Tool versions are newer than most training data (TypeScript 6, NestJS 12, Next.js 16, Expo SDK 57,
  Turborepo 2.11). Read the docs bundled with the installed package before changing its config,
  e.g. `node_modules/turbo/docs/`. Version pins and their reasons are in ADR-002.
- Turborepo's auto-generated `AGENTS.md` is disabled (`agentGuidance: false`); this file is the
  single agent guide.
- The API's Jest runs need `node --experimental-vm-modules` on Node >= 24.9 (NestJS 12 is ESM-only).
  Use the package scripts rather than calling `jest` directly.
- ui-web tests need Chromium: `pnpm --filter @suskii/ui-web exec playwright install chromium`, or
  set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing binary.
- React Native Testing Library 14 APIs are async: `await render(...)`, `await fireEvent.press(...)`.
- Prisma 7: the client is generated into `apps/api/src/generated/prisma` (gitignored, `postinstall`)
  and uses the `pg` driver adapter; `prisma.config.ts` loads the root `.env` for CLI commands.
  Prisma blocks `migrate reset` from agents without the user's consent; create a fresh database or
  use `prisma migrate diff` instead.
- Mobile Jest mocks the native modules in `apps/mobile/jest.setup.js` (Expo Router, secure store,
  MMKV, crypto, localization, file system, web browser, screen capture). Screen tests render
  through `renderWithApp()` and fake the API with `mockApi({ 'GET /v1/...': () => json(...) })`
  (`src/test/app.tsx`); typed fixtures live in `src/test/fixtures.ts`. Mock `../config` in a test
  that needs `attestation: 'mock'`.
- `expo prebuild` generates `apps/mobile/android` and `ios` (gitignored, continuous native
  generation); it also rewrites the `android`/`ios` scripts, which already use `expo run:*`.
- E2E tests reuse running services when `E2E_DATABASE_URL` / `E2E_REDIS_URL` are set (the database
  is truncated, so never point them at data you care about).
- Web e2e (`apps/web/e2e`) runs from build output: build web, API and worker first (turbo does this
  for `test:e2e`). The global setup boots Postgres and Redis (Testcontainers, or
  `WEB_E2E_DATABASE_URL` / `WEB_E2E_REDIS_URL`), migrates, seeds, starts the API on 4000 and web on
  3000 (stop dev servers first) and runs one worker refresh. `E2E_BASE_URL` targets a running stack
  instead. Lighthouse uses `CHROME_PATH` (Playwright's headless shell works best) or Playwright's
  Chromium. The stack makes Lagos-Dubai fares change at the payment re-check
  (`MOCK_REPRICE_RULES`) for the price-consent test, and runs `db:seed:demo` for the in-house
  journeys (sample packages, tours, add-ons and visa products).
- Admin e2e (`apps/admin/e2e`) also runs from build output (admin and API; stop servers on 3001
  and 4000 first). Postgres comes from Testcontainers or as a new database on the server named by
  `ADMIN_E2E_DATABASE_URL` (dropped afterwards); Redis from `ADMIN_E2E_REDIS_URL`. `provision.ts`
  creates through the API a seeded super admin, one staff persona per test (`personas.ts`) and
  paid tour and visa bookings; the API refuses a TOTP code twice, so never sign the same persona
  in from two tests. The audit project runs after the journeys. The stack sets
  `RATE_LIMIT_ENABLED=false` because every persona signs in from one IP within a minute.
- `MOCK_SCHEDULE_CHANGE_RULES=LOS-ABV:90` makes the mock move the first flight of ticketed
  orders on that route on their first schedule-change check (set `next_change_check_at` in the
  past, or wait `SCHEDULE_CHANGE_CHECK_HOURS`). The change lives in memory: a restart forgets it.
- `e2e:stack` uses the mock suppliers. `E2E_FLIGHT_SUPPLIERS` / `E2E_HOTEL_SUPPLIERS=duffel`
  switch it to Duffel's test mode for phone or browser testing. That needs a `duffel_test_` token
  in `DUFFEL_API_TOKEN`, from the shell or the root `.env`. The e2e suites never set them.
- `next dev` would write its own `AGENTS.md`/`CLAUDE.md` into the app folder; `agentRules: false`
  in both Next configs keeps this file the only agent guide.

## Conventions

### TypeScript and code

- TypeScript `6.0.x`, `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`. No `any`: use `unknown` and narrow.
- ESLint is type-aware (`typescript-eslint` `recommendedTypeChecked`). `no-floating-promises` and
  `no-misused-promises` are errors, which matters for money and booking code.
- Prefer `async/await`, small pure functions, explicit return types on exported functions.
- Workspace packages are named `@suskii/<name>`. Shared dependency versions live in the
  `catalog:` section of `pnpm-workspace.yaml`. Use `"dep": "catalog:"` in package manifests.
- `packages/shared` is framework-agnostic: no React, Nest or Node-only APIs.

### Architecture rules (from the spec)

- Supplier adapters isolate third-party APIs; domain code never imports vendor SDKs.
- Money: integer minor units (`BIGINT`) + ISO-4217 code. Never floats.
- Timestamps in UTC; flights also store the airport IANA timezone and local time.
- `Idempotency-Key` required on every write that creates bookings, payments or refunds.
- Bookings are driven by an explicit, audited state machine.
- Webhooks are the source of truth for payment status.
- REST under `/v1` (Nest URI versioning); infra probes such as `/health` are version-neutral.

### API conventions (apps/api)

- Every route has a `@Contract()` (Zod params/query/body/responses, `operationId`, documented
  errors). Responses are filtered through their schema, so return plain objects with ISO date
  strings. Register reusable schemas with `named('Name', schema)`. Run `pnpm generate:api` after
  any contract change and commit both generated files (an e2e test and CI check them).
- Routes are authenticated by default. `@Public()` opts out; `@RequirePermissions(...)` and
  `@AdminRoute(...)` (staff + MFA session + IP allowlist) authorise. Inject the caller with
  `@CurrentAuth()`. Permissions come from `ROLE_PERMISSIONS` in `@suskii/shared`.
- Always check resource ownership (answer 404 for other users' resources, never 403).
- Throw `ProblemDetailsException(status, slug, title, detail?)` for client errors; auth helpers
  live in `src/auth/errors.ts`. Never put values, tokens or PII in details.
- Writes that create bookings, payments or refunds set `idempotent: true` in the contract.
- Add stricter limits with `@RateLimit(...)` (policies in `rate-limit.decorator.ts`).
- Record security-relevant actions with `AuditService.record()` (add the action to `AuditAction`),
  inside the same transaction as the change when possible. Metadata: ids and reasons only.
- Hash low-entropy or personal values with `HmacService` (per-purpose keys); encrypt stored secrets
  with `FieldEncryption` using a record-bound context string. Contexts live in
  `src/crypto/encryption-contexts.ts` and every encrypted column (or JSON key) in
  `ENCRYPTED_FIELDS`, which `keys:reencrypt` walks to rotate keys; a test fails when a column named
  `*Encrypted`/`*Ciphertext` is missing there (ADR-038).
- Production refuses plaintext Postgres, Redis and worker-to-API hops unless the matching
  `*_ALLOW_PLAINTEXT` flag declares a private, otherwise encrypted path (ADR-038). Social sign-in
  needs a nonce from `POST /v1/auth/social/nonce`.
- External providers sit behind abstract classes (`EmailProvider`, `SmsProvider`,
  `BreachedPasswordChecker`, `FxProvider`, `FlightSupplier`, `HotelSupplier`, `PaymentProvider`) with mock adapters for
  tests and local development. Production refuses mock adapters unless `ALLOW_MOCK_PROVIDERS=true`.

### Money, pricing and search (apps/api, packages/shared)

- Money is `Money = { minor: bigint, currency }` from `@suskii/shared` (`money()`, `add`,
  `multiplyRatio`, `allocate`, `convert`, `formatMoney`). Every operation that can create a fraction
  takes an explicit rounding mode. On the wire it is `{ amountMinor, currency }` (`moneySchema` /
  `priceSchema` in `src/pricing/pricing.schemas.ts`); never send floats or decimal strings.
- Prices come from `PricingService.pricer()` (markup, conversion, fees, promo). Markup and supplier
  cost are internal and never leave the API. No pricing rule or promo is seeded.
- Supplier adapters live in `src/suppliers/<vendor>` and map vendor payloads to the domain types in
  `supplier.types.ts`; vendor types never leave the adapter. Enable them with `FLIGHT_SUPPLIERS` /
  `HOTEL_SUPPLIERS` (comma-separated). Adapters throw the `SupplierError` subclasses and honour the
  `AbortSignal`; the runner adds timeouts and circuit breakers.
- Search state lives in Redis (`SearchStore`); result ids embed a fresh search id and expire after
  30 minutes (`410` with the original request). Quotes persist an `Offer` row, which bookings use.
- Flight quotes go through `FlightSupplier.quoteOffer()` (default: `reprice`). Duffel takes one
  order per offer request, so its adapter searches again and quotes the same flights from a fresh
  offer request; cached searches stay shared. Never book a Duffel offer straight from a search.
- Flight extras are whole-trip bags per passenger (`FlightService`). Duffel lists services only
  on a single offer, per passenger and segment: its adapter fetches them on quote and re-check,
  bundles one weight across every segment, sells it only at one price for every seated
  passenger (id `<offer>.bag<kg>`), and `book()` refuses a bag that is gone or repriced (ADR-063).
- Hotel suppliers: `mock`, `duffel` (Stays), `hotelbeds` (ADR-071; signed APItude calls,
  rate checks before payment, no idempotency key so ambiguous bookings go to review) and
  `expedia` (ADR-086; Rapid, property ids by polygon, price checks before quote and booking,
  Expedia Collect only). When more than one returns results, `mergeDuplicateHotels` keeps the
  cheaper copy of a hotel (same normalised name within 250 m, different suppliers only).
- A hotel supplier whose search returns only the cheapest price (Duffel Stays) sets
  `ratesComplete: false` and implements `rates()`; the hotel page loads the full list once per
  search (`SearchStore.completeItem`, rate ids `.f<n>`; search rates are `.r<n>`) and falls back to
  the search rates when the supplier cannot answer. Only rates paid in full from the supplier
  balance are sold (ADR-062).
- Tax on Suskii's own service comes only from `tax_rules` (ADR-072): `PricingService` loads the
  `TAX_SELLER_COUNTRY` rules with markups and fees, and the engine adds `serviceTaxes` lines inside
  `total` (`margin`: markup plus fees less the discount; `full`: fare plus fees less the discount;
  supplier taxes are never taxed again). Never compute tax in a client or hard-code a rate; receipts
  print the booking's stored lines. A `full` rule reaching Cars is refused while `CARS_VAT_BPS` is set.
- Times: store local wall time + IANA zone + UTC instant (`localToUtc`, `utcToLocal` in shared).
- `X-Suskii-Client: web/<version>` or `mobile-<platform>/<version>` selects the sales channel.

### Bookings and payments (apps/api, ADR-014, ADR-015)

- Booking status changes only through `BookingTransitions.apply()` (state machine check, optimistic
  guard on the current status, `booking_status_history` row and audit entry in the caller's
  transaction). Never update `bookings.status` directly.
- Load bookings with `BookingsService.load(id, caller)`: owners by session, guests by the
  `X-Booking-Token` header (stored as an HMAC); everyone else gets 404.
- Rows whose encrypted fields bind to their id get it from `uuidv7()` before the insert. Contexts:
  `booking:{id}:contact`, `booking-passenger:{id}:passport`, `traveller:{id}:passport`. Responses
  only ever show masked contact details and the last three passport characters.
- Payment outcomes come only from verified webhooks (`PaymentEventsService`); the mock provider's
  page completes through the same signed-webhook path. Money the booking cannot take is flagged
  `requiresRefund`, audited and refunded automatically, never silently applied.
- Supplier `book()` calls use the booking item id as idempotency key; `idempotentBooking` decides
  whether an ambiguous failure (timeout) may be retried or goes to REFUND_PENDING for review.
  Wrap the call that creates an order or a booking in `creating()` and throw
  `SupplierAmbiguousError` for an unreadable or unconfirmed answer: a 5xx or lost connection
  after sending may have booked, and only suppliers that dedupe on the key retry it.
- Ticketed flights cancel online only through `FlightCancellationService` (ADR-064): a refund
  quote held in Redis, the supplier's confirmation first, then the ledger fee and
  `refundBookingBalance` in one transaction. The traveller's refund is `travellerRefund()`
  (their share, rounded down, never above what they paid); never refund before the airline has
  cancelled.
- Airline schedule changes (ADR-065) come only through `ScheduleChangesService`: the sweep
  reads due orders (`booking_items.next_change_check_at`, booked by ticketing), stores each
  change in `flight_schedule_changes` and tells the traveller. Acceptance goes to the supplier
  first. The booking's slices follow the airline's only once no change is open; never edit an
  item's itinerary elsewhere.
- A significant change (ADR-073: a cancelled flight, another airport, more connections, or a move
  of `SIGNIFICANT_CHANGE_DOMESTIC_HOURS` / `_INTERNATIONAL_HOURS`) is marked when it is found and
  carries `refundOffer`: everything the traveller paid, taken only through
  `ScheduleChangesService.refund()`. The supplier cancels first, and only when its refund covers
  what we paid it; a short one withdraws the offer to support. Never fund an airline's refund.
- Binary responses (PDFs) use `fileResponse()` in the contract and return a `StreamableFile`.
  Stored idempotent responses are encrypted (they can contain guest tokens).

### Payments, ledger, plans and refunds (apps/api, ADR-016 to ADR-019)

- Providers implement `PaymentProvider` in `src/payments/<vendor>`: hosted checkout only, webhook
  signature over the raw body, `verify()` against the provider before an outcome counts (Paystack,
  Flutterwave), refunds with an idempotency key where the provider supports one. `PaymentProviders`
  routes by currency in `PAYMENT_PROVIDERS` order. Vendor payloads never leave the adapter; parse
  provider amounts with `parseMoney`, never floats.
- Checkout offers methods, not providers (ADR-074): each adapter declares `methodsFor(currency)`
  and maps a method to its own channel name, kept inside the adapter, and
  `PaymentProviders.choose(currency, provider, method)` routes. `apple_google_pay` is Apple Pay or
  Google Pay; `wallet` is the Suskii wallet balance (`useWallet`). Clients send the chosen method
  only when they list more than one.
- Every money movement is a `LedgerService.post()` in the caller's transaction with a business
  idempotency key (`payment:{id}:captured`, ...). Never write ledger tables or balances directly;
  the database rejects unbalanced, negative-customer or updated entries. What a booking has paid is
  its ledger balance (`BookingFundsService.paid`), not a sum of payments.
- Reconciliation and other non-webhook confirmations go through the webhook pipeline with a
  synthetic event id (`reconcile:{reference}:{status}`), so dedupe and postings stay in one place.
- Plans: `PaymentPlansService` creates holds and installment plans (flights with supplier holds,
  no paid extras) and closes them (cancel, default, expiry) under the plan's policy. Amounts,
  deposit, fees and grace come from config; never hard-code them.
- Captured card payments are scored by `PaymentRiskService` in the capture transaction; at or
  above `PAYMENT_RISK_REVIEW_SCORE` the booking stays PAID with an open `PaymentRiskReview` and
  nothing fulfils it until finance approves (reject refunds in full). Never fulfil a PAID booking
  around this check (ADR-040).
- Refunds: `RefundsService.createAutomatic()` for non-discretionary cases (approved at once);
  staff refunds go through the admin API with maker-checker (the requester cannot approve).
  A refund never exceeds its source balance. An ambiguous call to a provider without idempotency
  keys goes to `needs_review`, never a blind retry. `finalizeBooking` moves REFUND_PENDING to
  REFUNDED when nothing is left and no refund is open.
- Emailed booking links carry a guest token in the URL fragment (`#access=`), stored as an HMAC
  (`BookingAccessLinks`); the web page moves it to session storage and strips it from the URL.
- Ledger reconciliation (`LedgerReconciliationService`, hourly) compares each captured payment,
  settled refund and finished driver payout with its postings (and the provider) and raises
  `reconciliation_discrepancies` for `finance:reconcile`; it never corrects anything. Driver
  earnings leave only through `DriverPayoutsService` (`payout_sent`/`settled`/`failed`, one
  pending payout per driver and currency); never post to `driver-earnings` elsewhere except
  ride settlement (ADR-051).

### Web (apps/web)

- Pages render per request (nonce CSP, ADR-010); cache API reads through `lib/api.ts`
  (`revalidate` + tags). Never read `localStorage` during render; restore it in an effect.
- Node and browsers ship different CLDR data, so `Intl` text in a server-rendered client component
  can differ at hydration. Render it in an element with `suppressHydrationWarning` (as
  `FieldButton` and `NativeSelect` do) and switch browser-only values (the visitor's time zone)
  after `useHydrated()`. `e2e/hydration.spec.ts` alters the browser's `Intl`: add new pages there.
- Copy comes from `@suskii/i18n`: server components use `getI18n()`; client components get a
  message subset through `I18nProvider` or labels as props. E2E tests use the catalog too.
- Languages (ADR-076): `en-NG`, `en-GB`, `en-US`, `fr`, `sw`, `ar`, `pt`. A new string goes in
  every catalog (the type check fails otherwise; `catalogs.test.ts` checks placeholders, plural
  forms and English left behind). The language is the footer cookie, else `Accept-Language`
  (`negotiateLocale`), else `en-NG`; URLs stay the same. Format through `format`/`t` (Latin
  digits via `intlLocale`), never `Intl` with the bare locale. The date picker names months and
  days with Intl outside English; pass its `today` and `selected` label templates from the catalog.
- Arabic pages are right to left (`<html dir>` from `localeDirection`). Use logical utilities
  only (`ms-`/`me-`, `ps-`/`pe-`, `inset-s-`/`inset-e-`, `border-s-`, `rounded-s-`, `text-start`);
  the website's lint rule and ui-web's guard test refuse `ml-`, `left-`, `text-right` and the like.
  Mirror arrows with `rtl:-scale-x-100`; keyboard handlers read the computed `direction`.
- Only the spacing scale exists (0-6, 8, 10, 12, 16, 20) plus named sizes (`max-w-page`,
  `max-w-dialog`, `max-w-popover`, `max-h-menu`). Unknown classes produce no CSS silently: run
  `check:classes` after a build.
- Keep the homepage JavaScript small (ADR-013): client code imports `@suskii/shared/lite`, loads
  schemas with `loadShared()`, opens popovers and dialogs through `useDeferredOverlay`, and puts
  heavy or rarely used code behind `lazy()`/`next/dynamic`. The e2e budget test fails above 170 kB (ADR-043).
- Use `AppLink` for string hrefs (typed routes). Card art comes from `/art`; real photos go through
  `next/image` with hosts from `IMAGE_REMOTE_HOSTS`.
- New pages need metadata (`pageMetadata`), a canonical path and, for inner pages, breadcrumbs;
  add them to the sitemap when indexable.
- Forms the API protects with Turnstile (sign-up, guest checkout, newsletter) render the widget
  on first focus (`useTurnstile`); without a site key they send a development token the API's mock
  accepts. The app sends a device attestation instead.
- Client components call the API with `browserApi()` (typed openapi-fetch, `lib/browser-api.ts`);
  documented headers such as `Idempotency-Key` go in `params.header`. Guest booking tokens live in
  session storage through `lib/booking-token.ts`.
- Result filters and sort live in the URL (`useUrlParams`). Fetched state is keyed by its inputs
  instead of being reset inside effects (the React Compiler lint rejects `setState` in effects).
- Search is one round trip (ADR-075): the search forms start the POST (`lib/search-handoff.ts`)
  and the results page shows the first page it answers with, asking for another page only when
  the sort, filters or page change. Pass the page size (`limit`, 10 under the data saver, else 20) everywhere a search is started or paged. The `slow-3g` e2e project fails above 3 s from
  pressing Search to the first fare; keep heavy work on the results page behind `AfterPaint`.
- Data saver (`getDataSaver()`: the `__Host-suskii_data_saver` cookie, else `Save-Data: on`)
  means 10 results per page and city art instead of photos; new image-heavy sections honour it.
- Checkout, payment and booking pages are private: `noIndex` metadata and robots.txt disallow.
- Never import a message catalog (`getMessages`) into a client component: the whole catalog then
  ships with every page using it. Pass a subset through `I18nProvider` (the root layout gives the
  error boundary only `pages.error`).
- Client widgets inside server pages get their message subset from a plain module
  (`*-messages.ts`): a server component cannot call a function exported from a client module.
  Country names come from `format.country` (Intl `DisplayNames`).
- Signed-in calls use the API's cookies. `browserApi()` refreshes an expiring session first and
  sends `X-CSRF-Token` on unsafe methods (`lib/session.ts`); refresh only through
  `ensureFreshSession()` (Web Lock, single flight), never with a direct call. Account pages are
  client components under `AccountShell`, `noIndex`, and disallowed in robots.txt.
- Payment plans on the web show the schedule, fee, total and missed-payment policy before the
  traveller commits, and never with paid extras. Money on screen comes from API `Money` values
  (`format.money`); never compute totals or fees client-side except to preview the documented
  policy (`defaultRefund` floor rounding).

### Mobile (apps/mobile, ADR-020 to ADR-024)

- Screens live in `src/screens`; files under `app/` only re-export them (typed routes). Copy comes
  from `useT()` (the full catalog, bundled with the app); there are no hard-coded strings.
- Talk to the API through `useApp().api` (bearer token from memory, one refresh-and-retry on a
  401, `X-Suskii-Client: mobile-<os>/<version>`); never call `fetch` directly. Reads (GET, HEAD)
  give up after `READ_TIMEOUT_MS` (20 s) as a `NetworkError`, so screens fall back to saved
  copies; writes and uploads have no timeout (their Idempotency-Key covers a retry). The refresh is
  single flight (`SessionStore`) because the API revokes a session on refresh-token reuse.
- Secrets (tokens, guest booking tokens, cache key, App Attest key id) go in `secureStorage`
  (Keychain / Keystore, this device only). Personal data kept offline goes in `secureCache()`
  (AES-256 MMKV); `preferences` holds settings only. Never use AsyncStorage for either.
- `appConfig` (`src/config.ts`) is the only reader of `EXPO_PUBLIC_*`. Those values are inlined
  in the bundle and public; a secret there fails the bundle scan. The `e2e` variant (test APK)
  may override the API and website origins from Account, Test server (ADR-054); no other variant
  reads that setting.
- openapi-fetch middleware must not return the response it was given: Expo's fetch answers with
  its own class, which fails openapi-fetch's `instanceof Response` check (return nothing).
- Incoming URLs go through `resolveIncomingUrl()` (allowlist); add a path there and in the app
  link paths in `app.config.ts`, with a test. Guest access tokens never reach the router.
- Payments: `startPayment()` then `openHostedCheckout()` (system browser session, never a
  WebView); the trip screen polls, webhooks decide. Guest checkout and payment attach
  `attestationHeader()`. The API client feeds `X-Suskii-Attestation-Result` back to
  `noteAttestationResult()`; the iOS key counts as attested only after `valid` (ADR-023).
- Maestro flows live in `e2e/maestro` and run in order from `e2e/run-android.sh` (critical path,
  bus, offline trip, an in-house tour with the route restored, a message to support, then Google
  sign-up and sign-in again); add new journeys there.
- Wrap checkout, payment and document screens in `useSensitiveScreen()`.
- Flight checkout offers the quote's first extra (a checked bag) per traveller with a seat, as the
  website does; bags send `extras` and switch reserving and installments off (ADR-063).
- Hermes implements only part of `Intl`. `src/polyfills.ts`, loaded first from `index.ts`, adds
  `PluralRules`, `RelativeTimeFormat`, `ListFormat`, `DisplayNames` and `Locale`; `@suskii/i18n` joins date
  ranges itself where `formatRange` is missing. Shared code that starts using another `Intl` API
  needs a polyfill there and a case in `polyfills.test.ts` (Jest runs on Node's full `Intl`).
  A new language needs its polyfill data there too (ADR-076).
- The app's language comes from the device (`negotiateLocale` over `getLocales()`), and React
  Native mirrors the layout in Arabic (`supportsRTL`), so NativeWind's left and right styles
  flip by themselves; mirror direction-bearing icons explicitly.
- Push permission is requested only after a booking or from Account (`followBooking`,
  `followAccount`), never on launch.
- Results screens show the page the search answers with (`initialData` while the filters are
  the defaults) and send `limit` (10 when `useApp().dataSaver` is on, else 20) on every search
  and page (ADR-075).
- Test builds find the hosted test server at launch (`discoverHostedServer`, ADR-066); read the
  API and website origins through `appConfig` getters (they can change at runtime) and
  `webHost()`, never cache them at module load. A server chosen under Test server wins.
- Sheets are React Native modals (`Sheet` in ui-native); give pickers a `testID` (the field,
  `{testID}-sheet`, `{testID}-done`, days `{testID}-day-YYYY-MM-DD`, steppers
  `{testID}-{type}-add`).
- Sign-in (ADR-067): registration signs straight in through `useAuth().register()`;
  `SocialButtons` offers Google and Apple at the top of Sign in and Register (the mock on test
  stacks, the system Apple sheet on iPhone, otherwise the website relay with a bound nonce). Only
  the API's answer hides them; unknown shows both and a press asks again. Sign in always shows
  the fingerprint button (a hint until it is set up); fingerprint sign-in keeps its device
  credential only in `biometrics` (secure store behind the biometric prompt). Signing out keeps
  it; `forgetAccount()` (deletion) clears it.
- Give interactive elements used by Maestro a stable `testID` (fields: the form path, such as
  `passengers.0.surname`; choices: `{testID}-{value}`; suggestions: `{testID}-option-{key}`).
- Account screens wrap their content in `RequireAccount` and live under `app/account/*`.
  Deleting the account or signing out goes through `useAuth().forgetAccount()` / `signOut()`,
  which clear tokens and run `forgetAccountData()` (account trips, booking copies and documents
  that are not guest trips, scanning keys, cached queries). `AppProvider` runs the same when the
  API refuses the refresh token (`SessionStore.onRevoked`); keep new account data in that one
  function. Files with personal data (the data
  export) are written to the cache, handed to the share sheet and deleted when it closes.
- Visa uploads come from the system document picker (`lib/visa-upload.ts`), which deletes its
  cache copy once read; the raw bytes are the request body. Voucher QR codes are drawn on the
  device from the offline booking copy (`uqr`), never fetched as images.

### In-house products (apps/api, ADR-025 to ADR-028)

- Packages, tours, visa assistance and add-ons are `ItemPayload` kinds (`package`, `tour`,
  `visa`, `addon`) on the one booking pipeline: quotes are `Offer` rows with supplier `suskii`,
  priced by `priceItem`; the pre-payment re-check reads the catalog (`InhouseCatalog.reprice`).
  Never build a parallel booking flow.
- Seats change only through `reserveSeats` (conditional update in the booking-create
  transaction, 409 `sold-out`) and `settleSeats`, which `BookingTransitions.apply()` calls.
- Vouchers and visa applications are created by `InhouseFulfilment` in the confirming
  transaction. Voucher codes are stored as an HMAC (`booking-voucher`) plus ciphertext; the QR
  payload is `SUSKII-V1:` and the code, never personal data.
- Confirmed in-house bookings are cancelled through `BookingCancellationService` under the
  product's tiers (fee to the ledger, refund of the tier's share, or `withdraw` when nothing is
  refunded). Visa assistance is not self-cancellable.
- Visa documents: only `VisaDocumentsService` reads or writes them (per-document key wrapped with
  `visa-document:{id}`, name with `visa-document:{id}:name`); content is served only through
  `ownerLink`/`officerLink` signed URLs and the content route. Uploads are raw request bodies
  read with a size limit after the ownership check. Scanning goes through `AntivirusScanner`
  (production refuses the mock unless `ALLOW_MOCK_PROVIDERS=true`).
- Add-on links (`addon-links`) are short-lived HMAC tokens; add-on details are encrypted per
  booking item (`booking-item:{itemId}:addon-details`).
- Real inventory, prices and visa rules come only from the admin routes. Demo data comes only
  from `db:seed:demo` and is flagged `sample` (clients show a badge).

### Accounts, Prime, referrals and notifications (apps/api, ADR-029 to ADR-032)

- Every Prisma model has an entry in `DATA_REGISTRY` (`src/privacy/data-registry.ts`): its
  export section, deletion treatment (`delete`, `redact`, `retain`, `none`) and retention
  (`account`, `reference`, a `RetentionService` rule, its own job, its parent, or `append-only`;
  ADR-039). A table that grows with use needs a purge rule. A new model
  fails compilation and `data-registry.spec.ts` until it has one; add new personal data to the
  export (`DataExportService`) and to `AccountDeletionService` in the same change.
- Sensitive account actions (export, deletion) take a proof checked by `ReauthService`
  (password, texted code or a sign-in in the last 10 minutes, plus MFA). Deletion answers 409
  with `blockers` while anything is unsettled and keeps financial records without contact data.
- Members are tier `prime` only while a paid-up term runs (`currentPrime()`). The access token's
  `prm` claim is for searches; quotes, bookings and the payment re-check re-read the database
  (`withCurrentTier()`). Benefits apply in `priceOffer()` and never price below supplier cost.
- Plan prices may name a country (ADR-082): resolve them only with `resolvePlanPrice()` from
  `@suskii/shared`, with the edge's country (`requestContext().country` / `client.country`),
  never a client-supplied value; the membership payload keeps `priceCountry` for the re-check.
  The website passes its own edge country (`edgeCountry()`) for displayed prices only.
- A Prime purchase is the in-house item `membership` on the booking pipeline (owner required,
  one `guests` entry, no PDF, no self-cancellation); `InhouseFulfilment` starts the term.
- Send user messages through `NotificationService.notify(userId, content)` with a category and
  per-channel renderings (`src/messaging/messages.ts`); it applies the preference matrix and
  logs each attempt. Booking and payment email are mandatory; marketing needs recorded consent.
  Push data carries only an in-app path the app allowlists (`resolveNotificationPath`).
- Fingerprint sign-in (ADR-067) issues device credentials only through `DeviceCredentialsService`
  (fresh session, HMAC stored, five per account); `SessionService.revokeAllForUser` and incident
  revocation end them with the sessions. Mock Google and Apple tokens (`SOCIAL_MOCK_ENABLED`) are
  for test stacks only and production refuses them; a bound nonce needs its `bindingSecret`.
- Referral rewards come from `REFERRAL_*` settings (zero by default) and are paid only through
  `LedgerService` (`referral_reward`); a fraud flag sends the referral to review, never to a
  silent rejection or payout.

### Admin API and console (apps/api, apps/admin, ADR-033 to ADR-036)

- Every `/v1/admin` route has `@AdminRoute(permission)` and every admin mutation declares the
  audit actions it records (`audit: [...]` in its contract). The OpenAPI build fails otherwise;
  the route matrix (`admin-matrix.e2e-spec.ts`) checks a new route automatically, and
  `admin-audit.e2e-spec.ts` fails until a new mutation has a case there.
- Cookie-authenticated admin calls must come from an `ADMIN_ORIGINS` origin (every method);
  bearer tokens are not origin-checked but still need staff, MFA and the permission.
- The riskiest admin mutations (roles, disable, MFA reset, refund approval, trust-signal verify,
  markups, fees, tax rules, Prime plans, driver approval and reinstatement, company suspension, metasearch partner keys) also carry `@StepUp()`: an authenticator check within
  `STEP_UP_WINDOW_MINUTES` (sign-in or `POST /v1/me/mfa/step-up`), else 403 `step-up-required`.
  The console's API client prompts and repeats the write itself (ADR-037).
- Staff sessions are short (`STAFF_SESSION_*`) and every account has a device cap; end sessions
  only through `SessionService` or `revokeSessionsWhere` (Redis denylist included), and in an
  incident with `pnpm --filter @suskii/api sessions:revoke`.
- Admin edits validate the merged record with the public schema (`checkMerged`), record
  `fieldChanges()` in the audit metadata (names only for free text), and deactivate or
  unpublish rather than delete where history matters. Editing a verified trust signal clears its
  verification; only `trust-signals:verify` (super admin) verifies, with an https evidence URL.
- Console pages live in `components/pages/<area>.tsx`; files under `app/(console)/` only render
  them. A new section needs a `NAV_ITEMS` entry whose permissions match its API routes: the shell
  mounts a page only for staff whose roles open its section, and staff without the dashboard land
  on their first section.
- Data goes through `$api` (openapi-react-query) or `adminApi`; query keys start with
  `['get', path]`, so invalidate by path. Cursor lists use `useCursorPages`; errors become
  `ApiProblem` (`problemOf`, `problemMessage`; add new problem slugs to `admin.problems`).
- Forms take decimals and percentages: convert with `minorFromInput` / `bpsFromPercent` (and
  back), map API issues with `fieldIssues`, and never send floats. Destructive actions use
  `ConfirmAction`. Copy comes from `@suskii/i18n/admin` (`t`, `label` for enum values).
- Admin e2e tests sign each persona in once (`signIn` uses the next TOTP step) and look up alerts
  with `alertWith` (Next's route announcer is an empty alert) and toasts with `expectToast`.

### Cars (apps/api ground, buses, rides, drivers, rentals, planning; ADR-049 to ADR-053)

- Every Cars product and feature sits behind `CarsFlags.enabled()` (`CARS_*_ENABLED`; unset is on
  outside production, off in production). Routes take `@CarsFeatureRoute('...')` and answer 404
  while off; clients read `GET /v1/cars/features` and hide what is off. In the app, unknown (API
  unreachable) is not off: Home and the Cars hub still list buses, rides and rentals beside
  `ServerUnreachable` (retry; Test server in the test build), never an endless spinner.
- Buses: seats are held only through `BusHoldsService` (Redis Lua, all or nothing, 10 minutes,
  `BUS_MAX_ACTIVE_HOLDS`) and sold through the booking pipeline. Boarding passes are signed by
  `TicketSigner` (`SUSKII-T1.<kid>.<claims>.<signature>`, ids and the boarding window only) and
  re-signed on every read; the payload is never stored. Scans go through `BusTicketsService`
  (`scan`, `sync` for offline scanners); the first scan wins and later ones are audited.
- Rides: status changes only through `RideTransitions.apply()`; one acceptance wins (conditional
  update plus a unique live ride per driver). Driver positions enter only through
  `RideDriverService.location()` (service area, speed between fixes, late fixes never rewind);
  riders and share links see `roundPoint()` positions. SOS, PIN lockout and route deviation go
  through `SafetyService.raise()`.
- Drivers: NIN and licence numbers are encrypted (`driver:{id}:nin`, `:licence`) with HMACs for
  uniqueness; documents only through `DriverDocumentsService`; earnings leave only through
  `DriverPayoutsService`.
- Rentals: availability is the database exclusion constraint (with `RENTAL_TURNAROUND_HOURS`),
  never an application check; handover records are immutable and photos are sealed per file.
- Fare breakdown lines come from `carsPriceBreakdown()` (allocated from the priced fare, so they
  add up and show no margin); `priceBreakdown` is an additive field. The departure planner and
  trip suggestions (`TripPlanningService`) load bookings through `BookingsService.load()`, use
  the `RIDE_SCHEDULE_*` window and only ever prefill searches.
- Demo drivers (`rides:demo`, `E2E_DEMO_DRIVERS=true` on `e2e:stack`, ADR-056) act only on
  `sample` drivers through `RideDriverService` and never read the PIN (the tester types it);
  keep them out of `src` so they never ship, and keep the production refusal.
- Maps, KYC and payouts sit behind `MapsProvider` (mock, OSRM), `KycProvider` and
  `PayoutProvider` with mock adapters; production refuses mock routing and KYC while rides are on.
- The app: Cars screens follow the mobile rules above. Offline boarding (`lib/offline-scan.ts`)
  keeps ticket keys, the scan queue and boarded tickets in `secureCache()`. Each queued scan
  names its agent and uploads only under that agent; sign-out uploads the queue, clears the keys
  and boarded tickets, and keeps unsent scans for their agent for 48 hours
  (`OFFLINE_SCAN_MAX_AGE_MS`). The camera is used only on the operator scan screen.
- Personal data in Cars is mapped in `docs/privacy/cars-data-map.md`; metrics in
  `telemetry/metrics.ts` and `operations-metrics.ts`; runbooks for safety incidents, stuck rides,
  the driver document backlog and an offline scanner are in `docs/runbooks/`.
- The website has no Server Actions; preferences post to `app/preferences/[name]/route.ts`
  (route handlers keep the CSRF and origin checks in one place). Semver 6 is overridden to 7
  (`semver@<7`) so Babel's graph never needs `semver@6.3.1`, which the trust policy refuses.

### Partner offers and affiliate tracking (apps/api/src/partners, ADR-069, ADR-070)

- Merchant supply (we sell at our price) goes through the supplier interfaces; affiliate supply
  (the partner sells, we earn commission) goes through `src/partners`. Never take payment for an
  affiliate product: the traveller books on the partner's site.
- Programmes live in `partner-programs.ts` (category, network, brand, allowed hosts, landing
  page); adding a partner is one entry. Offers never carry raw partner URLs: links are
  `PartnerLinks.href()` (AES-GCM, context `partner-link`, expiry `PARTNER_LINK_TTL_HOURS`), and
  `/v1/go/{token}` only redirects to the programme's hosts (or Travelpayouts' tracking hosts).
- Clicks are recorded only by `PartnerClicksService.follow()` (ids only: no IP, browser or URL);
  the click id is the network's `sub_id`. An expired link still redirects, without the viewer.
- Network calls go through `AffiliateLinker` (mock, Travelpayouts) and `ActivityPartner` (mock,
  Viator); vendor payloads stay in the adapter, failures fall back (untracked link, offers
  without activities and `partial: true`), never an error page.
- Conversions are recorded only by `PartnerConversionsService` from postbacks with the network's
  secret (constant-time compare); states move forward only, amounts are minor units. They are
  commission records counted per partner, never joined to people for advertising (store forms,
  ADR-070).
- `PARTNER_OFFERS_ENABLED` is off in production unless set; production then refuses the mock
  network and mock activities.
- Clients show offers through `PartnerOffers` (web `components/partners`, app
  `src/components/partners`): links open the API's `/v1/go/{token}` (web: new tab with
  `rel="noopener sponsored"`; app: `openBrowserAsync` with `appConfig.apiBaseUrl`), the card always
  shows `partners.disclosure`, and nothing renders while offers are off or empty. Fetch them in the
  browser or the app, never on the server, so the link seals the signed-in traveller.

### Verified reviews (apps/api/src/reviews, ADR-077)

- Only a confirmed booking item whose trip has ended (the day after `tripFacts` `endDate`, within
  `REVIEW_WINDOW_DAYS`) can be reviewed, once, through `ReviewsService` with the booking loaded by
  `BookingsService.load()` (owner or guest token; 404 for anyone else). Kinds: hotel, package,
  tour, bus (the operator) and rental (the car). Never add another way to create a review.
- Reviews wait for a moderator (`reviews:moderate`); `ReviewModerationService` claims the
  decision with a conditional update and changes the subject's `rating_sum`/`rating_count` in the
  same transaction. Nobody edits a traveller's words; withdrawing deletes and takes the rating
  off the totals. Only published reviews are shown or counted (JSON-LD included).
- Subjects come from `findOrCreateSubject`: catalog products by kind and id, bus operators via
  the trip, hotels by `hotelNameKey` within `SAME_HOTEL_METRES` under an advisory lock (search's
  duplicate rule), so a hotel's score follows it across suppliers (`HotelReviewLookup`, one query
  per results page; a failure never fails a search).
- The shown name is "Ada O." (`reviewDisplayName`) or none; text is flagged by `reviewFlags`
  (contact details, links) for the moderator. Audit metadata carries ids only, never the text.
- Invitations: `ReviewInvitationsService` plans `review_invite_at` (08:00 UTC the morning after
  the first reviewable item ends) and sends once (`review_invited_at` claim): account holders via
  `NotificationService` (`review_requests`), guests via `BookingNotifications.reviewInvitation`
  with an access link. The worker runs it every `REVIEW_INVITATION_SWEEP_MINUTES`.
- Clients: the website's `ProductReviews` (server-rendered, JSON-LD only with published reviews
  on indexed, non-sample pages) and `TripReviews` on the booking page; the app's
  `ProductReviews` and `TripReviews` (trip screen, online only). Every review section shows
  `reviews.verifiedNote` (how reviews are checked).

### Company accounts (apps/api/src/companies, ADR-078)

- Every `/v1/me/company` route resolves the caller's own membership first (`CompaniesService`);
  there is no company id in the path, and member, invitation and booking ids are looked up inside
  that company (404 otherwise). One company per person (unique `company_members.user_id`).
- Roles: `admin` (details, policy, members), `approver` (approvals and reports), `booker` and
  `traveller` (their own company trips). Use `canManageCompany` / `canApprove` /
  `seesAllCompanyBookings` from `@suskii/shared`, never role string checks. Role changes lock the
  company row; the last admin cannot leave, step down or delete their account (`company_admin`).
- Invitations: a random token emailed as `/company/join#invite=…`, stored only as an HMAC
  (`company-invitation`, with the address as `company-invitation-email`), single use, 7 days, and
  accepted only by an account whose verified email is the invited one.
- Booking for the company: `createBooking` with `company: true` calls
  `CompanyPolicyEvaluator.forBooking()` (provided by `BookingsModule`, no module cycle) after
  pricing; findings come from the quote and the priced total, never from the client. Payment and
  payment plans refuse `approvalStatus = pending` (409 `approval-required`); the booking DTO's
  `company` section and null `paymentOptions` tell clients to wait.
- Decisions go through `CompanyTripsService` only: a conditional update claims the decision,
  rejecting cancels through `BookingTransitions.apply('cancel')`, nobody decides their own trip,
  and the booker is notified. Never set `approval_status` elsewhere.
- Reports read committed bookings (partly paid, paid, ticketing, confirmed) per currency; amounts
  stay minor units and are never converted across currencies. CSV cells go through `csvCell()`
  (no leading formula characters) and carry no contact or passport details.
- Console: `/v1/admin/companies` for `users:read`; suspend (`users:manage`, `@StepUp()`) and
  reinstate are audited. A suspended company cannot book for itself (409 `company-suspended`).

### Ads with consent (apps/web, apps/api/src/marketing, ADR-079)

- The website's Meta and TikTok tags start only through `Marketing` (root layout): the server
  reads the consent cookie (`getMarketingState()`: `ask`, `allowed` or `refused`) and the
  prompt and `AdTags` are lazy chunks loaded only when needed; a later choice arrives as the
  `suskii:consent` event with the choices in `detail`. Keep anything that imports consent
  parsing or ad code out of modules every page loads: the homepage budget has almost no room.
  Ids come from `META_PIXEL_ID` / `TIKTOK_PIXEL_ID` at request time (`adTagConfig()`); unset
  means no tag, no prompt and no CSP hosts (`adTagOrigins`).
- Pages report through `trackAd(event, params)` or `<TrackAd>` with trip facts only: the booking
  vertical as content id, airport codes for a flight search, value and currency from an API
  `Money` (`adValue`), the booking id as Purchase event id. Never a name, email, phone or
  booking reference; never call the networks' globals directly.
- `ConsentPrompt` shows while a tag is configured and no choice exists under the current policy;
  "Accept all" and "Reject all" keep the same style. A new optional cookie or storage key goes
  in `cookie-catalog.ts` and every catalog, with a `COOKIE_POLICY_VERSION` bump when visitors
  should choose again.
- Checkout sends `marketing` (`marketingAttribution()`: consent id and validated click ids) only
  with marketing consent. The API keeps it only through `AdAttribution.keep()`, which re-reads
  the recorded choice (`marketingAllowed`); the browser's word is never enough.
- Purchase events leave only through `AdConversionsService` (worker sweep, internal route) and
  `AdConversionsProvider` adapters (mock, Meta, TikTok): consent re-checked before each send,
  SHA-256 of the normalised email and phone, tokens never in a URL, click ids cleared once
  settled. Production refuses the mock. The app has no ad SDK: adding one changes the store
  forms (`docs/release/data-safety.md`).

### SEO pages from fare history (apps/api/src/deals, apps/web, ADR-080)

- Fare history enters only through `RouteFactsService.record()` from the deal refresh (the same
  day keeps the cheaper find, compared in `usd_minor`). Facts come from the pure rules in
  `route-facts.ts` and are priced at read time through `DealsService.priceFor().fare()`; never
  store or return a priced or supplier figure from `route_fares` directly.
- Hub slugs come from `citySlug()` in `@suskii/shared` on both sides; hubs and airline pages
  answer 404 without routes and are listed in the sitemap only when they have some.
- Every figure on these pages says what it is (one adult, return, recent fares, today's rules);
  sample (mock) fares stay badged. The web e2e stack sets `ROUTE_FACTS_MIN_DAYS=1`.

### Metasearch partners (apps/api/src/metasearch, apps/web, apps/admin, ADR-081)

- Partners call only `GET /v1/metasearch/flights` with `X-Api-Key`; `MetasearchService.authenticate()`
  finds the key by HMAC (`metasearch-key`) and applies the partner's minute and day windows. The
  route skips the per-address limits; never give partner keys any other route or a session.
- Keys are created and replaced only through `MetasearchAdminService` (shown once, stored as an
  HMAC, audited, step-up). Never store, log or return a key after that answer.
- Partner prices come from `FlightSearchService.priced()` with the website's guest context, so they
  match what a guest sees; that path writes no search log row. Never price partners another way
  without a sealed sales channel (ADR-081).
- Deep links are `MetasearchLinks` envelopes (context `metasearch-link`): partner, request,
  `itineraryKey()`, shown total and issue time, no personal data. Landings re-find the itinerary
  (`findItinerary()`), quote it with the supplier, record a `metasearch_landings` row and tie the
  quote to it in one transaction; bookings copy `metasearch_landing_id` from the quote.
- The website's `/flights/go/[token]` is private (noindex, disallowed in robots.txt) and goes to
  checkout on `same` or `lower`. Its e2e answers the landing call in the browser; the API e2e
  covers keys, limits, prices and attribution.

### Support conversations (apps/api/src/support, ADR-083)

- A conversation is the ticket and the chat: `support_conversations` plus `support_messages`
  (customer, staff or system; staff messages may be internal notes). WhatsApp and the assistant
  add channels and authors to these tables, never another flow.
- Travellers reach theirs only through `SupportService` (`load`: the account's own, or a guest's
  `X-Support-Token`, the access token from the start or an emailed link token checked by
  `SupportAccess`); everyone else gets 404. A booking is attached only after
  `BookingsService.load()` succeeds for the caller.
- Starting without a session needs Turnstile (website) or the device attestation (app) and an
  email unless the booking has one; `SUPPORT_LIMITS`, five open conversations per account, 500
  messages each and `SUPPORT_MESSAGE_MAX` characters apply.
- Due times come only from `supportSchedule()` in `@suskii/shared` (priority from
  `supportPriority()`: urgent trips within `SUPPORT_URGENT_HOURS`, Prime plans with
  `prioritySupport`, else normal; targets from `SUPPORT_SLA`). Recompute them on every change;
  `due_at` orders the inbox and its keyset cursor.
- Message bodies are encrypted per message (`support-message:{id}:body`), a guest's email per
  conversation. Reply notices (`supportReplyMessage`, category `support`) never carry the reply;
  guests get an email link with the token in the fragment (`#access=`).
- Internal notes never reach a traveller route, the export or a notification. Staff routes
  (`/v1/admin/support`, `support:manage`) audit replies, notes and changes (`fieldChanges()`).
- Clients poll the open conversation every few seconds while it is visible (web 4 s, app 4 s,
  console 10 s). The app keeps guest tokens in `secureStorage` (`lib/support.ts`); website links
  to `/support/{id}` stay in the browser so link tokens never reach the app's router.
- WhatsApp (ADR-084): `/v1/webhooks/whatsapp` processes nothing before `whatsappSignatureValid()`
  passes on the raw bytes; vendor payloads stay in `whatsapp-webhook.ts` and the
  `WhatsAppChannel` adapters (`mock`, `cloud`). Inbound messages go only through `WhatsAppInbox`
  (dedupe on `support_messages.external_id`, routing by `customerMessageChanges()`), and staff
  replies only through `WhatsAppReplies` after the commit (text in the window, the template
  notice outside it, `forwardWaiting` when the traveller writes back). Delivery states move
  forward only (`supportDeliveryAdvances`). Never link a contact to an account by phone number.
- The after-hours assistant (ADR-085) writes only through `SupportAssistant` (called with
  `consider()` after a traveller's message commits): outside `SUPPORT_HOURS`, before any staff
  reply, at most `SUPPORT_ASSISTANT_MAX_REPLIES` answers and one handover, under its spend caps
  (`AiSearchBudget` with its own scope). It never touches status, priority, assignee or SLA
  fields; its messages have author `assistant` and kind `text` or `handover`. The model sees
  only FAQs, the scrubbed messages and `assistantBookingFacts()` (no names, contacts, documents,
  codes or references); `checkAnswer()` must pass (known sources, every figure and contact from
  the cited sources) or the traveller gets the handover. A prompt, schema, facts or model
  change keeps the recorded eval at 40/40 and is re-run against the model
  (`eval:support-assistant`, `ai-eval.yml` suite `support-assistant`) before it ships.

### AI trip search (phase 13, ADR-061)

- The model only fills the flight form; it never searches, books or reads private data. Clients
  show every value as an editable field before anything is searched. Never let model output reach
  a supplier, a price or a booking without the traveller submitting the form.
- Model calls go through `LlmProvider` (`src/ai-search`); vendor SDKs stay in the adapter. The
  answer must match a JSON schema (structured output) and is validated again with Zod; places
  resolve only through `PlaceResolver` (the catalog), dates and travellers through the form's
  rules. A value that fails goes to `missing`, not an error.
- Text leaves only after `scrubQuery()` and is never stored, logged or put in metrics (outcomes,
  latency, tokens and cost only). Requests carry no user id.
- Every call reserves its worst case with `AiSearchBudget` first and settles to the billed
  usage; a timeout keeps the reservation. Prices and caps come from settings.
- Accuracy is measured by the 50-case eval, not assumed: a prompt, schema or model change must
  keep the e2e test at 50/50 (recorded answers) and be re-run against the model
  (`eval:natural-search`, `ai-eval.yml`) before it ships.
- Both clients open the box from a button above the flight form; the website loads its code only
  then (homepage budget). The button shows while `GET /v1/flights/natural-search` says the feature
  is on, and hides when the API cannot say.

### Accessibility (WCAG 2.2 AA, ADR-088)

- The target is WCAG 2.2 AA on the website, the console and the app; the conformance table
  (`docs/accessibility/wcag-2.2-aa.md`) changes with the code it describes.
- A new public page goes in `PAGES` in `apps/web/e2e/a11y.spec.ts` (axe, 24 px targets, reflow at
  320 px). Targets are at least 24 by 24 px except links inside a sentence; search and checkout
  controls are 44 px or more (`min-h-12`). A short link outside a sentence gets
  `inline-flex min-h-6 items-center`.
- Headings follow the outline: cards listed straight under a page's `h1` are `h2` (pass
  `headingLevel`), under a section heading `h3`.
- Every interactive element shows `focus-visible:focus-ring`; nothing may sit above the sticky
  header's scroll padding (`scroll-pt-20` on `html`) without being modal.
- App touchables take `accessibilityRole` and a name (text inside or `accessibilityLabel`);
  radios, checkboxes and switches report `accessibilityState.checked`, tabs `selected`; text
  inputs carry `accessibilityLabel`; never set `allowFontScaling={false}`. `accessibility.test.ts`
  fails otherwise. The app follows the device's orientation.
- Run the screen reader checklist (`docs/runbooks/screen-reader-checklist.md`) before each store
  release and any release that changes search, checkout or sign-in.

### Hardening (phase 11, ADR-037 to ADR-048)

- Security documents live in `docs/security/` and must change with the code they describe:
  new personal data goes in `data-classification.md`, a new sign-in path or session rule in
  `authentication.md`, a new permission or field rule in `access-control.md`, a new outbound host
  in `external-communications.md`, a new expensive feature or limit in `business-limits.md`,
  a new key in `crypto-inventory.md`. Requirement statuses live in
  `docs/security/standards/mapping.json`; run `pnpm security:checklist` after editing it (CI
  fails on unmapped ids, missing evidence paths or a stale page).
- Logs carry ids and reasons, never values. A field that can hold a secret or personal data
  goes in `SENSITIVE_LOG_FIELDS` (`packages/shared/src/log-redaction.ts`); redaction covers the
  top level and three levels below. Record security events with `AuditService.record()`.
- Report unexpected errors through the `ErrorReporter` (API: injected, global; worker:
  `createErrorReporter`; web and admin: `lib/error-reporter.ts`; app: `lib/error-reporting.ts`).
  Tags only from `ERROR_TAG_KEYS`; messages are scrubbed, but never put personal data in them.
- Metrics: define instruments in `apps/api/src/telemetry/metrics.ts` (or the worker's
  `telemetry.ts`). Dashboards and alert rules may only use defined metrics, and a paging alert
  needs an existing runbook (`observability.spec.ts`); CI runs promtool on the rules.
- Outbound HTTP uses `redirect: 'error'` and a timeout. Production refuses plain http for every
  provider, the internal API, Postgres, Redis, OTLP (except localhost) and SMTP.
- The API compresses only the public reads in `COMPRESSED_PATHS` (`app.setup.ts`, ADR-075).
  Never add a route whose answer can hold a token or personal data (BREACH).
- Every `<form>` has a `method` (`post` for personal data, `get` only for searches); a lint rule
  enforces it.
- Website cookies and storage keys go in `apps/web/lib/cookie-catalog.ts` (an e2e test fails on
  anything unlisted). The site's own cookies are named with `hostCookie()` (`__Host-` in
  production); optional categories run only after `hasCookieConsent()`.
- Beacon routes (`text/plain` bodies, such as web-vitals) are listed in `BEACON_PATHS` and
  declared `beacon: true` in the contract; they are capped at 8 KB.
- ui-web merges classes with the token-aware `cn` (no tailwind-merge at runtime); the homepage
  JavaScript budget is 170 kB (ADR-043) and the Lighthouse gate checks LCP, CLS and TBT.
- Money, pricing, booking lifecycle and auth modules keep 80% coverage (`test:cov` in CI).
- Retire app builds with `MOBILE_MIN_VERSION` (the API answers 426 and the app shows an update
  screen). Pause a failing payment provider with `PAYMENT_PROVIDERS_PAUSED`, never by removing
  it from `PAYMENT_PROVIDERS` (that orphans its webhooks and refunds).
- Incidents follow `docs/runbooks/`. Disclosure and remediation time frames are in `SECURITY.md`.

### Deployment and release (phase 12, ADR-057 to ADR-060)

- Images are built from the repository root with `apps/<app>/Dockerfile`; the base image is
  pinned by digest (Dependabot updates it). Never run migrations at start-up: the API image's
  `migrate` target runs `scripts/release-database.mjs` (migrations as the schema owner, the
  seed, then the app role) as a job or Helm hook before new revisions start.
- Migrations are expand/contract: the revision still serving must work against the new schema.
  `pnpm check:migrations` (CI) refuses drops, renames, type changes, new NOT NULL without a
  default and TRUNCATE unless the file says why on an `-- expand-contract:` line.
- The API connects as `suskii_app`, which may only read and write rows
  (`src/infra/app-role.ts`). Application code must never need DDL, TRUNCATE or role changes.
- A new setting: add it to the env schema and `.env.example`, then to Terraform (`api_env` or,
  for a secret, `extra_secrets` plus a Secret Manager value) and to the Helm values. Plain
  settings that look like secrets are rejected by both. Settings are not part of images.
- Deployed environments set `CLIENT_IP_HEADER=cf-connecting-ip` (never with `TRUST_PROXY_HOPS`);
  only Cloudflare traffic carrying the origin secret reaches the origin.
- A new route prefix that must never be public (like `/v1/internal`) also gets an edge block in
  `infra/terraform/modules/edge`. A new public host goes in `hosts` for both modules.
- Operator scripts that change data run as the `ops` Cloud Run job, never from a laptop against
  production; each checks first and changes only with `--yes`, and audits what it changes.
- Production runs the API, migrate and worker digests staging tested (signature verified, then
  copied); the website and console are built per environment from GitHub environment variables
  (`NEXT_PUBLIC_*`). Never retag or push images by hand.
- Workflows pin actions by commit SHA, at least two weeks old, and tools by version plus SHA-256
  or `go install` at a fixed version. Credential-gated steps fail at their first step with the
  missing settings named.
- Terraform changes: `terraform fmt`, then `validate` and TFLint run in `infra.yml`; operators
  apply them (`infra/terraform/README.md`). Store and privacy changes update `docs/release/` in
  the same change.

### Security guardrails

- Never commit `.env` files, secrets, or real supplier credentials. Use `.env.example` placeholders.
- Never log PII, tokens, passport numbers or payment data.
- Never see or store raw card data (SAQ-A: hosted checkout or tokenised fields only).
- Trust signals are CMS-driven with a `verified` flag. Only verified ones render. IATA accreditation
  and traveller counts stay hidden until proof exists.
- Never use Wakanow names, marks, copy or imagery. The membership is **Suskii Prime**.

### Design system

- `packages/design-tokens/src/tokens.ts` is the only place visual values live. Spec values must stay
  identical to `PROJECT_SPEC.json` (tested); derived tokens are documented in ADR-003/ADR-004.
- Brand (ADR-068): the palette comes from the SUSKII T&T logo (red actions, blue headings,
  orange promotions) and `BRAND.shortName` is `SUSKII T&T`. Rebuild images with
  `scripts/brand-assets.mjs`, never by hand.
- Style with token utilities only: `bg-primary`, `text-foreground`, `text-muted`, `text-h2`,
  `p-4` (4px scale), `rounded-lg`, `shadow-card-hover`, `focus-visible:focus-ring`. Tailwind's default
  palette and scales are removed, so `bg-red-500` or `p-7` simply do not exist.
- Never write hex/rgb colours, px/rem lengths, arbitrary values (`w-[13px]`) or literal inline styles
  in components; guard tests fail the build. Native icons take `iconColor` / `iconSize`.
- Orange (`accent`) fills take dark `on-accent` text; inputs use `border-strong` (ADR-004).
- Components contain no user-facing copy: labels are props, so apps pass localised strings.
- New or changed pairings of text and background go in `contrast-contract.ts`.
- New ui-web component = component + story (with a play function for open states) + an entry in
  `src/index.ts`; the story is then axe-checked at mobile and desktop widths automatically.

### Git

- Conventional Commits, enforced by commitlint in the `commit-msg` hook (`feat:`, `fix:`, `chore:`,
  `docs:`, `ci:`, `build:`, `refactor:`, `test:`).
- `pre-commit` runs lint-staged: Prettier on every staged file, ESLint `--fix` on staged TS/JS in
  `apps/*` and `packages/*`.
- Line endings are LF everywhere (`.gitattributes`).

## Key decisions

- [ADR-001: Architecture](docs/decisions/ADR-001-architecture.md)
- [ADR-002: Toolchain and versions](docs/decisions/ADR-002-toolchain-and-versions.md)
- [ADR-003: UI stack and design-token pipeline](docs/decisions/ADR-003-ui-stack-and-token-pipeline.md)
- [ADR-004: Accessible derived colour tokens](docs/decisions/ADR-004-accessible-derived-colour-tokens.md)
- [ADR-005: Zod route contracts and OpenAPI 3.1](docs/decisions/ADR-005-zod-contracts-and-openapi.md)
- [ADR-006: Reference data sources](docs/decisions/ADR-006-reference-data-sources.md)
- [ADR-007: Authentication, sessions and abuse controls](docs/decisions/ADR-007-authentication-and-sessions.md)
- [ADR-008: Money, pricing rules and exchange rates](docs/decisions/ADR-008-money-pricing-and-fx.md)
- [ADR-009: Supplier adapters and search orchestration](docs/decisions/ADR-009-suppliers-and-search-orchestration.md)
- [ADR-010: Web rendering, CSP, preferences, i18n and imagery](docs/decisions/ADR-010-web-rendering-csp-i18n-and-imagery.md)
- [ADR-011: Deals, hotel destinations and the internal API](docs/decisions/ADR-011-deals-destinations-and-internal-api.md)
- [ADR-012: Newsletter consent, double opt-in and bot protection](docs/decisions/ADR-012-newsletter-consent-and-bot-protection.md)
- [ADR-013: Homepage performance and the JavaScript budget](docs/decisions/ADR-013-homepage-performance-and-js-budget.md)
- [ADR-014: Booking lifecycle, checkout and mock payments](docs/decisions/ADR-014-booking-lifecycle-checkout-and-mock-payments.md)
- [ADR-015: Passenger data, saved travellers and guest access](docs/decisions/ADR-015-passenger-data-saved-travellers-and-guest-access.md)
- [ADR-016: Payment providers, routing and verification](docs/decisions/ADR-016-payment-providers-routing-and-verification.md)
- [ADR-017: Double-entry ledger and wallet](docs/decisions/ADR-017-double-entry-ledger-and-wallet.md)
- [ADR-018: Book on hold and installments](docs/decisions/ADR-018-book-on-hold-and-installments.md)
- [ADR-019: Refunds, maker-checker and automatic refunds](docs/decisions/ADR-019-refunds-maker-checker-and-automatic-refunds.md)
- [ADR-020: Mobile app architecture, storage and offline](docs/decisions/ADR-020-mobile-app-architecture-storage-and-offline.md)
- [ADR-021: Mobile payments, deep links and app links](docs/decisions/ADR-021-mobile-payments-deep-links-and-app-links.md)
- [ADR-022: Push notifications](docs/decisions/ADR-022-push-notifications.md)
- [ADR-023: Device attestation and mobile bot protection](docs/decisions/ADR-023-device-attestation-and-mobile-bot-protection.md)
- [ADR-024: EAS builds, app variants and mobile CI](docs/decisions/ADR-024-eas-builds-variants-and-mobile-ci.md)
- [ADR-025: In-house catalog, capacity and pricing](docs/decisions/ADR-025-in-house-catalog-capacity-and-pricing.md)
- [ADR-026: Visa assistance and document security](docs/decisions/ADR-026-visa-assistance-and-document-security.md)
- [ADR-027: Travel add-ons, standalone and linked](docs/decisions/ADR-027-travel-add-ons-standalone-and-linked.md)
- [ADR-028: In-house fulfilment, vouchers and cancellation](docs/decisions/ADR-028-in-house-fulfilment-vouchers-and-cancellation.md)
- [ADR-029: Account data rights, export and deletion](docs/decisions/ADR-029-account-data-rights-export-and-deletion.md)
- [ADR-030: Suskii Prime memberships and member pricing](docs/decisions/ADR-030-suskii-prime-memberships-and-pricing.md)
- [ADR-031: Referrals, rewards and fraud checks](docs/decisions/ADR-031-referrals-rewards-and-fraud-checks.md)
- [ADR-032: Notifications, channel preferences and price alerts](docs/decisions/ADR-032-notifications-preferences-and-price-alerts.md)
- [ADR-033: Admin console, staff sessions and origin isolation](docs/decisions/ADR-033-admin-console-staff-sessions-and-origin-isolation.md)
- [ADR-034: Admin route permission matrix and audit coverage](docs/decisions/ADR-034-admin-route-permission-matrix-and-audit-coverage.md)
- [ADR-035: Admin-managed pricing, promos, deals and content](docs/decisions/ADR-035-admin-managed-pricing-promos-deals-and-content.md)
- [ADR-036: Admin dashboards and reporting](docs/decisions/ADR-036-admin-dashboards-and-reporting.md)
- [ADR-037: Session limits, staff lifetimes and step-up](docs/decisions/ADR-037-session-limits-staff-lifetimes-and-step-up.md)
- [ADR-038: Social nonces, key rotation and transport security](docs/decisions/ADR-038-social-nonces-key-rotation-and-transport-security.md)
- [ADR-039: Data retention](docs/decisions/ADR-039-data-retention.md)
- [ADR-040: Payment risk review](docs/decisions/ADR-040-payment-risk-review.md)
- [ADR-041: Retiring old app versions](docs/decisions/ADR-041-retiring-old-app-versions.md)
- [ADR-042: Cookie consent](docs/decisions/ADR-042-cookie-consent.md)
- [ADR-043: Homepage JavaScript at 170 kB](docs/decisions/ADR-043-homepage-javascript-at-170-kb.md)
- [ADR-044: Measuring web performance in the lab and the field](docs/decisions/ADR-044-measuring-web-performance-in-the-lab-and-the-field.md)
- [ADR-045: API load testing with k6](docs/decisions/ADR-045-api-load-testing-with-k6.md)
- [ADR-046: Error reporting](docs/decisions/ADR-046-error-reporting.md)
- [ADR-047: Metrics, dashboards and alerts](docs/decisions/ADR-047-metrics-dashboards-and-alerts.md)
- [ADR-048: Security verification checklist and accepted risks](docs/decisions/ADR-048-security-verification-and-accepted-risks.md)
- [ADR-049: Cars product boundaries](docs/decisions/ADR-049-cars-product-boundaries.md)
- [ADR-050: Cars threat model](docs/decisions/ADR-050-cars-threat-model.md)
- [ADR-051: Cars payments, holds and deposits](docs/decisions/ADR-051-cars-payments-holds-and-deposits.md)
- [ADR-052: Cars realtime transport](docs/decisions/ADR-052-cars-realtime-transport.md)
- [ADR-053: Cars geo storage](docs/decisions/ADR-053-cars-geo-storage.md)
- [ADR-054: Server address in the Android test build](docs/decisions/ADR-054-test-build-server-address.md)
- [ADR-055: Semver 6 override instead of a trust policy exception](docs/decisions/ADR-055-semver-6-override-instead-of-a-trust-policy-exception.md)
- [ADR-056: Demo drivers for local ride testing](docs/decisions/ADR-056-demo-drivers-for-local-ride-testing.md)
- [ADR-057: S3-compatible object storage without an SDK](docs/decisions/ADR-057-s3-compatible-object-storage-without-an-sdk.md)
- [ADR-058: Container images and supply chain](docs/decisions/ADR-058-container-images-and-supply-chain.md)
- [ADR-059: GCP topology and the Cloudflare edge](docs/decisions/ADR-059-gcp-topology-and-cloudflare-edge.md)
- [ADR-060: Release pipeline, canary and rollback](docs/decisions/ADR-060-release-pipeline.md)
- [ADR-061: AI trip search](docs/decisions/ADR-061-ai-trip-search.md)
- [ADR-062: Duffel Stays hotel adapter](docs/decisions/ADR-062-duffel-stays-hotel-adapter.md)
- [ADR-063: Checked bags on Duffel flights](docs/decisions/ADR-063-checked-bags-on-duffel-flights.md)
- [ADR-064: Online cancellation of ticketed flights](docs/decisions/ADR-064-online-flight-cancellation.md)
- [ADR-065: Airline schedule changes on ticketed flights](docs/decisions/ADR-065-airline-schedule-changes.md)
- [ADR-066: Hosted test server for phone testing](docs/decisions/ADR-066-hosted-test-server.md)
- [ADR-067: Google, Apple and fingerprint sign-in](docs/decisions/ADR-067-social-and-fingerprint-sign-in.md)
- [ADR-068: Brand refresh from the SUSKII T&T logo](docs/decisions/ADR-068-brand-refresh-from-the-logo.md)
- [ADR-069: Partner supply model](docs/decisions/ADR-069-partner-supply-model.md)
- [ADR-070: Affiliate click and conversion tracking](docs/decisions/ADR-070-affiliate-click-and-conversion-tracking.md)
- [ADR-071: Hotelbeds hotel adapter](docs/decisions/ADR-071-hotelbeds-hotel-adapter.md)
- [ADR-072: All-in prices and tax rules per country](docs/decisions/ADR-072-all-in-prices-and-tax-rules.md)
- [ADR-073: Refund offer for airline changes](docs/decisions/ADR-073-refund-offer-for-airline-changes.md)
- [ADR-074: Payment methods at checkout](docs/decisions/ADR-074-payment-methods-at-checkout.md)
- [ADR-075: Fast on slow 3G](docs/decisions/ADR-075-fast-on-slow-3g.md)
- [ADR-076: Languages and right to left](docs/decisions/ADR-076-languages-and-right-to-left.md)
- [ADR-077: Verified reviews](docs/decisions/ADR-077-verified-reviews.md)
- [ADR-078: Company accounts](docs/decisions/ADR-078-company-accounts.md)
- [ADR-079: Ads with consent](docs/decisions/ADR-079-ads-with-consent.md)
- [ADR-080: SEO pages from fare history](docs/decisions/ADR-080-seo-pages-from-fare-history.md)
- [ADR-081: Metasearch partners](docs/decisions/ADR-081-metasearch-partners.md)
- [ADR-082: Suskii Prime priced per country](docs/decisions/ADR-082-prime-priced-per-country.md)
- [ADR-083: Support conversations](docs/decisions/ADR-083-support-conversations.md)
- [ADR-084: WhatsApp as a support channel](docs/decisions/ADR-084-whatsapp-support-channel.md)
- [ADR-085: After-hours support assistant](docs/decisions/ADR-085-after-hours-support-assistant.md)
- [ADR-086: Expedia Rapid hotel adapter](docs/decisions/ADR-086-expedia-rapid-hotel-adapter.md)
- [ADR-088: WCAG 2.2 AA as the accessibility target](docs/decisions/ADR-088-wcag-2-2-aa-accessibility.md)

## Open questions for the owner

Tracked in `PROJECT_SPEC.json#/open_questions_for_owner` and repeated in each phase report until they
are answered: suppliers, IATA or consolidator, SSO with Suskii Errands, GCP or AWS, brand assets and legal
entity, Suskii Prime pricing. Added in phase 3: FX source for the naira and any FX margin (ADR-008),
hotel provider (Duffel Stays recommended, ADR-009), Duffel sandbox token. Added in phase 4:
support contacts, social and app store links, legal texts and privacy policy, licensed photography,
WhatsApp/SMS provider for deal alerts, Cloudflare Turnstile keys. Added in phase 5: which payment
provider comes first (Paystack, Flutterwave, Stripe) and test keys, booking conditions and fare
rules text, the refund and REFUND_PENDING operations process, and support contacts for failed
bookings. Added in phase 6: provider test keys and webhook registration for each provider to
launch with; installment deposit, fee, missed-payment fee and grace period (defaults 30%, none,
none, 24 hours); the staff refund approval threshold (default: every refund needs a second
approver); who receives operations alerts (`OPS_ALERT_EMAIL`) and reviews refunds in
`needs_review`; and whether stored cards may ever charge installments (needs a mandate, ADR-018).
Added in phase 7: the Expo account and EAS project (`EXPO_TOKEN`, `EAS_PROJECT_ID`), Apple
Developer and Google Play accounts, the final bundle id (placeholder `com.suskii.travels`), the
Google Cloud project for Play Integrity and Apple App Attest setup (real attestation verifiers
need both), FCM and APNs credentials for push, the production API and web hosts (app links), app
icon and splash art, and the account deletion flow required before store release (phase 9).
Added in phase 8: the real in-house inventory and who enters it (packages, tours, visa products
and eligibility rules, add-on partners; insurance may need a licensed partner), the package
balance-due period (default 30 days), visa document retention (default 90 days after closing),
production antivirus (managed ClamAV or a scanning service), and who fulfils packages, redeems
vouchers and staffs the visa officer role. Added in phase 9: Suskii Prime plans and prices
(the sample plan's NGN 25,000 or USD 25 a year, half the markup back and the waived service fee
are placeholders), referral reward amounts, minimum spend and monthly cap (default zero, so
nothing is paid), the retention period for financial records of deleted accounts (default 7
years, `FINANCIAL_RECORDS_RETENTION_YEARS`), the WhatsApp Business provider and message
templates, the price alert cadence and minimum drop (defaults every 6 hours, 5%), who reviews
flagged referrals, and whether payment providers may share card fingerprints for referral
checks. Added in phase 10: the production console host (`ADMIN_ORIGINS`) and office or VPN egress
addresses for `ADMIN_IP_ALLOWLIST`, the first super admins and who holds each staff role, the
evidence documents for regulated trust claims (IATA accreditation, traveller counts) before
anyone verifies them, and whether markup and fee changes should need a second approver like
refunds (today one `pricing:manage` holder applies them, audited). Added in phase 11: the
Sentry organisation and data region (`SENTRY_DSN` and the public DSNs), the metrics backend,
the on-call tool and who receives `page` alerts, the security contact (or turning on GitHub
private vulnerability reporting, which `SECURITY.md` points to), confirmation of the accepted
risks in ADR-048 (optional traveller MFA, Android 7 and iOS 15.1 support, no certificate
pinning), recovery objectives for database restores, the payment risk thresholds and watched
countries or routes (`PAYMENT_RISK_*`), the cookie policy text, and someone with iOS and
Android devices to run the screen reader checklist before the first store release. Added by
Cars: the maps and routing provider, the KYC provider for drivers, bus operator APIs or manual
inventory (manual by default), cash for rides (off by default), VAT on Cars fares
(`CARS_VAT_BPS`, placeholder 0), and the payout provider. Added in phase 12: the two GCP projects
with billing and the region (default `europe-west2`, London), two domains with Cloudflare zones
(Pro on production for the managed WAF; Advanced Certificate Manager for a visitor cipher
allowlist), the GitHub `staging` and `production` environments with their variables and
production reviewers, then `DEPLOY_ENABLED=true`; real adapters for SMS, WhatsApp, exchange rates,
driver KYC and payouts, without which production cannot start (they are mock-only
today); where production ClamAV runs; customer-managed encryption keys (decide before the first
production apply); name-based egress filtering (Secure Web Proxy or Cloud NGFW); a public route
for per-PR preview deploys; the App Store Connect app (`ascAppId`) and a D-U-N-S number for the
Apple organisation account; whether Suskii Prime counts as a travel service or needs in-app
purchase; Sentry's "Prevent Storing of IP Addresses" setting; and confirmation of the privacy
form answers in `docs/release/data-safety.md`. Added in phase 13: an Anthropic API key
(`LLM_API_KEY` as a repository secret, then one run of the AI search eval), the provider's data
retention terms (standard or zero data retention), whether to offer AI trip search in production,
and its daily caps (defaults $0.05 per user or address, $20 in total). Added with the Duffel Stays
adapter: Stays access on the Duffel account, a sandbox token and one sandbox run of the checks in
ADR-062 (error codes, radius unit, quote lifetime, duplicate bookings). The Duffel sandbox
workflow runs them with the `DUFFEL_API_TOKEN` repository secret. Flights pass, including two
travellers booking from one shared search. Stays still needs access. Added with online flight
cancellation (ADR-064): an optional cancellation service fee on top of the airline's terms,
what to do when the airline refunds as credits (support today), and whether staff need a console
action for supplier cancellations. Added with airline schedule changes (ADR-065): whether to
check more often close to departure, a console view and actions for changes, and Duffel webhooks
for faster detection. Added with the redesign and sign-in work (ADR-066 to ADR-068): Google OAuth
client ids (web client for the website and the app's relay) and the Apple Services ID and App ID
for real Google and Apple sign-in; confirmation of the derived brand shades and a vector logo for
sharper small icons; and a staging environment to replace the hosted test server. Added with
partner supply (ADR-069 to ADR-071): a Hotelbeds account (evaluation key, then certification and
the live key); Viator Partner API Basic Access (API key and campaign); a Travelpayouts account
with DiscoverCars, Localrent, Economybookings, GetTransfer, Kiwitaxi, Airalo and EKTA connected
(token, marker, project id) and the postback URL with its macros; whether to show partner offers
in production; and IATA accreditation or a consolidator for Nigerian domestic airlines. While
rides and the own fleet stay off (ADR-069), the KYC, maps and payout provider questions are no
longer blocking. Added with all-in prices (ADR-072): the tax rates, bases and registration number per
country from the accountant (nothing is seeded), and which entity sells in each market
(`TAX_SELLER_COUNTRY`). Added with the refund offer (ADR-073): one Duffel sandbox run with an
airline change, to confirm Duffel quotes the full involuntary refund. Added with payment methods
(ADR-074): one sandbox payment per method with Paystack and Flutterwave test keys (to confirm the
channel names), whether Apple Pay is enabled on the Paystack account, Flutterwave's "Enable
Dashboard Payment Options" turned off, and whether to apply for long-lived transfer accounts for
agent payments. Added with fast on slow 3G (ADR-075): one check on a real mid-range Android phone
on slow mobile data, through the hosted test server, to compare with the emulated numbers. Added
with languages (ADR-076): a native speaker's review of each catalog (French, Swahili, Arabic,
Portuguese), booking, payment and refund wording first; whether emails, texts and PDFs should
follow the traveller's language next; and language-prefixed URLs with `hreflang` if search
traffic in these languages matters. Added with verified reviews (ADR-077): who moderates reviews
(content managers and support hold `reviews:moderate`), the review window (default 90 days),
whether Suskii may answer reviews publicly, and whether invitations should also go by WhatsApp
once a provider is chosen. Added with company accounts (ADR-078): whether to offer a company wallet
(prepaid funds) and invoiced credit with limits, negotiated rates or a corporate fee for
companies, and who at Suskii supports company admins. Added with ads with consent (ADR-079):
the Meta pixel id and a Conversions API token, the TikTok pixel code and an Events API token
(then `AD_CONVERSIONS=meta,tiktok`), the cookie policy text, and whether to run app install
campaigns (an SDK or measurement partner and a consent screen in the app). Added with metasearch
(ADR-081): which engines to join first (Google Flights, Skyscanner, KAYAK, Wego) and their
agreements and specifications, the limits per partner from the supplier's look-to-book terms, and
whether metasearch traffic should get its own prices (a sealed sales channel, not built). Added
with Prime per country (ADR-082): the Prime price for each market (the demo plan's Ghana price is
a placeholder). Added with support conversations (ADR-083): who staffs support and on which hours
(the homepage promises 24/7 human support), the reply and resolution targets per priority
(`SUPPORT_SLA`, defaults 15 minutes and 4 hours urgent, 30 minutes and 8 hours Prime, 2 hours and
24 hours otherwise), which Prime plans include priority support, and whether support may answer
by phone or WhatsApp outside the conversation. Added with WhatsApp support (ADR-084): the Meta
business portfolio, a WhatsApp Business Account and number, a system user's permanent token, the
app secret and a verify token (then `WHATSAPP_SUPPORT_PROVIDER=cloud`), the approved
`support_reply_waiting` template, the privacy policy naming Meta as the Cloud API host,
confirmation of Meta's per-message prices for the markets served, and one sandbox message from a
username user to confirm the field for replying to a business-scoped user id. Added with the
after-hours assistant (ADR-085): the staffed hours (`SUPPORT_HOURS`, `SUPPORT_TIME_ZONE`), whether
the assistant should answer in production (`SUPPORT_ASSISTANT_ENABLED`), one run of the
assistant eval against the model with `LLM_API_KEY`, its spend caps (defaults $5 a day and 2 cents
per conversation), and the help-centre FAQs it answers from (three are seeded today). Added with
Expedia Rapid (ADR-086): an Expedia Partner Solutions account with sandbox credentials
(`EXPEDIA_RAPID_API_KEY` and `EXPEDIA_RAPID_SHARED_SECRET` as repository secrets, then one run of
`partner-sandbox.yml`), confirmation of the commercial model (Expedia Collect rates resold under
`affiliate_collect`, invoiced to Suskii) and the billing contact Expedia expects, the point of sale
per market, and Expedia's certification before `expedia` is enabled in production. Added with
the accessibility audit (ADR-088): someone with iOS and Android devices to run the screen reader
checklist (including landscape and the largest text size), the support contact and legal text for
an accessibility statement page, and whether to commission an external audit before launch in
the EU.
