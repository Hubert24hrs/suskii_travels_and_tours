# ADR-064: Online cancellation of ticketed flights

- Status: Accepted
- Date: 2026-10-26
- Deciders: Claude Code (implementer), pending owner review

## Context

Travellers could cancel unpaid bookings, payment plans and in-house products online (ADR-018,
ADR-028), but a ticketed flight went "through support". Nothing cancelled the order with the
airline either: staff would have had to do it in the supplier's dashboard and refund by hand.

Duffel cancels in two steps:

1. `POST /air/order_cancellations` opens a pending cancellation. It states the refund, where the
   refund goes (`refund_to`: `balance`, airline credits, a voucher and so on) and an expiry.
2. `POST /air/order_cancellations/{id}/actions/confirm` cancels the order.

Holds already used the same two calls (ADR-018). Instant orders were booked without keeping
Duffel's order id.

## Decision

### Supplier contract

- **The order id is kept.** `FlightBookingResult.orderId` returns it, and ticketing stores it in
  `booking_items.supplier_order_id`. Held orders already stored it.
- **Cancellation methods.** `FlightSupplier` gains:
  - `cancelsOnline`;
  - `cancellationQuote({ orderId, offer, supplierTotal })`, which returns `{ quoteId, refund,
refundToBalance, expiresAt }`;
  - `confirmCancellation(quoteId)`, which must be safe to repeat.

  The defaults refuse, so other suppliers keep going through support.

- **Duffel.** A failed or timed-out confirmation asks Duffel for the cancellation's state. A
  cancellation Duffel did confirm counts as done, so a retry never errors on finished work.
- **Mock.** Refundable fares refund what we paid less the fare's refund penalty; other fares
  refund nothing. A test hook makes confirmations fail.

### Flow (API)

1. **Who can cancel online.** A booking shows `flightCancellable` when it is a ticketed flight
   (`CONFIRMED`, order id stored), its supplier cancels online, and the first flight has not
   left.
2. **Refund quote.** `POST /v1/bookings/{id}/cancellation-quote` opens the supplier's pending
   cancellation. It is refused (409 `not-cancellable`, support takes over) when:
   - the refund is not money back to our balance (credits, vouchers);
   - the refund is in another currency than we paid;
   - the quote lapses within a minute;
   - the supplier will not cancel the order.

   Otherwise the traveller's refund is kept in Redis with the supplier's quote id, for the
   quote's life and at most 30 minutes. The answer shows `refund`, `kept` and `expiresAt`. The
   route allows 10 quotes per 10 minutes per IP, because each quote opens a cancellation with
   the airline.

3. **Cancel.** `POST /v1/bookings/{id}/cancel`, with the quoted `refund`, takes a per-booking
   Redis lock and confirms with the supplier first. Nothing is refunded unless the airline has
   cancelled. Then, in one transaction:
   - the booking is locked and must still be `CONFIRMED`;
   - what is not refunded is posted as a cancellation fee;
   - the refund goes through `refundBookingBalance` (`REFUND_PENDING`), or the booking is
     withdrawn when the refund is zero (`CANCELLED`);
   - `booking.flight_cancelled` is audited, with amounts and ids only.
4. **When cancel is refused:**
   - 409 `cancellation-quote-expired` for a missing quote, a lapsed quote or a different
     `refund`;
   - 503 when the supplier cannot be reached (the booking stays `CONFIRMED`, and the quote can
     be used again).

### The traveller's refund

- **The rule.** The traveller gets the share of what they paid that the airline refunds of what
  we paid it: `paid × airline refund ÷ supplier total`. The supplier total is the fare plus any
  paid bags.
  - Rounded down, and never more than they paid.
  - The exchange rate cannot push it over: the ratio is taken in the supplier's currency.
- **What this means.** A full airline refund returns everything, our markup and fees included.
  A partial one returns the same share of everything. No extra cancellation fee is charged; the
  owner may want one (open question).
- **Why this rule.** It is simple, the traveller can check it, and it never refunds money we did
  not get back.

### Clients

- The website's booking page and the app's trip screen show "Cancel flight". It asks for the
  quote, then shows:
  - the refund, or that the fare refunds nothing;
  - what is kept;
  - until when the offer stands.

  The traveller confirms exactly that refund.

- **`cancel` request body.** The API accepts an optional body (`{ refund? }`), and an empty one
  still works, so older app builds keep cancelling unpaid and in-house bookings. Current
  clients send `{}` for those.

## Sandbox results (2026-10-26)

From `duffel-sandbox.yml` (flights, `book`, `journey`):

- **The adapter.** For an order of a Duffel Airways fare plus a 23 kg bag (US$238.34), Duffel
  quoted US$238.34 back to the balance, valid for 60 minutes. Confirming cancelled the order.
- **Our API journey.** A booking paid NGN 341,480.50, ended `CONFIRMED`, and showed
  `flightCancellable`. The quote offered a full refund with nothing kept, held for 30 minutes.
  Cancelling moved the booking to `REFUND_PENDING`, with a refund of NGN 341,480.50.

Duffel's test airline refunds everything, so partial refunds, credits and other currencies are
covered only by the unit and e2e tests (mock supplier).

## Consequences

- **More Duffel calls.** One call per refund quote, and one or two per cancellation.
- **When the books disagree.** If the airline cancels but our transaction then fails (the
  booking changed in between), the error is logged and reported:
  `Flight cancelled with the supplier but not on the booking`. Staff then settle the booking by
  hand (supplier outage runbook). The lock and the status check make this rare.
- **Older bookings.** Instant orders booked before this change have no stored order id. They are
  not `flightCancellable` and stay with support.
- **Open questions for the owner:**
  - an optional cancellation service fee on top of the airline's terms;
  - whether to offer airline credits to travellers when Duffel refunds as credits (today these
    go through support);
  - whether staff need a console action for supplier cancellations.
