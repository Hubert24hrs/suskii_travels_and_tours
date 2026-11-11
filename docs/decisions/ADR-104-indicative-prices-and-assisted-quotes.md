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

## Amendments made while building it

- **An indicative price is shown by the assistant, not in search results.** Search, booking and
  payment never import price intelligence (ADR-102), so no result list carries a `web-intel`
  row. The tool `prices.indicative` reads at most two approved sites for one question and
  returns at most five prices, each with where and when it was seen and `indicative: true`; its
  cards carry the same mark and no link to book. `quotes.request` asks for one to be confirmed
  and `quotes.list` reads the answers. A client that shows indicative prices outside the chat
  would call the same reads through a route of its own, which is not built.
- **A quote is an account's.** A request needs a session (a guest is told to sign in): the
  answer goes to a person, and the offer is bookable by that account only (404 for anyone
  else, also at the quote and at booking). An account has at most five requests open.
- **Routes.** `POST /v1/quotes/assisted` (with an `Idempotency-Key`), `GET
/v1/quotes/assisted/{id}` and `POST /v1/quotes/assisted/{id}/withdraw`; the list is `GET
/v1/me/assisted-quotes`, because `GET /v1/quotes/assisted` would be read as the quote with
  the id "assisted". Staff: `/v1/admin/assisted-quotes` (`?queue=to_verify|to_book|all`; `offer`
  and `close` with `ai:approve`; `booked` and `unbookable` with `bookings:manage`), every
  change audited.
- **The switch stops what is new, never the way out.** `ASSISTED_QUOTES_ENABLED` is on outside
  production and off in production unless set. Off, a traveller's routes answer 404, staff can
  make no offer, and an offer made before cannot be paid for (the re-check before payment
  refuses it). Staff still see the queue and can close a request, record a supplier's
  confirmation or mark a paid booking unbookable: turning the feature off must never strand a
  booking someone paid for.
- **Its own queue, counted in the approvals queue.** Verifying a price and booking by hand are
  work with their own forms, so they have their own list; the approvals queue (ADR-107) shows
  how many wait there (`alsoWaiting`) so one page still tells a person what is waiting.
- **Times.** A request nobody answered in `ASSISTED_QUOTE_REQUEST_HOURS` (48) closes as
  `expired`; an offer can be booked for `ASSISTED_QUOTE_VALID_MINUTES` (120). Both are checked
  when a quote is read, so a stale one is never shown as open.
- **The price.** The verified supplier price goes through `PricingService.pricer('assisted',
currency)`: converted when the supplier charges in another currency, plus the fee rules of the
  vertical `assisted` (code `assisted_quote`) and service tax, and never below the verified
  price. No rule is seeded, so until the owner adds one a quote earns nothing. The price seen
  on the web is kept on the quote as a reference with its source and time, shown to staff, and
  is never the price of the offer.
- **On the booking pipeline** the item kind and the vertical are `assisted`: for the account
  that asked only, never a company booking, never part of a payment plan, no PDF (the
  supplier's own confirmation is what the traveller travels on), no review.
- **After payment the booking waits for a person.** It stays in `TICKETING` and the ticketing
  sweep leaves it alone. Staff record the supplier's reference and where the proof is
  (`booked`), and only that moves it to `CONFIRMED`; or mark it `unbookable` with a reason from
  a list, which moves it to `REFUND_PENDING` and refunds everything automatically.
- **A price that moved after payment is not charged.** Before payment the re-check reads the
  quote, so an offer that lapsed or was withdrawn cannot be paid. Once the traveller has paid,
  there is no consent step for more: staff mark the booking unbookable, everything is
  refunded, and a new offer can follow.
- **What a quote holds**: a title in a few words, places, dates and head counts, never who
  travels (text that looks like a contact detail is refused). The traveller's names are on the
  booking, as for every booking. Quotes are in the export, deleted with the account when
  nothing is unsettled, and purged 400 days after they close.
