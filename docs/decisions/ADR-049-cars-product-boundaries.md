# ADR-049: Cars product boundaries (buses, rides, rentals)

- Status: Accepted
- Date: 2026-10-24
- Deciders: Claude Code (implementer), pending owner review
- Spec name: ADR-cars-product-boundaries

## Context

The owner asked for three ground-transport products, together called Cars:

- interstate bus tickets with seat selection and QR boarding;
- intrastate on-demand and scheduled rides with vetted drivers;
- car rental with or without a chauffeur.

The platform already sells flights, hotels, packages, tours, visa assistance, add-ons and Suskii
Prime through one booking pipeline (ADR-014, ADR-025). `CLAUDE.md` forbids parallel booking
flows. Payments come only from verified webhooks, and every money movement is a ledger posting
(ADR-016, ADR-017).

The task spec models separate `BusBooking` and `RentalBooking` tables, a separate webhook
routing per "payment purpose", and modules under `apps/api/src/modules/*`. Where the spec and
the repository conventions disagree, the repository wins (task step 0).

## Decisions

1. **One booking pipeline for everything paid.**
   - **Buses** and **rentals** are new in-house item kinds, `bus` and `rental`, on `ItemPayload`.
     Their quotes are `Offer` rows with supplier `suskii`. Bookings, payments, payment plans
     (off for these kinds), refunds, the ledger, vouchers, emails, guest access and admin all
     work unchanged.
   - Product-specific state lives in side tables keyed by the booking item:
     - bus seat assignments and tickets;
     - rental reservations, with the exclusion constraint;
     - handover records.
   - **Rides** are paid through the same pipeline: a quote is an `Offer` of kind `ride`, and the
     traveller pays a booking upfront (card, bank transfer or wallet).
   - When the booking is confirmed, `InhouseFulfilment` creates the `Ride` aggregate, which then
     follows its own state machine (matching, arriving, in progress, completed). Settlement
     (refunds of unused fare, cancellation fees, driver earnings) goes through
     `RefundsService` and `LedgerService`.
2. **Payment "purposes" are verticals.** New `Vertical` values `buses`, `rides` and `rentals`
   take the place of the spec's `bus_booking`, `ride_fare`, `rental_payment` and
   `rental_deposit`.
   - The existing webhook route `/v1/payments/webhooks/<provider>` already resolves a payment to
     its booking, so no routing table is needed.
   - A rental deposit is a separately itemised line of the rental booking (ADR-051).
3. **Modules follow the repository layout**, not `src/modules/*`:
   - `apps/api/src/ground` holds shared code: geo, QR signing, maps adapters, policies and
     feature flags;
   - `apps/api/src/buses`, `apps/api/src/rides`, `apps/api/src/rentals` and
     `apps/api/src/drivers` hold the products.
   - External systems sit behind abstract classes with mock adapters, like `FlightSupplier`:
     `BusSupplier`, `MapsProvider`, `KycProvider` and `PayoutProvider`. Production refuses mock
     adapters unless `ALLOW_MOCK_PROVIDERS=true`.
4. **Feature flags per product.** `CARS_BUSES_ENABLED`, `CARS_RIDES_ENABLED` and
   `CARS_RENTALS_ENABLED`:
   - default `false` in production and `true` elsewhere;
   - a disabled product's routes answer 404;
   - its web and app entry points are hidden through the public content endpoint.
5. **Roles.**
   - A traveller who drives becomes a **driver** through the onboarding flow (role `driver`,
     permission `driving`). Driver routes need it, plus an approved, verified driver record.
   - Bus operator staff who scan tickets get role `operator_agent` (permission `tickets:scan`),
     scoped to their operator through `operator_members`.
   - Staff get three new permissions:
     - `ground:manage`: operators, terminals, routes, vehicles, trips, fares, rental fleet;
     - `drivers:review`: applications, documents, vehicles;
     - `safety:manage`: SOS and route-deviation incidents.
   - `operations` holds all three; `support` holds `safety:manage`.
6. **Launch scope** (owner defaults from the task):
   - buses: Lagos, Ogun, Oyo, Abuja and Rivers terminals;
   - rides and rentals: Lagos;
   - NGN only, `Africa/Lagos` display;
   - coordinates within Nigeria unless `CARS_WEST_AFRICA_ENABLED` widens the box.

## Consequences

- Admin, refunds, reconciliation, risk review, data export, account deletion and retention
  already cover the new bookings. New tables still need `DATA_REGISTRY` entries.
- Rides charge before the trip, not at completion (ADR-051). The spec's "charge the final amount
  at completion" becomes "refund the unused part at completion".
- Booking-level features that make no sense for the new kinds must be refused per kind, like
  memberships today: payment plans, add-on linking and PDF vouchers for rides.
