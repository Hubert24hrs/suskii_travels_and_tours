# ADR-099: Combined trips, built from ordinary bookings and paid once

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for combined travel packages: choose Lagos and London, the dates, a
  flight, a hotel, a rental car, airport transfers and travel insurance, review the whole trip
  with a price per part and a total, and pay for the package once, "except if the customer only
  wants one or two"), Claude Code (implementer)

## Context

Every product was sold on its own: a flight, a hotel, a rental car and each add-on had its own
search, its own checkout and its own payment. A traveller going from Lagos to London paid five
times and never saw what the trip cost. The in-house packages (ADR-025) are fixed products that
staff assemble; they are not a way for a traveller to put their own trip together.

The booking pipeline is built around one booking with one item: the state machine, the price
re-check before payment, the supplier's `book()` with its idempotency key, online cancellation,
refunds and the ledger balance are all per booking (ADR-014 to ADR-019).

## Decision

### A trip is a group of ordinary bookings

A **trip** (`trips`) belongs to an account and holds a **plan** (where from and to, the dates,
adults and children, and the parts wanted) and up to five bookings, one per **part**:

| Part        | The booking it takes          |
| ----------- | ----------------------------- |
| `flight`    | a flight booking              |
| `hotel`     | a hotel booking               |
| `car`       | a car rental (`rental`)       |
| `transfer`  | the add-on `airport_transfer` |
| `insurance` | the add-on `insurance`        |

`tripComponentOf()` in `@suskii/shared` names the part a booking is; anything else (a tour, a
visa, a bus ticket, a ride, a membership, another add-on) is not a part of a trip. Each part is
chosen on the ordinary search and booked through the ordinary checkout, so it is priced, held,
re-checked, ticketed, changed, cancelled and refunded exactly as it is when bought alone. A trip
adds two things only: it shows the parts together with **a price per part and one total**, and it
takes **one payment** for all of them.

**Any subset is a trip.** The plan names the parts the traveller wants; the trip can be paid with
any of them present, and one or two parts are a trip too.

Rejected:

- **One booking with several items.** The schema allows items, but the state machine, the
  supplier call, cancellation tiers and refunds assume one. A flight that tickets while the hotel
  fails would need a state per item inside one booking: a second pipeline.
- **Paying the parts one after another.** Five card charges, five chances to stop halfway, and
  five 3-D Secure prompts.
- **Topping up the wallet and paying each part from it.** A refund of a part would go back to the
  wallet instead of the card, and a balance held for a customer raises the stored-value question
  of ADR-090.
- **A bundle price or discount.** The total is the sum of the parts' own all-in prices
  (ADR-072). A discount for a combination is the owner's decision and a pricing rule, not
  something the trip invents.

### Which bookings a trip takes

`TripsService.addPart()` loads the booking as its owner would (`BookingsService.load()`) and
accepts it only when it is the caller's own (by session, never by a guest token), unpaid
(`PRICED` or `AWAITING_PAYMENT`), in the trip's currency, a part the plan asks for, not a company
booking, without a payment plan, and not in another trip (422 `trip-part-invalid` with a `code`
otherwise). A part the trip already has gives way while it is unpaid: the earlier booking leaves
the trip and stays an ordinary booking that expires on its own. A paid part stays (409
`trip-part-paid`). A partial unique index keeps one booking per part in the database.

A trip needs an account: a guest's access is a token per booking, and a group of bookings needs
one owner. Every route acts on the caller's own trips; anyone else gets 404.

### One hosted checkout, one payment share per booking

`TripCheckoutService.startPayment()`:

1. takes the unpaid parts, expires one whose payment deadline passed, and stops with 409
   `price-changed` when a part is waiting for consent to a new price;
2. confirms each part's price with its supplier (`CheckoutService.confirmPrice`, the same
   re-check a single booking gets). A changed price answers 409 with that booking's change,
   accepted on the booking itself; a part that sold out answers 410 and leaves the total;
3. opens **one** hosted checkout for the sum (`trip_payments`), and in the same transaction
   creates **one `payments` row per booking** (`trip_payment_id`, reference
   `trip_{tripPaymentId}_{n}`) for that booking's amount and moves each booking to
   `AWAITING_PAYMENT`.

The shares are why nothing else changes: a booking's ledger postings (`payment:{id}:captured`),
its balance (`BookingFundsService.paid`), the payment risk review, ticketing and its refunds all
read its own payment, as before. Card data still never touches Suskii (hosted checkout only,
SAQ A).

One rule does count the trip and not the shares: the velocity signals of the payment risk review
(ADR-040: five payments a day for an account or a contact, ten checkouts from an address). The
card was charged once, so a trip is one payment there. Counted by share, one trip of five parts
used up the day's limit, and the traveller's next purchase was held for staff.

A trip has one checkout open at a time, and it charges what the trip shows: starting a new one,
adding a part or removing one closes the checkout that was open (`closeOpenCheckout`) and returns
its bookings to unpaid. A payment that still arrives on a closed checkout goes through the
webhook like any other: each share is taken or refunded.

Payment plans (reserve now, installments), company bookings and the wallets are not offered for a
trip: it is one payment in full.

### The webhook settles every share, or refunds what cannot be applied

Payment outcomes still come only from verified webhooks (`PaymentEventsService`). An event for a
trip payment locks the trip payment and its bookings (in one order, so two events never deadlock)
and then:

- **paid, for exactly the total:** each share goes through `applyReceived` under its booking's
  lock, as a single payment would. A part that can no longer take its money (it expired, was
  cancelled, or its price moved after the checkout opened) has its share flagged `requiresRefund`
  and refunded automatically; the others proceed (`trip_partly_applied`);
- **paid, for another amount:** nothing is applied in part. Every share is flagged and refunded,
  and the mismatch is audited (`trip.payment_amount_mismatch`);
- **failed or expired:** the shares close and the bookings return to what an unpaid booking does.

A lost webhook is covered like a booking's: `PaymentReconciliationService` verifies pending trip
payments with the provider and feeds the outcome through the same pipeline with a synthetic event
id. The hourly ledger reconciliation compares each trip payment with its shares and with the
provider and raises a discrepancy (`trip_payment`) when they differ; it never corrects anything.

### Each part is fulfilled and refunded on its own

After payment each booking is ticketed or confirmed by its own supplier. **A trip is not all or
nothing**: if the hotel fails after the flight is ticketed, the hotel goes to its own refund and
the flight stands, exactly as when the two are bought separately. Holding five suppliers until
all confirm is not something they offer, and cancelling a ticketed flight because a transfer
failed would cost the traveller the airline's fee. The trip's screen shows each part's state.

A refund of a part goes to the trip payment's provider reference for that share's amount (a
partial refund of the one charge), never more than the share; refund webhooks are matched through
the trip payment.

### Deleting, limits and retention

- A trip nobody started paying can be deleted: its bookings leave it and stay ordinary bookings
  (`DELETE /v1/trips/{tripId}`). A trip with a payment, started or made, stays (409
  `trip-has-payments`).
- One account may have ten trips with nothing paid (`TRIP_MAX_OPEN`, 409 `too-many-trips`).
  Creating a trip and adding a part use the booking limits; starting a payment uses the payment
  limit and, in the app, the device attestation.
- A plan holds places, dates and head counts: no names, contacts or documents. An empty plan is
  purged after 30 days; a trip with bookings is kept with them as a financial record, also after
  the account is deleted (the user row becomes a tombstone). The export has a `trips` section.

### Clients

- **Plan, then parts.** `/trips` (website) and the trip builder (app, from Home) take the plan.
  The trip's page lists the parts wanted; each one opens the ordinary search prefilled from the
  plan (`tripSearchQuery()` in `@suskii/shared`: a return flight, a hotel in the destination's
  city, a car there for the same days, the transfers or the insurance on sale there).
- **Checkout adds to the trip.** While a part is being chosen the client remembers the trip and
  the part (session storage on the website, memory in the app). Checkout for a quote that is that
  part creates the booking and calls `addTripPart` instead of starting a payment, then returns to
  the trip. It says so before the traveller submits and offers to book on its own instead. A
  quote for anything else is never added.
- **Review and pay.** The trip's page shows a price for each part, the total and one button. It
  is a payment page: private, not indexed, and only our scripts run there (ADR-089).
- Children's ages are not part of a plan, so the hotel search starts with the adults and the
  traveller adds the children there.

### The app's contract

The booking answer gains `trip` (`{ id, reference, component }` or null). It is additive: app
builds that predate it ignore the field. Every other change is a new route.

## Consequences

- A traveller sees what the whole trip costs and pays once; each part still has its own booking
  reference, documents, cancellation rules and refund.
- One card charge can end as several bookings in different states. Support sees each booking as
  before; the console does not list trips yet.
- The sum of five re-checks happens at payment, so a price change in any part stops the payment
  until the traveller accepts it. That is the same consent a single booking asks for.
- The website keeps one more key in session storage (`suskii:trip-builder`), listed in the cookie
  settings as strictly necessary.

## Open questions for the owner

- A discount or a fee for a combined trip (none today: the total is the sum of the parts).
- Whether tours, visa assistance, an eSIM or lounge access should become parts of a trip.
- Asking children's ages in the plan, so the hotel search is prefilled with them.
- One confirmation email for the whole trip (each booking sends its own today), and a view of
  trips in the console (staff see the bookings and each one's trip reference).
- Paying a trip in installments or from a wallet.
