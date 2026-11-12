# ADR-025: In-house catalog, capacity and pricing

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

Packages, tours, visa assistance and add-ons are Suskii's own inventory (spec: "managed in-house
via admin"). Flights and hotels already run through quotes (`Offer` rows), bookings with an
explicit state machine, payments, a double-entry ledger, payment plans and refunds, all built
around an `ItemPayload` union with `flight` and `hotel` kinds. The admin console UI arrives in
phase 10, but inventory must be manageable now, and no real-world facts (prices, itineraries,
visa rules) may be invented.

## Decisions

1. **Same pipeline.** `ItemPayload` gains `package`, `tour`, `visa` and `addon` kinds. Quotes for
   in-house products are `Offer` rows with supplier `suskii` and a payload that snapshots the
   product, the departure and the selection (travellers, dates). Bookings, payments, the ledger,
   payment plans and refunds are reused unchanged; the pre-payment price re-check re-reads the
   catalog instead of calling a supplier and goes through the same price-change consent.
2. **Tables.** `packages` with `package_departures`, `tours` with `tour_departures`, `addons`,
   `visa_products` and `visa_rules`. Products have a slug, a status (`draft`, `published`,
   `archived`), a `sample` flag, descriptive content (summary, highlights, itinerary, inclusions,
   exclusions, meeting point) and a cancellation policy. Departures carry their dates (tours: local
   wall time, IANA zone and UTC instant), capacity and per-person prices for adults, children and
   infants in minor units with a currency.
3. **Prices.** The stored price is the base price, like a supplier's net fare: `PricingService`
   applies the vertical's markup rules, fees, promo codes and FX, so one set of pricing tools
   covers every vertical. No rule is seeded, so the base price is what customers pay until the
   owner adds rules.
4. **Capacity.** Creating a booking reserves seats with one conditional update
   (`reserved + sold + n <= capacity`, backed by a check constraint), so concurrent buyers can
   never oversell. Confirmation moves the seats from reserved to sold; expiry, cancellation,
   failure and refunds release them, in the same transaction as the booking transition.
5. **Management.** Admin routes (`catalog:manage`; visa rules with `visa:process`) create,
   update, publish and archive products and departures; every change is audited. Only published
   products with open departures are public.
6. **Demo data.** `db:seed:demo` creates sample inventory for development and the e2e suites
   (`sample = true`, shown with a "Sample" badge). It refuses to run when `NODE_ENV=production`.
   Production data comes only from the admin routes.

## Consequences

- Every existing booking guarantee (state machine, idempotency, webhooks as the source of truth,
  ledger balance as what was paid, maker-checker refunds) applies to the new verticals for free.
- Operations must enter real products before launch; the owner decides pricing rules per vertical.
- A package's flights and hotel are fulfilled by operations, not booked through suppliers
  automatically; automating that is a later decision once suppliers are chosen.
