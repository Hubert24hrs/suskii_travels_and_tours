# ADR-104: Indicative prices and assisted quotes

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked that prices found on the web be usable by the agent), Claude Code
  (implementer)

## Context

A price read from a web page (ADR-102) is something seen at a moment on someone else's site. It
is not an offer Suskii holds, it may have changed, and no supplier call stands behind it. The
booking pipeline sells only `Offer` rows re-checked with their supplier before payment (ADR-014).

## Decision

### An indicative price says what it is

Web prices enter results under the supplier name `web-intel` with `indicative: true`, the source
and the time read. Clients show **"Seen on {date} on {source}. We confirm the live price before
you pay."** and a confidence label. The word "confirmed" is never used for one, and it has no
"book" button.

### It is sold only through an assisted quote

"Get this price confirmed" creates an `AssistedQuote`: what the traveller wants (product, place,
dates, travellers), the observation it came from and its reference price.

1. **Requested.** It joins the approvals queue. The agent may prepare the check; it does not
   perform it.
2. **Verified by a person.** Staff confirm the live price and availability with the supplier
   and attach evidence. If it cannot be had, the quote closes as `unavailable` and the traveller
   is told.
3. **Offered.** The API creates an ordinary `Offer` (supplier `suskii`, item kind `assisted`)
   priced by `PricingService`, valid for `ASSISTED_QUOTE_VALID_MINUTES` (default 120).
4. **Accepted and paid.** The traveller books and pays through the existing checkout and
   payment pipeline, with its idempotency key, re-check and risk review.
5. **Booked by staff.** Staff book with the supplier and record the supplier's confirmation
   reference with evidence. Only then does the booking move to `CONFIRMED`, through
   `BookingTransitions.apply()`. If the supplier's price moved, the existing price-consent step
   applies; if it cannot be booked, the booking goes to `REFUND_PENDING` and is refunded in full.

No booking status is added: `PRICED`, `AWAITING_PAYMENT`, `PAID`, `CONFIRMED` and the refund
states already express the flow, as they do for in-house products fulfilled by staff (ADR-028).

### What the quote costs

The verified supplier price plus a service fee from a `FeeRule` (`assisted_quote`), never below
the verified supplier price. The observed web price is only a reference shown to staff. Whether
to earn by fee or by margin is the owner's decision; this is the default until they decide.

### Partners already in the affiliate catalogue

For those, the traveller is sent to the tracked link (`/v1/go/{token}`) and books with the
partner (ADR-069). An assisted quote is for suppliers Suskii books itself.

## Rejected

- **Selling the web price directly.** It would promise a price nobody has checked.
- **Letting an agent verify and book.** Booking with a supplier and stating that it succeeded are
  not things an agent may do (ADR-107).
- **A new booking status for "being quoted".** The quote is its own record until an offer exists.

## Consequences

- Assisted quotes need people on shift; the queue shows its age, and travellers are told when to
  expect an answer.
- A quote that goes unanswered expires and says so.
- The service fee, the validity time and who works the queue are in the owner checklist.
