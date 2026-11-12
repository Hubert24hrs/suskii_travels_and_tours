# ADR-063: Checked bags on Duffel flights

- Status: Accepted
- Date: 2026-10-26
- Deciders: Claude Code (implementer), pending owner review

## Context

Travellers could add a checked bag only on mock flights. The Duffel adapter refused every extra
("Duffel extras are not supported yet"), and the app had no bag picker for any supplier.

Our extras model comes from ADR-014. A flight offer lists `FlightService` entries, each one bag
of a given weight for one passenger and the whole trip, with a per-passenger maximum. A booking
sends `{ serviceId, passengerIndex, quantity }`. Extras are sold at supplier cost, never
discounted, and holds and installments are not offered with them.

Duffel models bags differently:

- **Only on a single offer.** Search results carry no extras. A single offer fetched with
  `return_available_services=true` lists them in `available_services`.
- **Per passenger and per segment.** Each service names one passenger (`passenger_ids`) and the
  segments it covers (`segment_ids`). The cover can be one segment, a slice or the whole trip.
  `metadata` gives the type (`checked` or `carry_on`) and `maximum_weight_kg`.
- **Ordered by id.** An instant order sends `services: [{ id, quantity }]`, and the balance
  payment must cover the fare plus the services.

## Decision

### From Duffel's services to our extras

- **One passenger's bag for the whole trip.** For each passenger and weight, the adapter takes
  checked-bag services that together cover every segment of the offer exactly once. The widest
  services come first, then the cheapest. The bag's price is the sum of those services, and its
  limit is the lowest of their `maximum_quantity`.
- **Services that are not sold.** These are left out:
  - a service that names several passengers;
  - a service on a segment the offer does not have;
  - a weight that is unknown or not a whole number;
  - a price in another currency than the fare;
  - carry-on bags and any other service type;
  - an offer whose segments carry no ids.
- **One extra per weight.** A weight becomes our extra only when every passenger with a seat can
  add it at the same price. Lap infants cannot add bags (ADR-014). Its limit is the lowest
  passenger's.
  - The id is `<offer id>.bag<weight>`, so a re-check of the same offer keeps it.
  - Extras are sorted lightest first, then cheapest. The website and the app offer the first
    one.
  - A weight priced differently for a child is not sold. This is simpler than per-passenger
    prices, which our extras cannot express, and it never sells a bag at the wrong price.

### When extras are loaded

- **Quote.** The Duffel quote already searches again, because Duffel takes one order per offer
  request (ADR-062). It now also fetches the chosen offer with its services. That is what the
  checkout shows.
- **Quote time limit.** A quote can therefore take a search plus an offer fetch. The quote call
  gets twice `SUPPLIER_TIMEOUT_MS`. The search itself still asks Duffel to answer within the
  supplier timeout.
- **Re-check before payment.** This also fetches the offer with its services. The booking's bags
  match the fresh offer by id, or by type and weight. A bag that is no longer sold fails the
  booking before payment (`offer-unavailable`), as for any extra.

### Booking

- `book()` fetches the offer with its services again and rebuilds each passenger's bag from them.
- It refuses, with a request error, any bag that:
  - is gone;
  - is over its limit;
  - costs a different amount than the traveller paid.

  The booking pipeline then refunds. We never charge a different amount, as for the fare.

- The order sends every Duffel service of each passenger's bag with the chosen quantity. The
  balance payment is the fare plus the bags. Without bags the payment is the fare exactly as
  Duffel states it, as before.

### Clients

- **Website.** The website already offered bags from the quote's first extra. It needs no
  change.
- **App.** The app gains the same picker:
  - chips per traveller with a seat (`passengers.<n>.bags-<count>`);
  - an extra baggage line and the new total in the summary;
  - `extras` in the booking request.

  Reserving and installments are switched off while bags are chosen, as on the website. The copy
  is the website's (`checkout.bagFor`, `checkout.bagOption`, `checkout.extrasLine`).

## Sandbox results (2026-10-26)

From `duffel-sandbox.yml` (flights, `book`, `journey`) against Duffel's test mode, LHR to JFK:

- **What Duffel offers.** Duffel Airways (ZZ) lists one checked 23 kg bag on the offer's single
  segment, at US$20.00, at most one per passenger. The adapter sells it as one 23 kg bag at
  US$20.00, up to one.
- **The adapter's order.** An order with one bag was booked from the balance, with an airline
  reference and an e-ticket, then cancelled.
- **Our API journey.** Search, then a quote listing the bag (NGN 31,000 at the test exchange
  rate), then a guest booking with one bag and mock payment. It ended `CONFIRMED`, and the
  traveller shows one extra bag.

## Consequences

- Duffel travellers can add checked bags on the website and in the app. The app needs a new build
  for the picker.
- **Cost.** Each Duffel quote makes one more Duffel call (the offer fetch), and so does each
  re-check. The worst-case quote wait doubles, to 20 s with the default settings.
- **Only one bag size on screen.** Clients offer only the lightest bag. A heavier one that Duffel
  also sells is listed in the quote's extras, but no client offers it yet.
- **Bag receipts are not shown.** Duffel may issue an EMD document for a bag. We record e-tickets
  only, and the booking shows the bag count per traveller.
- **Mixed prices are not sold.** Offers whose bag price differs between passengers sell no bag
  of that weight. If real traffic shows this is common, per-passenger extras would need a change
  to the extras contract.
