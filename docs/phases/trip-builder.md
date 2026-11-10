# Trip builder: combined trips paid once

The owner's "D. Combined travel packages" list (2026-11-10): choose Lagos as the departure and
London as the destination, the departure and return dates, a flight, a hotel, a rental car,
airport transfers and travel insurance; review the whole trip; pay for the combined package; and
see a price per part and a total, "except if the customer only wants one or two". Decision in
ADR-099.

## Where the platform stood

- Flights, hotels, car rental and add-ons each had a search, a checkout and a payment of their
  own. Nothing put them together or showed what a trip cost.
- In-house packages (ADR-025) are fixed products staff assemble, not a traveller's own choice.
- The booking pipeline is per booking: state machine, price re-check, supplier call,
  cancellation, refunds, ledger balance.

## Plan

| Step | Work                                                                                                                                                                                    | Files                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1    | Shared: the parts of a trip, the plan and its schema, which booking is which part, part and trip states, the search query of each part                                                  | `packages/shared/src/trips*.ts`                                      |
| 2    | Database: `trips`, `trip_payments`, `bookings.trip_id` and `trip_component`, `payments.trip_payment_id`, the discrepancy subject `trip_payment`; a country on rental cars (expand-only) | `apps/api/prisma`                                                    |
| 3    | Trips API: create, list, read, add and remove a part, delete; ownership and the rules a part must meet                                                                                  | `apps/api/src/trips`                                                 |
| 4    | One checkout: re-check every part, one hosted session, one payment share per booking                                                                                                    | `src/trips/trip-checkout.service.ts`, `bookings/checkout.service.ts` |
| 5    | Webhooks, reconciliation and refunds: settle every share, refund what cannot be applied, find lost webhooks, check the ledger against the provider, refund a share to the trip's charge | `src/bookings/payment-*.ts`, `refunds.service.ts`, `src/finance`     |
| 6    | Privacy: data registry, retention of empty plans, the export's `trips` section, records of processing                                                                                   | `src/privacy`, `docs/privacy`                                        |
| 7    | Demo data: London cars and an airport transfer at the destination, so Lagos to London can be built end to end                                                                           | `prisma/seed-demo*.ts`                                               |
| 8    | Website: the plan form (`/trips`), the trip page (`/trips/{id}`), checkout that adds to the trip, the homepage and footer entries                                                       | `apps/web`                                                           |
| 9    | App: the trip builder from Home, the plan and trip screens, checkout that adds to the trip, the payment hand-back                                                                       | `apps/mobile`                                                        |
| 10   | Text in English, French, Swahili, Arabic and Portuguese                                                                                                                                 | `packages/i18n`                                                      |
| 11   | Tests (shared unit, API e2e with ownership and money paths, web e2e Lagos to London, app Jest) and docs (ADR-099, security, PCI, store forms, CLAUDE.md, CHANGELOG)                     | everywhere                                                           |

## Not in this item

- **A bundle discount.** The total is the sum of the parts. A discount for a combination is a
  pricing rule the owner decides.
- **All-or-nothing fulfilment.** Each part is ticketed or confirmed by its own supplier; a part
  that fails is refunded on its own (ADR-099 says why).
- **Guest trips.** A trip needs an account; a guest still buys each part separately.
- **Other parts** (tours, visa assistance, eSIM, lounge), **children's ages in the plan**,
  **installments or a wallet for a trip**, **one email for the whole trip** and **a console view
  of trips**.

## Risks

- **Money split across bookings.** One charge becomes several payment shares. The webhook applies
  each under its booking's lock, refunds a share that cannot be applied, refunds everything when
  the amount is wrong, and the hourly reconciliation compares the charge with its shares and with
  the provider. The API e2e suite covers each path.
- **A price moves between review and payment.** Every part is re-checked when the payment starts;
  a change stops it until the traveller accepts the new price on that part.
- **A traveller adds the wrong booking.** Checkout adds a booking only when its quote is the part
  the traveller went to choose, says so first, and offers to book on its own.

## Outcome

Built on `feat/trip-builder`.

- **API:** 10 trips e2e tests (the five-part trip paid once with ledger and reconciliation
  checks, one or two parts, access and rules, a price change, a sold-out part, a wrong amount, a
  lost webhook, a failed checkout, a refund of one part, deletion, the cap on open trips); the
  IDOR matrix covers every trip route.
- **Website:** `e2e/trip-builder.spec.ts` builds Lagos to London from all five parts and pays
  once, and keeps a plan through sign-up with only the parts wanted; `/trips` is in the
  accessibility and hydration lists; the payment-page policy test covers `/trips/{id}`.
- **App:** `trip-builder.test.tsx` (plan, trip, payment, price change, removal, deletion) and
  checkout's add-to-trip tests.

Waits for the owner: whether a combined trip gets a discount, and the open questions in ADR-099.
