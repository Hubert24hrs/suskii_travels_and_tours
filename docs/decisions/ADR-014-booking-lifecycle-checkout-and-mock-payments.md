# ADR-014: Booking lifecycle, checkout and mock payments

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 5 must take a traveller from results to a confirmed booking with a mock payment, re-price
immediately before payment with explicit consent to any change, and drive bookings through the
spec's state machine (`PROJECT_SPEC.json#/architecture/booking_state_machine`). Real payment
providers, installments, holds and refunds are phase 6, so the payment side has to be real enough
that phase 6 only swaps adapters.

## Decisions

### State machine

Statuses are the spec's 13. Transitions are driven by named events; anything not in the table is
rejected (`InvalidBookingTransition`), so a bug cannot move a booking sideways.

| Event                 | From                                           | To               |
| --------------------- | ---------------------------------------------- | ---------------- |
| `price`               | DRAFT                                          | PRICED           |
| `hold`                | PRICED                                         | HELD             |
| `request_payment`     | PRICED, HELD                                   | AWAITING_PAYMENT |
| `payment_abandoned`   | AWAITING_PAYMENT                               | PRICED           |
| `partial_payment`     | AWAITING_PAYMENT, PARTIALLY_PAID               | PARTIALLY_PAID   |
| `payment_succeeded`   | PRICED, HELD, AWAITING_PAYMENT, PARTIALLY_PAID | PAID             |
| `start_ticketing`     | PAID                                           | TICKETING        |
| `ticketed`            | TICKETING                                      | CONFIRMED        |
| `ticketing_exhausted` | TICKETING                                      | REFUND_PENDING   |
| `fail`                | DRAFT, PRICED, HELD                            | FAILED           |
| `cancel`              | DRAFT, PRICED, HELD, AWAITING_PAYMENT          | CANCELLED        |
| `expire`              | DRAFT, PRICED, HELD, AWAITING_PAYMENT          | EXPIRED          |
| `request_refund`      | PAID, PARTIALLY_PAID, CONFIRMED                | REFUND_PENDING   |
| `refunded`            | REFUND_PENDING                                 | REFUNDED         |

`payment_succeeded` is also accepted from PRICED and HELD because a late webhook for an abandoned
checkout session is real money: it confirms the booking when the amount matches the booking's
current total. Every transition writes a `booking_status_history` row and an audit entry in the same
transaction, with the actor (customer, system, webhook, staff) and a reason code.

### Checkout sequence

1. Selecting a result quotes it (existing `POST .../quote`): the supplier re-prices and an `Offer`
   row is stored with the original search, so an expired offer can send the traveller back to the
   same search with the inputs preserved.
2. `POST /v1/bookings` validates passengers against the offer, prices the booking (quote price,
   extra baggage, promo code) and creates it as `PRICED`.
3. `POST /v1/bookings/{id}/payments` re-prices with the supplier **immediately before payment**.
   A different total answers `409 price-changed` with the previous and new totals and the
   difference; the new price is stored as pending. `POST .../price-consent` with the exact new
   total accepts it (audited); the traveller then retries the payment. An unchanged price creates
   a payment and returns the hosted checkout URL (`AWAITING_PAYMENT`).
4. The payment provider's **webhook is the source of truth**. The redirect back to the booking
   page only starts a status poll. A verified, deduplicated success whose amount and currency
   equal the payment row moves the booking to `PAID`, records any promo redemption and starts
   ticketing.
5. Ticketing books with the supplier using the booking item id as the idempotency key, so a retry
   can never issue twice. Success means `CONFIRMED`, then the e-ticket or voucher PDF and the
   confirmation email. A supplier failure leaves the booking in `TICKETING`; the worker retries
   with exponential backoff (1, 2, 4, 8, 16 minutes); after the budget the booking moves to
   `REFUND_PENDING` and operations are alerted through the audit log. Refund execution is phase 6.
6. Unpaid bookings expire at the payment deadline (offer expiry, at most 30 minutes after pricing;
   supplier hold deadlines in phase 6).

Every write that creates a booking or payment requires `Idempotency-Key` (existing interceptor).

### Payments: interface now, mock adapter in phase 5

`PaymentProvider` defines `createCheckout` (returns a provider reference and a hosted checkout
URL) and `parseWebhook` (verifies the signature over the raw body and returns a normalised event).
`MockPaymentProvider` hosts its checkout page on the web app (`/checkout/mock-payment/{ref}`);
its buttons call a mock-only API endpoint that builds an event, signs it with an HMAC subkey and
feeds it through the same webhook pipeline as a real provider. Webhook events are stored by
provider event id (unique) and processed idempotently; a success whose amount differs from the
payment is not applied and is flagged for review. A second successful payment for a booking that
is already paid is flagged for refund. The mock is refused in production unless
`ALLOW_MOCK_PROVIDERS=true`, like every other mock adapter.

### Documents

E-tickets and hotel vouchers are PDFs generated with pdf-lib (no native dependencies), carrying a
QR code of the booking reference. They are stored through an `ObjectStorage` interface; the only
adapter today writes to the local filesystem and is refused in production (S3 or GCS arrives with
infrastructure in phase 12). The API streams documents only to the booking's owner or guest-token
holder. Names on documents use the passport (machine-readable) form, which also keeps the PDF within
the standard fonts.

### Extras

Extra checked baggage is sold where the supplier returns it (the mock does; Duffel's services
arrive when the adapter requests them). Seat maps wait for a supplier that supports them. Service
prices are converted to the booking currency without markup; fees and markups apply to the fare.

## Consequences

- Phase 6 adds Paystack, Flutterwave and Stripe adapters behind the same interface, holds,
  installments, refunds and the ledger, and turns the "flagged for refund" cases into automatic
  refunds.
- The booking page for guests depends on a token kept in the browser tab; the confirmation email
  carries the reference and documents until booking lookup arrives with accounts (phase 9).
