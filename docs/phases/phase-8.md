# Phase 8: Packages, tours, visa and add-ons

Status: in progress (started while the phase 7 Maestro run is still being fixed in CI, at the
owner's request)

## Goal

Make the four remaining verticals bookable end to end on the shared API: holiday packages and
tours on the web and in the app, visa assistance with an eligibility checker, an application flow
and secure document handling on the web, and travel add-ons bought on their own or attached to an
existing booking.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Each vertical is bookable end to end with the mock payment provider.
2. Visa documents are encrypted and only accessible through signed URLs, by their owner and by
   visa officers.

## Scope decisions

- **Inventory is Suskii's own** (spec: "managed in-house via admin"). Packages, tours, visa
  products and add-ons live in our database and are managed through admin API routes
  (`catalog:manage`, visa rules and applications with `visa:process`). The admin console UI is
  phase 10. Production starts empty: no prices, itineraries or visa rules are invented. A demo
  seed (`db:seed:demo`, refused in production) creates clearly marked sample inventory for local
  development and the e2e suites; the UI shows a "Sample" badge on it, like sample fares (ADR-025).
- **One booking pipeline.** New verticals extend `ItemPayload` with `package`, `tour`, `visa` and
  `addon` kinds instead of adding a parallel flow: in-house quotes are `Offer` rows (supplier
  `suskii`), bookings, payments, the ledger, payment plans and refunds are reused, and the
  pre-payment price re-check reads current prices from the catalog (ADR-025).
- **Capacity** is reserved when a booking is created (a conditional update, so two buyers can
  never take the last seat), counted as sold at confirmation and released on expiry,
  cancellation, failure or refund (ADR-025).
- **Packages** bundle flights, hotel and extras described as inclusions and fulfilled by the
  operations team; the customer buys the package at a per-person price for a departure. Packages
  can be reserved with a deposit and paid in installments until a balance-due date before
  departure (`PACKAGE_BALANCE_DUE_DAYS`, owner decision).
- **Tours** have dated departures with capacity, a meeting point and cancellation rules; the
  voucher PDF carries a QR code with a random voucher code (no personal data) that operations
  redeem (ADR-028).
- **Visa**: eligibility comes from an admin-maintained rules table keyed by nationality,
  destination and purpose; without a rule the answer is "we will confirm", never a guess. Buying a
  visa product pays the assistance fee and opens one application per applicant; the traveller
  then uploads the checklist documents and submits; visa officers review, request more documents,
  record the authority's decision and write messages to the customer and internal notes. Every
  page, PDF and email carries the disclaimer that the issuing government decides (ADR-026).
- **Visa documents** (ADR-026): type sniffed from the bytes (PDF, JPEG, PNG), size limit,
  encrypted at rest with a per-document key wrapped by `FieldEncryption`, virus-scanned through an
  `AntivirusScanner` interface (ClamAV adapter, mock in development and tests), usable only once
  clean, and readable only through short-lived HMAC-signed URLs minted for the owner or a visa
  officer (staff session with MFA). Each link and each access is audited. Documents are deleted a
  set number of days after the application closes.
- **Add-ons** (ADR-027): insurance, airport transfers, eSIM and lounge access are in-house
  products bought as their own booking, optionally linked to an existing booking (found from the
  booking page or by reference and last name). Extra baggage stays an airline ancillary at flight
  checkout (phase 5); seat selection needs a supplier with seat maps and is deferred (owner
  decision). The add-ons form sends "extra baggage" to the flight booking.
- **Cancellation** of confirmed packages, tours and add-ons is self-service under the product's
  policy tiers (days before start, share refunded): an automatic refund for the policy amount and
  the seats released. Visa assistance is cancelled through support once work has started.
- **Mobile**: packages and tours can be browsed, booked and paid in the app; trips show every
  vertical with its documents offline. The visa application flow and add-ons stay on the web in
  this phase (links from the trip screen).

## Plan

### Shared (`packages/shared`, `packages/i18n`)

- Domain constants and schemas: cancellation tiers and their refund calculation (with property
  tests), per-person price tables, visa requirement kinds and application statuses, add-on types
  and pricing bases, voucher code format, document type and size rules.
- i18n catalogs for every new page, email and PDF.

### API (`apps/api`)

- Migration 8: `packages`, `package_departures`, `tours`, `tour_departures`, `addons`,
  `visa_rules`, `visa_products`, `visa_applications`, `visa_application_events`,
  `visa_documents`, `booking_vouchers`; `BookingItemType` and `BookingDocumentType` extended;
  `bookings.linked_booking_id`; capacity counters with check constraints.
- Catalog (`src/catalog-inhouse` or per vertical modules `packages`, `tours`, `visa`, `addons`):
  public list, search and detail routes; admin CRUD and publishing; quotes into `Offer` rows.
- Bookings: create for the new payload kinds (traveller rules per vertical), capacity reservation
  and release, price re-check against the catalog, in-house fulfilment (confirm, vouchers with QR,
  visa applications), cancellation under policy with an automatic refund, package payment plans.
- Visa: eligibility route; applications, uploads, submission and status for owners (session or
  guest booking token); signed document links and the public content route; officer routes
  (`visa:process`, `AdminRoute`); `AntivirusScanner` (`ClamAvScanner`, `MockAntivirusScanner`);
  scan retries and retention through internal routes.
- Vouchers: redemption route for operations (`bookings:manage`).

### Worker (`apps/worker`)

- Scan retry (every five minutes) and document retention (daily) jobs calling internal routes.

### Web (`apps/web`)

- `/packages` (search results or featured), `/packages/[slug]` (itinerary, inclusions,
  departures, travellers, book), `/tours`, `/tours/[slug]`, `/visa` (eligibility result and
  products), `/visa/[slug]`, `/travel-add-ons` (catalog, attach to a booking).
- Checkout for the new quote kinds, the booking page for every vertical (vouchers, tour QR,
  visa applications with uploads, submission, status and messages, cancellation under policy,
  linked add-ons), homepage packages and tours teaser.

### Mobile (`apps/mobile`)

- Packages and tours tabs of the search card, results, detail, checkout; trip screen for every
  vertical.

### Infra

- `docker-compose.yml`: optional ClamAV service (`--profile av`); `.env.example` entries.

## Tests

- Unit: cancellation tiers and refunds, per-person pricing, capacity reservation races, document
  sniffing and encryption round trip, signed URL verification (expiry, tampering, viewer), mock
  scanner, eligibility lookup.
- API e2e: each vertical searched, quoted, booked and paid with the mock provider to CONFIRMED;
  capacity exhaustion and release; visa upload, scan (clean and EICAR), submission, officer review;
  document access matrix (owner, other customer, guest with and without token, visa officer,
  other staff, expired or tampered link); ciphertext at rest differs from the upload.
- Web Playwright: package, tour, visa and add-on journeys through the mock payment page.
- Mobile Jest: package and tour screens.

## Risks and mitigations

- **Scope**: four verticals across three clients. Mitigation: one pipeline (new payload kinds),
  shared screens for checkout and booking, admin UI deferred to phase 10.
- **Overselling**: concurrent bookings of the last seats. Mitigation: conditional updates with a
  check constraint; a race test.
- **Malicious uploads**: mitigated by sniffing, size limits, scanning before use, no inline
  rendering (attachment, `nosniff`, sandbox CSP) and encryption at rest.
- **Invented facts**: visa rules and prices are real-world facts. Mitigation: nothing is seeded in
  production; demo data is flagged and badged.
