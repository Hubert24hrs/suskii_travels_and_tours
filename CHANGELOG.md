# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow the delivery phases in
`PROJECT_SPEC.json` until the first production release.

## [Unreleased]

### Phase 9: Accounts, Suskii Prime, referrals and notifications (2026-10-05)

#### Added

- Data rights (ADR-029): a registry gives every database model an export section and a deletion
  treatment, and a test fails when a model is missing. `POST /v1/me/data-export` returns one JSON
  document after re-authentication (password, a texted code or a recent sign-in, plus MFA).
  `GET/POST /v1/me/deletion` lists blockers (trips, payments, refunds, visa work, wallet
  balance, staff roles), then anonymises the account: profile, identities, sessions, factors,
  travellers, tokens, preferences, alerts and referral codes go; bookings, payments, refunds and
  ledger entries stay as financial records without contact details or passport numbers
  (`FINANCIAL_RECORDS_RETENTION_YEARS`). Deleted accounts can never be emailed.
- Account preferences and notification settings (`/v1/me/preferences`,
  `/v1/me/notification-preferences`): language, currency, home airport, marketing consent with
  its source, and a category-by-channel matrix in which booking and payment email cannot be
  turned off.
- Suskii Prime (ADR-030): plans per currency managed at `/v1/admin/prime/plans`
  (`pricing:manage`, audited; none in production, a sample plan in `db:seed:demo`); public
  `GET /v1/prime/plans` and `GET /v1/me/prime`. A membership is the in-house item `membership`
  (vertical `prime`) on the one booking pipeline; confirmation starts or extends the term.
  Members price as tier `prime`: a share of the markup back (never below supplier cost) and
  waived fees by code, shown as `memberSaving`. The tier travels in the access token and is
  re-read from the database for quotes, bookings and the payment re-check.
- Referrals (ADR-031): a code per account, attribution at registration or phone sign-up,
  qualification on the referee's first completed trip, then wallet credits through the ledger
  (`referral_reward`, `expense:promotions`). Rewards default to zero. Fraud signals (an alias of
  the referrer's email, the referrer's own network, a network or device shared with other recent
  referrals, disposable email domains, the monthly cap) send a referral to staff review
  (`/v1/admin/referrals`) instead of paying it.
- Notifications (ADR-032): `NotificationService` sends by category over email, SMS, WhatsApp
  (new `WhatsAppProvider`, mock adapter) and push as each account allows, and logs every attempt
  with a skip reason. New: check-in reminders, Prime expiry reminders, referral reward messages.
- Price alerts (ADR-032): `GET/POST/DELETE /v1/me/price-alerts` (up to 10, a date or a month,
  optional target); the worker sweeps them through `/internal/price-alerts/run`, pricing for the
  owner (Prime included) and notifying on a drop at most once a day. Worker sweeps for alerts,
  reminders and referrals.
- Web: sign-in (email and password, phone code, MFA), registration with a referral code, email
  verification, password reset and the account area (profile, notifications, trips, travellers,
  password, authenticator MFA with recovery codes, devices, Prime, invitations, price alerts,
  wallet, your data with export and deletion). Cookie sessions send the CSRF token on writes and
  refresh once across tabs with a Web Lock. `/prime` with live plan prices and joining through
  the normal checkout; booking pages show the membership term; "Watch this route" on flight
  results; Sign in / Account in the header; the homepage Prime block shows live prices.
- Mobile: phone-code sign-in next to email, an invite code on registration (prefilled from a
  `?ref=` link), the account hub with profile, notifications, devices, invitations (system share
  sheet), price alerts and your data (export through the share sheet with the cache copy deleted,
  in-app account deletion). The Prime tab shows plans, the member's term and joining with the
  hosted payment; trip screens show the membership; "Watch this route" on flight results.
  Notification taps can open Prime, the account, alerts and invitations.
- Tests: API unit tests for Prime pricing (including a property test that members never pay
  below supplier cost), the notification matrix, referral rules and alert triggers; API e2e for
  accounts, export and deletion, Prime purchase and member prices, notifications, alerts,
  referrals and reminders; web Playwright for registration, sign-in, notifications, Prime
  purchase, export and deletion; mobile Jest for sign-in, account screens, Prime, invitations,
  alerts and the membership trip (105 tests).

#### Changed

- Prime purchases are left out of the Trips lists; the Prime screens show them.
- The ui-native `ToastProvider` clears pending dismiss timers on unmount; `Card` takes a
  `testID`.

#### Not built yet

- Card fingerprints for referral checks (providers do not report them to us yet), saved payment
  methods and automatic renewal (stored-card mandates, ADR-018), Google and Apple sign-in buttons
  (owner OAuth client ids), the admin screens (phase 10) and schedule-change notices (supplier
  order webhooks).

### Phase 8: Packages, tours, visa and add-ons (2026-10-05)

#### Added

- In-house catalog (ADR-025): packages and tours with dated departures, capacity, per-person
  prices by traveller type, itineraries, inclusions and cancellation tiers; add-ons (insurance,
  airport transfers, eSIM, lounge) priced per person, booking or day; visa assistance products
  with document checklists; visa eligibility rules. Public list and detail routes, admin CRUD and
  publishing (`catalog:manage`, audited) and `POST /v1/inhouse-quotes`. Production starts empty;
  `db:seed:demo` (refused in production) adds sample inventory with a "Sample" badge.
- One booking pipeline for every vertical: in-house items reuse quotes, bookings, payments,
  the ledger, payment plans and refunds. Seats are reserved at booking with a conditional update
  (no overselling), sold at confirmation and released on expiry, failure or cancellation; the
  price is re-checked against the catalog before payment; packages can be reserved or paid in
  installments until the balance-due date (`PACKAGE_BALANCE_DUE_DAYS`).
- Fulfilment in the confirming transaction (ADR-028): voucher codes (no look-alike characters,
  stored hashed and encrypted) with QR codes on the PDFs and a one-time redemption route for
  operations; visa applications per applicant. Self-service cancellation under the policy tiers
  (fee to the ledger, automatic refund of the tier's share).
- Visa assistance (ADR-026): eligibility answers from the rules table (`unknown` without a rule,
  never a guess); one application per applicant with checklist uploads sniffed by content,
  size-limited, encrypted with per-document keys wrapped by `FieldEncryption`, virus-scanned
  (ClamAV adapter, `docker compose --profile av`; mock in development) and readable only
  through five-minute HMAC-signed links for the owner or a visa officer, every link and access
  audited; officer routes for review, requests, decisions and messages; visa update emails;
  document retention. Worker jobs rescan missed uploads and delete expired documents.
- Add-ons (ADR-027) standalone or linked to a trip, found from the booking page or by reference
  and last name (short-lived HMAC link tokens); transfer details encrypted per booking item.
- Web: `/packages` and `/tours` with results or popular products, detail pages with dates,
  traveller picker and policy; `/visa` with the eligibility answer and products, `/visa/[slug]`
  with the checklist and booking form; `/travel-add-ons` standalone, for a booking or by
  reference; checkout and booking pages for every vertical (voucher, cancellation, visa
  applications, extras); the visa application page with uploads, scan status, signed views and
  submission. Homepage teaser with real from-prices; non-sample products in the sitemap.
- Mobile: packages and tours on Home, lists and detail pages, checkout for in-house quotes, trip
  screens for every vertical with the voucher QR code drawn offline, cancellation under the
  policy, visa applications with uploads from the document picker, and extras for a trip.
- `@suskii/shared`: cancellation tiers and refunds, per-person totals, add-on units, voucher codes,
  document sniffing, in-house checkout facts and traveller drafts. `@suskii/i18n`: country names
  (`format.country`) and the copy for every new page, PDF and email.
- Tests: API unit and e2e for every vertical, the seat race, cancellation, signed document
  access and scanning; web Playwright journeys for packages, tours with linked add-ons,
  standalone add-ons and visa assistance; mobile Jest for the catalog, checkout, trips, visa
  uploads and extras (80 tests).

#### Changed

- Checkout asks for passports only where the product needs them (abroad, visa applicants);
  hold and installment wording follows the product.
- The app loads the formatjs `DisplayNames` polyfill for country names on Hermes.
- `next dev` no longer writes its own agent guides (`agentRules: false`).

### Phase 7: Mobile app (2026-09-30)

#### Added

- Expo app (`apps/mobile`, Expo Router, typed routes) on the shared API client, schemas, design
  tokens and copy (ADR-020): Home, Trips, Deals, Prime and Account tabs; flight search (one way,
  return, multi-city) and hotel search; results with FlashList, sort and filters, price-change
  and expiry handling; hotel rooms; checkout with travellers, passports, contact details,
  terms, payment plan and method; trip details with status polling, plan payments, refunds and
  documents; email sign-in with MFA and registration. The Prime tab previews the membership
  without prices.
- Payments open the provider's hosted page in the system browser (Custom Tabs or
  ASWebAuthenticationSession, never a WebView) and return through
  `WEB_APP_URL/mobile/payment-return`, which hands control back to the app (ADR-021). Webhooks
  stay the source of truth; the trip screen polls.
- Offline: trips and booking copies in an AES-256 MMKV cache keyed from the secure store,
  e-tickets and vouchers saved to app-private storage and opened through the share sheet. Tokens
  and guest booking tokens live in the Keychain / Keystore; Android backups are off. Sensitive
  screens block screenshots, blur the iOS app switcher and clear passport numbers after five
  minutes in the background.
- Deep links through an allowlist (`+native-intent`): emailed booking links (the `#access=` token
  goes to the secure store, never the router), search links re-validated with the shared
  schemas, app-scheme paths; everything else opens Home. App links and associated domains for
  the https website host.
- API: `GET /v1/me/bookings` (trip summaries, cursor pages); push tokens per account session or
  booking with Expo and mock providers and reference-only lock-screen text (ADR-022); single-use
  attestation challenges, the `X-Suskii-Attestation` header, a verifier interface with a mock
  adapter, attestation as the mobile guest bot check, and `ATTESTATION_MODE` (off, report,
  enforce) for mobile login, registration and payment start (ADR-023).
- Web: `/.well-known/assetlinks.json` and `apple-app-site-association` from environment values,
  and the app's payment return page. Worker: daily push token pruning.
- App variants (development, preview, production, e2e) in `app.config.ts`, EAS profiles with
  named environments and fingerprint runtime versions, and the EAS release workflow (on demand,
  and production for `mobile-v*` tags) gated on the owner's Expo account (ADR-024).
- Bundle secret scanner (`apps/mobile/scripts/scan-bundle.mjs`) with a planted-secret self-test,
  run on the exported bundle in CI, on the release APK (with Gitleaks) and the iOS app in the
  mobile workflow, and before EAS builds.
- Mobile workflow: Android release APK driven through the Maestro critical path (search, guest
  checkout with mock attestation enforced, hosted payment, confirmed trip, e-ticket saved, then
  opened offline) on an API 34 emulator against the e2e stack; unsigned iOS simulator build.
- Tests: 63 mobile Jest tests (link allowlist, attestation headers, single-flight refresh and the
  401 retry, trip storage, payment outcomes, home, checkout, trip and trips screens), shared
  checkout-draft tests, API unit and e2e tests for trips, push tokens and attestation, and web
  e2e for the association files and the return page.

#### Changed

- The checkout draft, its client-side checks and itinerary facts moved from the web app to
  `@suskii/shared` so the web and the app validate the same way.
- The ui-native `Combobox` takes a `testID` for its field and suggestions.
- The app loads `Intl` polyfills (formatjs `PluralRules`, `RelativeTimeFormat`, `ListFormat`,
  `Locale`, with en, en-GB and en-NG data) before any other module, because Hermes lacks them
  and the translator failed at start-up; `@suskii/i18n` formats date ranges without
  `formatRange` where the engine has none.
- The mobile app depends on `@babel/plugin-transform-react-jsx` directly: NativeWind's Babel
  preset names it without depending on it, and Babel resolves it from the app's
  `babel.config.js`, so the Android release bundle failed on a clean install.
- `.env.example` documents the mobile build settings and the app-link values.

### Phase 6: Payments, flexible payment and refunds (2026-09-30)

#### Added

- Payment providers behind one interface (ADR-016): Paystack, Flutterwave (v3) and Stripe
  Checkout, all hosted (SAQ-A), plus the mock provider. `PAYMENT_PROVIDERS` enables several at
  once, in preference order; the checkout offers those that settle the booking currency. Webhook
  signatures are checked over the raw body (HMAC-SHA512, `verif-hash`, `t=,v1=` with a 5-minute
  tolerance), Paystack and Flutterwave outcomes are confirmed server to server before they count,
  and pending payments whose webhook never arrived are reconciled with the provider.
- Double-entry ledger (ADR-017): accounts for the provider, each booking, unapplied money, wallets,
  refunds in flight and kept fees. The database enforces append-only entries, balanced
  transactions per currency at commit and non-negative customer balances; every posting is
  idempotent by a business key. `GET /v1/me/wallet` shows the balance and history.
- Reserve now, pay later and installments for flights (ADR-018): `POST /v1/bookings/{id}/hold` and
  `/installment-plan`, offered only when the airline hold (and, for installments, the price
  guarantee) covers the whole plan and never with paid extras. Deposit, equal installments,
  optional fee and a missed-payment policy (refund minus a basis-point fee); reminders 3 days and
  1 day before each due date by email and SMS with an expiring access link; defaults after the
  grace period; unpaid holds released at the deadline; at most two active holds per traveller.
  Mock supplier holds and Duffel `pay_later` orders (`air/payments`, order cancellations).
- Refunds (ADR-019): automatic refunds for money a booking cannot take, failed ticketing and plan
  defaults or cancellations; staff refunds through the admin API (`/v1/admin/refunds`: request,
  approve, reject, resolve) with maker-checker above `REFUND_APPROVAL_THRESHOLD_NGN` (default:
  always). Refunds go to the original method or the wallet, never exceed what was paid, settle by
  webhook or polling, and ambiguous calls to providers without idempotency keys go to review
  instead of being re-sent. Customers and operations (`OPS_ALERT_EMAIL`) are notified.
- Payments from the wallet (whole amount, one transaction), payment start with `provider`,
  `installmentId`, `payInFull` and `useWallet`, and payment options on quotes and bookings.
- Worker: payment reconciliation, plan reminders and defaults, and refund execution every minute.
- Web: checkout offers pay now, reserve and pay later, or installments with the full schedule, fee,
  total and missed-payment policy before commitment, and a payment method choice when several
  providers take the currency. The booking page shows the plan, pays the next installment or the
  rest, pays from the wallet, cancels under the plan's policy, lists refunds and their state, and
  opens from emailed links (the token in the URL fragment moves to session storage).
- Shared: installment schedule and refund policy maths with property tests; plan, provider and
  refund constants.
- Tests: provider signatures, payload mapping and amounts; ledger invariants (balanced,
  idempotent, non-negative under concurrency, append-only); the grown state machine matrix; API
  e2e for the three acceptance criteria, Paystack end to end against a fake server, lost webhooks,
  holds, installments with reminders, defaults, cancellation refunds, hold limits, maker-checker
  and wallet refunds; Playwright for reserve-and-pay-later and installments to a refunded
  cancellation.

#### Changed

- `PAYMENT_PROVIDERS` (list) replaces `PAYMENT_PROVIDER`.
- A success for the wrong amount, or money arriving for a booking that cannot take it, is refunded
  automatically instead of only being flagged; exhausted ticketing ends REFUNDED once the refund
  settles.
- State machine: `partial_payment` from HELD, `default` (PARTIALLY_PAID to REFUND_PENDING) and
  `cancel` from PARTIALLY_PAID.
- The booking page shows the total price and, separately, what has been paid.

#### Fixed

- The web error boundary imported the whole message catalog, which shipped with every page; it
  now receives only its own copy from the root layout (homepage JavaScript 216.7 kB to 200.9 kB
  gzip) and follows the visitor's locale.

### Phase 5: Flight and hotel booking flow (2026-09-29)

#### Added

- Web booking flow on live API data. Flight and hotel results with filters and sort in the URL
  (stops, airlines, departure time, price, journey time, refundable, checked bag; stars, rating,
  free cancellation, amenities, area, meals), facets with prices, load more, fare details with
  layover warnings and conditions, and expired-results recovery; a hotel page with every rate,
  board, cancellation terms and charges paid at the hotel.
- Checkout: travellers with a passport-form name preview, passports (required abroad), extra
  bags, contact details, promo code, terms consent and Turnstile for guests. The price is checked
  with the supplier right before payment; a change opens a consent dialog with the previous and
  new totals and the difference.
- Mock payment provider with a hosted page on the web app and HMAC-signed webhooks through the
  real webhook pipeline; booking page that polls until confirmed, then shows the itinerary or
  stay, ticket numbers or confirmation number, price paid and PDF downloads.
- API: `POST /v1/bookings` (idempotent), `GET /v1/bookings/{id}` (owner or `X-Booking-Token`, 404
  otherwise), payments with the price re-check (409 `price-changed`), price consent, cancel,
  document download, `GET /v1/quotes/{id}`, payment webhooks, mock checkout endpoints, saved
  travellers (`/v1/me/travellers`) and worker routes for expiry and ticketing (ADR-014, ADR-015).
- Booking state machine with the spec's 13 statuses; every transition is guarded, recorded in
  `booking_status_history` and audited in the same transaction (all state x event pairs tested).
- Migration 4: bookings, items, passengers, status history (append-only), saved travellers,
  payments, webhook events and documents. Contact details and passport numbers are encrypted with
  record-bound contexts and only returned masked; guest access tokens are stored as HMACs.
- Supplier booking: `book()` for flights (mock, Duffel orders) and hotels (mock), idempotent by
  booking item id, extra baggage services on mock offers. Ticketing retries transient failures
  with backoff (1, 2, 4, 8, 16 minutes) and moves exhausted or ambiguous cases to REFUND_PENDING.
- E-ticket and hotel voucher PDFs (pdf-lib, QR code of the reference) in private object storage
  (filesystem adapter for development) and the confirmation email with the PDF attached.
- Worker: a bookings queue expires unpaid bookings and runs due ticketing attempts every minute.
- Shared: passenger and contact schemas, transliteration of accented names, age and passport
  rules against the itinerary, booking constants.
- Tests: state machine matrix, passenger rules, PDFs, mock payment signatures, Duffel orders,
  worker jobs; API e2e for full flight and hotel flows, price consent, webhooks (signature,
  duplicates, amount mismatch, refund flags), ownership, idempotency, retries, exhaustion and
  expiry; Playwright for search to confirmation, the price-change consent path, hotels to voucher
  and phone layouts, all axe-checked.

#### Changed

- Stored idempotent responses are encrypted, since they can carry a guest booking token.
- `MOCK_REPRICE_RULES` apply once, at the re-price right before payment.
- Hotel results gain an area filter and facet; hotel quotes keep the supplier query.
- The generated API client keeps defaulted request fields optional.
- Checkout, payment and booking pages are noindex and disallowed in robots.txt.

#### Fixed

- Pre-filled search pages (flights, hotels, packages, tours, visa) no longer fail hydration when
  the browser's ICU/CLDR data formats dates differently from Node's: field values and select
  labels keep the server's text, and the packages month list starts from the UTC month until
  hydrated. A Playwright test alters the browser's `Intl` output to guard every such page.

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
