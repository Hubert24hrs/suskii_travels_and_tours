# Phase 8: Packages, tours, visa and add-ons

Status: done, awaiting review

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
  vertical with its documents offline. (Planned as web-only, the visa application flow and
  add-ons for a trip were built in the app too; see the outcome.)

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

## Outcome

### Acceptance criteria

1. **Each vertical bookable end to end with mock payment.**
   - API e2e (`test/inhouse.e2e-spec.ts`, 11 tests): a package, a tour, visa assistance and an
     add-on are quoted, booked, paid through the mock provider's signed webhook and confirmed,
     with vouchers or visa applications created in the confirming transaction; seats are reserved
     at booking, sold at confirmation and released on expiry, failure or cancellation (including
     two buyers racing for the last places, where one gets 409 `sold-out`); cancellation under
     the policy refunds the tier's share and keeps the fee; package reservations run to the
     balance-due date; the catalog price is re-checked before payment.
   - Web Playwright (`e2e/inhouse.spec.ts`, 4 journeys): a package from the catalog to its voucher
     PDF and a 100% refund under the policy; a tour, then insurance attached from the trip page;
     a standalone airport transfer with its flight and pickup details; visa assistance from the
     checker to uploaded documents and submission. Every page on the way is axe-checked, and the
     new catalog, visa and add-on pages are in the hydration check.
   - Mobile Jest: package and tour lists and detail pages to the quote, checkout for package and
     tour quotes, the trip screen (voucher with its QR code, cancellation, visa applications,
     extras), the visa application screen (picker upload, view link, submit) and extras for a
     trip.
2. **Visa documents encrypted and only accessible via signed URLs by owner and visa officer.**
   - Each document is encrypted with its own AES-256-GCM key (the document id is the additional
     data), and that key is wrapped by `FieldEncryption` with the record-bound context
     `visa-document:{id}`; the file name is encrypted too. `document-crypto.spec.ts` shows the
     ciphertext hides the plaintext, keys and IVs never repeat, and a blob moved to another
     document or tampered with does not open; the API e2e reads the stored object and checks it
     is not the upload.
   - Files are sniffed (PDF, JPEG, PNG), size-limited, virus-scanned (ClamAV adapter, mock in
     development and CI; EICAR is refused) and usable only when clean.
   - Content is served only through HMAC-signed links bound to the document, the expiry and the
     viewer (`c.{bookingId}` for the owner, `s.{userId}` for an officer), valid five minutes. The
     API e2e checks the owner's link serves the exact bytes as an attachment (`nosniff`,
     `no-store`, sandbox CSP); a changed signature, expiry or viewer answers 404; another
     traveller cannot mint a link (404); staff without `visa:process` cannot either (403); a
     visa officer (MFA staff session) gets an own link. The web journey checks a tampered link
     answers 404. Every link and access is audited; files are wiped after the retention period.

### CI

Green on commit ab2c63b: CI run 37312950144 (lint, typecheck, unit tests, builds, API and web
e2e) and Mobile run 37312953375 (release APK with the new document picker module through the
Maestro critical path and offline flow on an Android emulator, and the iOS simulator build).

### Deviations from the plan

- **Mobile went further than planned.** The app uploads visa documents from the system picker
  (`expo-document-picker`, a new native module; the picker copy is deleted once read) and buys
  extras for a trip, instead of sending travellers to the website. Maestro does not drive the
  system file picker, so uploads on the device are covered by Jest (the raw bytes reach the API;
  React Native sends typed arrays as base64 to the native layer) and not by the emulator flow.
- **QR on the phone**: the app draws the tour voucher QR code from the offline booking copy
  (`uqr`, the encoder the API uses), so it works without a connection.
- **Country names on Hermes** need `Intl.DisplayNames`; the app now loads the formatjs polyfill
  (with a polyfill test), per the repository rule for new `Intl` APIs.
- **Add-on quotes name their trip**: the payload keeps the linked booking's reference (found by
  the web journey; the API test now expects it).
- **No admin screens** yet: catalog management, visa officer work and voucher redemption are API
  routes (`catalog:manage`, `visa:process`, `bookings:manage`); the console is phase 10.
- **Seat selection** stays deferred (no supplier seat maps); extra baggage stays a flight
  ancillary at flight checkout.
- Next.js 16 writes its own `AGENTS.md` and `CLAUDE.md` during `next dev`; `agentRules` is off in
  both Next apps so the root guide stays the only one.

### Decisions needed from the owner

- Real inventory and who enters it: packages and tours (itineraries, inclusions, capacity,
  per-person prices, cancellation tiers), visa products and eligibility rules (and the visa
  team's process), and add-on providers (insurer, eSIM, transfer and lounge partners). Selling
  insurance may require a licensed partner.
- Package balance-due period (`PACKAGE_BALANCE_DUE_DAYS`, default 30 days) and visa document
  retention (`VISA_DOCUMENT_RETENTION_DAYS`, default 90 days after closing).
- Antivirus in production: a managed ClamAV (about 1 GB of memory) or a scanning service.
- Operations: who fulfils packages, redeems vouchers at tours, and staffs the visa officer role.
