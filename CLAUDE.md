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

| Phase | Name                                             | Status      |
| ----- | ------------------------------------------------ | ----------- |
| 0     | Foundation and repo bootstrap                    | Done        |
| 1     | Design tokens and component libraries            | Done        |
| 2     | Backend core                                     | Done        |
| 3     | Search, catalog and supplier adapters            | Done        |
| 4     | Web homepage                                     | Done        |
| 5     | Flight and hotel booking flow (web)              | Done        |
| 6     | Payments, flexible payment and refunds           | Done        |
| 7     | Mobile app                                       | Done        |
| 8     | Packages, tours, visa and add-ons                | Done        |
| 9     | Accounts, Suskii Prime, referrals, notifications | Done        |
| 10    | Admin console                                    | Done        |
| 11    | Hardening                                        | Not started |
| 12    | Deployment and release                           | Not started |
| 13    | Optional: AI trip search                         | Not started |

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
infra/        Terraform + Helm (phase 12). Local infra lives in the root docker-compose.yml
docs/         decisions/ (ADRs), phases/ (phase plans), runbooks and security docs later
```

## Commands

Run from the repo root. All scripts are cross-platform (PowerShell, bash, zsh).

| Command                                           | What it does                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm install`                                    | Install all workspaces (pnpm 10.33, Node 24 LTS >= 24.9 enforced)   |
| `pnpm infra:up`                                   | `docker compose up -d --wait` (Postgres 16, Redis 7, Mailpit)       |
| `pnpm infra:down`                                 | Stop local infra (data kept in named volumes)                       |
| `pnpm dev`                                        | Run every app in watch mode through Turborepo                       |
| `pnpm build`                                      | Build every workspace (dependencies first)                          |
| `pnpm lint`                                       | ESLint (type-aware) in every workspace                              |
| `pnpm typecheck`                                  | `tsc --noEmit` in every workspace                                   |
| `pnpm test`                                       | Unit tests (Vitest; Vitest browser for ui-web; Jest for API/native) |
| `pnpm build:storybook`                            | Static Storybook for ui-web                                         |
| `pnpm --filter @suskii/ui-web dev`                | Storybook dev server on port 6006                                   |
| `pnpm test:e2e`                                   | API, web and admin e2e suites, one after the other (Docker or URLs) |
| `pnpm --filter @suskii/web test:e2e`              | Web e2e + Lighthouse against built web, API and worker (see notes)  |
| `pnpm --filter @suskii/admin test:e2e`            | Admin e2e: staff journeys, audit log, axe (built admin and API)     |
| `pnpm --filter @suskii/web lighthouse [url]`      | Lighthouse gate on a running site (median of `LIGHTHOUSE_RUNS`)     |
| `pnpm --filter @suskii/web check:classes`         | Fail if a Tailwind class used in web/ui-web generates no CSS        |
| `pnpm --filter @suskii/worker refresh:once`       | Refresh every deal route and destination once (API must run)        |
| `pnpm generate:api`                               | Rebuild `apps/api/openapi.json` and the api-client schema           |
| `pnpm --filter @suskii/api db:deploy` / `db:seed` | Apply migrations / seed reference data (idempotent)                 |
| `pnpm --filter @suskii/api db:migrate`            | Create a migration after editing `prisma/schema.prisma`             |
| `pnpm --filter @suskii/api db:seed:demo`          | Sample packages, tours, add-ons and visa data (refused in prod)     |
| `docker compose --profile av up -d clamav`        | ClamAV for real scans (`ANTIVIRUS_PROVIDER=clamav`, about 1 GB)     |
| `pnpm --filter @suskii/api keys:generate`         | Print fresh JWT keys, encryption key and HMAC secret                |
| `pnpm --filter @suskii/api data:build`            | Refresh `prisma/data` from OurAirports (review the diff)            |
| `pnpm --filter @suskii/api airlines:sync`         | Upsert airlines from Duffel (needs `DUFFEL_API_TOKEN`)              |
| `pnpm --filter @suskii/mobile android`            | Build and run the development build on an Android emulator          |
| `pnpm --filter @suskii/mobile scan:bundle dist`   | Secret scan of the mobile export (`--self-test` checks the scanner) |
| `pnpm --filter @suskii/web e2e:stack`             | Run the e2e stack (API, worker refresh, web) for Maestro flows      |
| `pnpm format` / `format:check`                    | Prettier write / check                                              |
| `pnpm --filter @suskii/api dev`                   | Run a single workspace                                              |

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
- Binary responses (PDFs) use `fileResponse()` in the contract and return a `StreamableFile`.
  Stored idempotent responses are encrypted (they can contain guest tokens).

### Payments, ledger, plans and refunds (apps/api, ADR-016 to ADR-019)

- Providers implement `PaymentProvider` in `src/payments/<vendor>`: hosted checkout only, webhook
  signature over the raw body, `verify()` against the provider before an outcome counts (Paystack,
  Flutterwave), refunds with an idempotency key where the provider supports one. `PaymentProviders`
  routes by currency in `PAYMENT_PROVIDERS` order. Vendor payloads never leave the adapter; parse
  provider amounts with `parseMoney`, never floats.
- Every money movement is a `LedgerService.post()` in the caller's transaction with a business
  idempotency key (`payment:{id}:captured`, ...). Never write ledger tables or balances directly;
  the database rejects unbalanced, negative-customer or updated entries. What a booking has paid is
  its ledger balance (`BookingFundsService.paid`), not a sum of payments.
- Reconciliation and other non-webhook confirmations go through the webhook pipeline with a
  synthetic event id (`reconcile:{reference}:{status}`), so dedupe and postings stay in one place.
- Plans: `PaymentPlansService` creates holds and installment plans (flights with supplier holds,
  no paid extras) and closes them (cancel, default, expiry) under the plan's policy. Amounts,
  deposit, fees and grace come from config; never hard-code them.
- Refunds: `RefundsService.createAutomatic()` for non-discretionary cases (approved at once);
  staff refunds go through the admin API with maker-checker (the requester cannot approve).
  A refund never exceeds its source balance. An ambiguous call to a provider without idempotency
  keys goes to `needs_review`, never a blind retry. `finalizeBooking` moves REFUND_PENDING to
  REFUNDED when nothing is left and no refund is open.
- Emailed booking links carry a guest token in the URL fragment (`#access=`), stored as an HMAC
  (`BookingAccessLinks`); the web page moves it to session storage and strips it from the URL.

### Web (apps/web)

- Pages render per request (nonce CSP, ADR-010); cache API reads through `lib/api.ts`
  (`revalidate` + tags). Never read `localStorage` during render; restore it in an effect.
- Node and browsers ship different CLDR data, so `Intl` text in a server-rendered client component
  can differ at hydration. Render it in an element with `suppressHydrationWarning` (as
  `FieldButton` and `NativeSelect` do) and switch browser-only values (the visitor's time zone)
  after `useHydrated()`. `e2e/hydration.spec.ts` alters the browser's `Intl`: add new pages there.
- Copy comes from `@suskii/i18n`: server components use `getI18n()`; client components get a
  message subset through `I18nProvider` or labels as props. E2E tests use the catalog too.
- Only the spacing scale exists (0-6, 8, 10, 12, 16, 20) plus named sizes (`max-w-page`,
  `max-w-dialog`, `max-w-popover`, `max-h-menu`). Unknown classes produce no CSS silently: run
  `check:classes` after a build.
- Keep the homepage JavaScript small (ADR-013): client code imports `@suskii/shared/lite`, loads
  schemas with `loadShared()`, opens popovers and dialogs through `useDeferredOverlay`, and puts
  heavy or rarely used code behind `lazy()`/`next/dynamic`. The e2e budget test fails above 210 kB.
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
  401, `X-Suskii-Client: mobile-<os>/<version>`); never call `fetch` directly. The refresh is
  single flight (`SessionStore`) because the API revokes a session on refresh-token reuse.
- Secrets (tokens, guest booking tokens, cache key, App Attest key id) go in `secureStorage`
  (Keychain / Keystore, this device only). Personal data kept offline goes in `secureCache()`
  (AES-256 MMKV); `preferences` holds settings only. Never use AsyncStorage for either.
- `appConfig` (`src/config.ts`) is the only reader of `EXPO_PUBLIC_*`. Those values are inlined
  in the bundle and public; a secret there fails the bundle scan.
- Incoming URLs go through `resolveIncomingUrl()` (allowlist); add a path there and in the app
  link paths in `app.config.ts`, with a test. Guest access tokens never reach the router.
- Payments: `startPayment()` then `openHostedCheckout()` (system browser session, never a
  WebView); the trip screen polls, webhooks decide. Guest checkout and payment attach
  `attestationHeader()`.
- Wrap checkout, payment and document screens in `useSensitiveScreen()`.
- Hermes implements only part of `Intl`. `src/polyfills.ts`, loaded first from `index.ts`, adds
  `PluralRules`, `RelativeTimeFormat`, `ListFormat`, `DisplayNames` and `Locale`; `@suskii/i18n` joins date
  ranges itself where `formatRange` is missing. Shared code that starts using another `Intl` API
  needs a polyfill there and a case in `polyfills.test.ts` (Jest runs on Node's full `Intl`).
- Push permission is requested only after a booking or from Account (`followBooking`,
  `followAccount`), never on launch.
- Give interactive elements used by Maestro a stable `testID` (fields: the form path, such as
  `passengers.0.surname`; choices: `{testID}-{value}`; suggestions: `{testID}-option-{key}`).
- Account screens wrap their content in `RequireAccount` and live under `app/account/*`.
  Deleting the account or signing out goes through `useAuth().forgetAccount()` / `signOut()`,
  which clear tokens, account trips and cached queries. Files with personal data (the data
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
  export section and deletion treatment (`delete`, `redact`, `retain`, `none`). A new model
  fails compilation and `data-registry.spec.ts` until it has one; add new personal data to the
  export (`DataExportService`) and to `AccountDeletionService` in the same change.
- Sensitive account actions (export, deletion) take a proof checked by `ReauthService`
  (password, texted code or a sign-in in the last 10 minutes, plus MFA). Deletion answers 409
  with `blockers` while anything is unsettled and keeps financial records without contact data.
- Members are tier `prime` only while a paid-up term runs (`currentPrime()`). The access token's
  `prm` claim is for searches; quotes, bookings and the payment re-check re-read the database
  (`withCurrentTier()`). Benefits apply in `priceOffer()` and never price below supplier cost.
- A Prime purchase is the in-house item `membership` on the booking pipeline (owner required,
  one `guests` entry, no PDF, no self-cancellation); `InhouseFulfilment` starts the term.
- Send user messages through `NotificationService.notify(userId, content)` with a category and
  per-channel renderings (`src/messaging/messages.ts`); it applies the preference matrix and
  logs each attempt. Booking and payment email are mandatory; marketing needs recorded consent.
  Push data carries only an in-app path the app allowlists (`resolveNotificationPath`).
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
  markups, fees, Prime plans) also carry `@StepUp()`: an authenticator check within
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
refunds (today one `pricing:manage` holder applies them, audited).
