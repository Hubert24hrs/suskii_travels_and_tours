# Cars: buses, rides and car rental

Status: in progress (P0 to P3 done)

Task: `suskii-cars-v1`. It adds three ground-transport products, together called **Cars**:

- **(A) Interstate buses:** seat selection, 10-minute holds and signed QR tickets.
- **(B) Intrastate rides:** on-demand and scheduled, with vetted drivers, live tracking, PIN,
  share link and SOS.
- **(C) Car rental:** self-drive or chauffeured, with deposits and handover records.

The task then audits the whole platform end to end. Cars sits outside the `PROJECT_SPEC.json`
phase numbering: phase 12 (deployment) has not started, and Cars does not depend on it. Its
sub-phases are numbered P0 to P11.

## Orientation notes

- **One booking pipeline.** Packages, tours, visa, add-ons and Prime are in-house `ItemPayload`
  kinds (`apps/api/src/bookings/inhouse-items.ts`), quoted as `Offer` rows with supplier
  `suskii` by `InhouseQuotesService`. Bookings go through `BookingsService.create` →
  `insertWithReference`. That step reserves capacity (`reserveSeats`), records the creation
  transition and prices the booking.
- **Fulfilment** runs in the confirming transaction (`InhouseFulfilment.fulfil`). It creates
  vouchers, visa applications and memberships. Cancellations follow `CancellationTier` data
  (`BookingCancellationService`). Capacity is released by `settleSeats` from
  `BookingTransitions.apply()` on every releasing status.
- **Money and confirmation.**
  - Payments come only from verified webhooks (`PaymentEventsService`).
  - Every money movement is a `LedgerService.post()`.
  - Refunds go through `RefundsService` (automatic or maker-checker).
  - Card captures are risk scored before fulfilment (ADR-040).
- **Places that switch on in-house kinds** and need new cases:
  - API: `inhouse-quotes.service.ts`, `inhouse.schemas.ts`, `booking-presenter.ts`,
    `inhouse-fulfilment.ts`, `inhouse-presenter.ts`, `bookings.service.ts`, `trip-facts.ts`,
    `booking-documents.service.ts`, `inhouse-catalog.ts`;
  - web: `join-prime.tsx`;
  - mobile: `prime-screen.tsx`.
- **The `Vertical` Prisma enum** is the purpose axis for payments, pricing rules, fees and
  reports.
- **Available infrastructure.**
  - `ws`, `bullmq` and `ioredis` are already in the lockfile.
  - `@nestjs/websockets` is not.
  - Postgres 16 (alpine) ships `btree_gist`, `cube` and `earthdistance`, but not PostGIS.
- **Guards that apply to every new model:**
  - `DATA_REGISTRY` entry, enforced at compile time and by a test;
  - `ENCRYPTED_FIELDS` for `*Encrypted` columns, enforced by a test;
  - admin route matrix and audit coverage tests;
  - OpenAPI drift check;
  - security checklist mapping;
  - cookie catalog;
  - the homepage JavaScript budget (170 kB).

## Baseline quality (before any Cars code)

Measured on 2026-10-24 on the base commit `cdade27` (identical application code to `cba0c1b`, plus the APK
workflow).

| Check                          | Result                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                   | pass                                                                                                           |
| `pnpm lint`                    | pass                                                                                                           |
| `pnpm typecheck`               | pass                                                                                                           |
| `pnpm test`                    | pass (API 403, mobile 113, ui-native 44; shared, worker, i18n, design-tokens, api-client, ui-web suites green) |
| API e2e                        | 311/311 (29 suites), 2026-10-24                                                                                |
| Web e2e (Playwright, chromium) | 68/68 on `cba0c1b` (2026-10-13)                                                                                |
| Admin e2e                      | 13/13 on `cba0c1b` (2026-10-13)                                                                                |
| CI and Security workflows      | green on `cba0c1b`                                                                                             |
| `pnpm audit --prod`            | no advisories after the Next 16.3.8 bump (Security green)                                                      |

## Plan

| Sub-phase | Deliverables                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0        | This plan; ADR-049 to ADR-053; baseline recorded                                                                                                                                                                                                                                                                                                                                                                                      |
| P1        | `@suskii/shared`: Cars Zod schemas (`ground.ts`), geo helpers (bounding boxes, haversine, point-to-polyline distance, polyline codec), fare arithmetic in minor units; API `src/ground`: feature flags, Ed25519 ticket signing, `MapsProvider` (mock, osrm), `KycProvider` and `PayoutProvider` (mock), config and env validation, new roles and permissions                                                                          |
| P2        | Prisma models and migration: operators, terminals, routes, bus types and seat layouts, trips, seat holds, seat assignments and tickets; drivers, driver documents, vehicles, rides, ride offers, location pings, ride ratings, incidents, emergency contacts, share links; rental fleet, reservations (exclusion constraint), handovers; `earthdistance` indexes; `DATA_REGISTRY` and `ENCRYPTED_FIELDS`; demo seed in `db:seed:demo` |
| P3        | Buses: search, trip details with seat map, Redis seat holds (Lua, all-or-nothing), quote and booking on the pipeline, QR tickets, operator-agent scan, admin inventory routes; 50-parallel-holds test                                                                                                                                                                                                                                 |
| P4        | Rides: quote (maps adapter with fallback), paid booking creates the `Ride`, worker matching job (earthdistance), offers with timeouts, state machine, `ws` gateway with Redis pub/sub, PIN, share link, SOS, ratings, driver onboarding and documents through the KYC adapter, earnings ledger; 200-driver matching test; cross-rider WebSocket denial test                                                                           |
| P5        | Rentals: fleet search, availability (exclusion constraint), deposit line, chauffeur option, handover check-out and check-in, deposit release with deductions                                                                                                                                                                                                                                                                          |
| P6        | Payments: verticals in pricing and fees, ride fare settlement (refund of unused fare, cancellation fees), driver earnings and mock payouts, reconciliation coverage                                                                                                                                                                                                                                                                   |
| P7        | Clients: web pages (buses, rides, rentals, tickets), admin console sections (ground inventory, drivers review, safety), Expo screens (bus booking, ride request and tracking, rentals, driver mode, ticket scanner); Playwright, Jest and Maestro flows                                                                                                                                                                               |
| P8        | Security docs, `docs/privacy/cars-data-map.md`, metrics, dashboards, alerts, runbooks (stuck ride, webhook replay, driver document backlog, scanner offline mode)                                                                                                                                                                                                                                                                     |
| P9        | Five flagged features: trip bundling, unified price breakdown, safety suite with route deviation, offline QR, departure planner                                                                                                                                                                                                                                                                                                       |
| P10       | `docs/audits/2026-10-e2e-audit.md`: journeys, code review, k6 p95, `pnpm audit`                                                                                                                                                                                                                                                                                                                                                       |
| P11       | README, CHANGELOG, `PROJECT_SPEC.json`, `CLAUDE.md`; PR "feat: add buses, rides and car rental" with test and rollback plans; CI green                                                                                                                                                                                                                                                                                                |

### Risks

- **Scope.** Three products, three clients and an audit make a very large change. Each
  sub-phase ends green before the next starts. Items that cannot be done well within the change
  go to `docs/phases/backlog.md` with a reason, not into half-finished code.
- **Concurrency.**
  - Seat holds and ride acceptance race by design. Both use a single atomic primitive (a Redis
    Lua script, or a conditional update), and tests run them in parallel.
  - Rental double-booking is prevented by a database exclusion constraint, not application
    checks.
- **Location data** is the most sensitive data the platform has held so far. It is collected
  only during online or active periods, rounded for anyone but staff, and purged after 90 days.
- **The mobile response shapes** are a decision gate. No existing response shape changes; Cars
  only adds endpoints and optional fields.

## Conflicts resolved

The task says the repository's conventions win when they conflict with the task text. Each
conflict and its resolution:

| Task text                                                      | Resolution                                                                                                                                           | Why                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Branch `feature/cars`, PR against the base branch              | Work on `feature/cars`, cut from the session branch; PR into `claude/suskii-travels-setup-xggf42`, which is the repository's default and base branch | The task names the branch explicitly; nothing is pushed to the base directly                           |
| ADR names `ADR-cars-*`                                         | ADR-049 to ADR-053, each naming its spec title                                                                                                       | The repository numbers ADRs sequentially                                                               |
| Modules under `src/modules/*` and `src/integrations/*`         | `src/ground`, `src/buses`, `src/rides`, `src/rentals`, `src/drivers`; adapters as abstract classes beside them                                       | Matches every existing module and provider (ADR-049)                                                   |
| `BusBooking` and `RentalBooking` tables, per-purpose webhooks  | New in-house kinds `bus`, `ride`, `rental` on the one booking pipeline, with side tables keyed by booking item                                       | `CLAUDE.md`: "Never build a parallel booking flow" (ADR-049)                                           |
| Payment purposes `bus_booking`, `ride_fare`, `rental_deposit`… | New `Vertical` values `buses`, `rides`, `rentals`; the deposit is a line of the rental booking                                                       | Verticals already drive payments, pricing and reports (ADR-049)                                        |
| PostGIS                                                        | `earthdistance` on `cube` with GiST indexes; deviation in application code                                                                           | Every environment uses `postgres:16-alpine` without PostGIS; the task allows "or equivalent" (ADR-053) |
| NestJS WebSocket gateway                                       | Plain `ws` on the API's HTTP server at `/v1/ws/rides`, Redis pub/sub fan-out                                                                         | Avoids two new dependencies under the supply-chain cooldown (ADR-052)                                  |
| Ride charged at completion for the final amount                | Upfront fixed fare paid before matching; the unused part is refunded at completion                                                                   | Payments are hosted checkout only and stored cards need a mandate (ADR-018, ADR-051)                   |
| Rental deposit pre-authorised                                  | Refundable charge, itemised, released by an automatic refund after check-in                                                                          | No NGN pre-authorisation on the hosted checkouts in use (ADR-051)                                      |
| Cash for rides                                                 | Off and not implemented                                                                                                                              | Decision gate default; `CLAUDE.md` forbids `TODO: implement` in completed work                         |
| VAT and fee rules                                              | Placeholder settings in config (`CARS_VAT_BPS` default 0, service fees through the existing fee rules), flagged as an owner question                 | Decision gate default; no invented tax rates                                                           |
| Background location for drivers through a generic task         | Collected only while online or on an active ride (ADR-050)                                                                                           | Data minimisation                                                                                      |

## Decision gates (defaults applied)

| Gate                                | Default taken                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Real maps provider in production    | `mock` and a self-hosted `osrm` adapter only; Google or Mapbox wait for the owner                          |
| KYC provider                        | `MockKycProvider` only; production refuses it unless `ALLOW_MOCK_PROVIDERS=true`                           |
| Bus operator API or manual          | Manual inventory through admin routes (`ManualBusSupplier`); the `BusSupplier` interface allows APIs later |
| Cash for rides                      | Off, not implemented                                                                                       |
| VAT and fee rules                   | Placeholder config, zero by default                                                                        |
| Mobile-facing response shape change | None made; only new endpoints and new optional fields                                                      |

## Decisions log

| #   | Decision                                                                                                                                                                                                                                                                                                                        | Record  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Cars products are in-house item kinds on the one booking pipeline; rides become a `Ride` aggregate at fulfilment                                                                                                                                                                                                                | ADR-049 |
| 2   | Flags `CARS_BUSES_ENABLED`, `CARS_RIDES_ENABLED`, `CARS_RENTALS_ENABLED` default off in production; disabled routes answer 404                                                                                                                                                                                                  | ADR-049 |
| 3   | Roles `driver` and `operator_agent`; staff permissions `ground:manage`, `drivers:review`, `safety:manage`                                                                                                                                                                                                                       | ADR-049 |
| 4   | STRIDE model; object-level 404 tests on every Cars route; PINs, share tokens, QR payloads and NINs added to log redaction                                                                                                                                                                                                       | ADR-050 |
| 5   | Bus holds in Redis (Lua, all-or-nothing, 10 minutes), sales backed by a partial unique index                                                                                                                                                                                                                                    | ADR-051 |
| 6   | Upfront ride fares, refunds for lower outcomes, policy-table cancellation fees, earnings as ledger postings, mock payouts                                                                                                                                                                                                       | ADR-051 |
| 7   | Rental deposit as a refundable, itemised charge                                                                                                                                                                                                                                                                                 | ADR-051 |
| 8   | Plain `ws` gateway, cookie with `Origin` check or first-message bearer auth, per-ride subscription checks, REST polling fallback                                                                                                                                                                                                | ADR-052 |
| 9   | `earthdistance`/`cube` proximity, application-side deviation, maps fallback × 1.4 capped, curated places instead of an external geocoder, 90-day ping retention                                                                                                                                                                 | ADR-053 |
| 10  | QR tickets are Ed25519 signatures over ticket id, trip id and departure window; verifiable offline with the public key; single-use scan by conditional update                                                                                                                                                                   | ADR-050 |
| 11  | The `roles` enum in responses gains `driver` and `operator_agent`, and the `vertical` enum gains `buses`, `rides` and `rentals`. Only accounts or bookings that use Cars carry them, and that needs a Cars-aware client, so existing app builds never receive them. Recorded against the mobile response-shape gate as additive | P1      |
| 12  | `driver` and `operator_agent` are not staff roles (`NON_STAFF_ROLES`): no console, no MFA requirement; their routes also check record ownership                                                                                                                                                                                 | P1      |
| 13  | Product and feature flags are checked by a global guard that runs before authentication, so a disabled product answers 404 to everyone                                                                                                                                                                                          | P1      |
| 14  | Account deletion keeps its existing blocker codes: a live ride counts as `booking_in_progress`, unpaid driver earnings or a pending payout as `wallet_balance`. Clients and the mobile response shape stay as they are                                                                                                          | P2      |
| 15  | Deleting a driver's account turns the driver into a tombstone (names, NIN, licence, bank details and plates cleared, documents destroyed, status `suspended`); ratings and past rides stay as the safety record                                                                                                                 | P2      |
| 16  | Ride pickup and drop-off are rounded to two decimals (about 1 km) and the route dropped `RIDE_PING_RETENTION_DAYS` after the ride ends; pings are deleted then. Partial unique indexes and an exclusion constraint are raw SQL, which Prisma leaves alone (checked with `migrate diff`)                                         | P2      |
| 17  | Every bus passenger has a seat and pays the seat fare; infants on a lap are not sold online (owner question). Passengers give names and a date of birth, no passport (domestic)                                                                                                                                                 | P3      |
| 18  | Sales close 30 minutes before departure. A ticket's QR code boards from 3 hours before to 6 hours after departure; the window is part of the signed payload, so offline scanners enforce it too                                                                                                                                 | P3      |
| 19  | Boarding passes are a PDF (`bus_ticket` document, one page per seat with its QR code) attached to the confirmation email, and live in the booking (`busTickets`) for the web and the app                                                                                                                                        | P3      |
| 20  | Staff make an account an operator agent from the console (`ground:manage`), which grants the `operator_agent` role; removing its last operator removes the role                                                                                                                                                                 | P3      |
| 21  | Cancelling a departure refunds its paid bookings in full (`supplier_cancellation`, non-discretionary) and cancels the unpaid ones. Cars bookings take no payment plans and no linked add-ons                                                                                                                                    | P3      |
| 22  | A booking cancelled before its hold lapses frees the seat in the database at once; the Redis key lapses on its own within the 10-minute hold, so the seat can show as held for a few minutes                                                                                                                                    | P3      |
