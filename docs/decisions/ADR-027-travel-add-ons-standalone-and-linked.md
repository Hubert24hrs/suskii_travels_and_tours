# ADR-027: Travel add-ons, standalone and linked

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec lists travel insurance, airport transfers, eSIM, lounge access, extra baggage and seat
selection, "purchasable standalone or attached to a booking". The homepage add-ons form (phase 4)
offers a type with destination, dates and travellers, or "add to an existing booking" by booking
reference and last name. Existing bookings may be paid, on a payment plan or refunded, and their
ledger balance is what they have paid.

## Decisions

1. **Own booking, optionally linked.** An add-on purchase is its own booking (vertical
   `travel_addons`) with an optional `linked_booking_id`. Payment, refunds and cancellation stay
   per booking, so a paid flight booking, its plan and its ledger are never reopened. The linked
   booking's page lists its add-ons and the add-on's page names the booking it belongs to.
2. **Attaching.** From the booking page (owner or guest token), or by reference and last name
   (rate-limited like other lookups, same answer for a wrong reference or name). The lookup only
   returns what add-ons need (destination city, dates, traveller counts), never personal data;
   the new add-on booking is then quoted for that trip.
3. **Catalogue.** Insurance, airport transfers, eSIM and lounge access are in-house products
   (ADR-025) priced per person, per booking, per day or per person per day, with the details each
   needs collected at checkout (transfer: flight number and arrival time; insurance: every
   traveller's date of birth). Operations fulfil them with partners; the booking is confirmed on
   payment with a voucher, and staff can record the partner's reference later.
4. **Extra baggage and seats.** Extra baggage is an airline ancillary sold at flight checkout
   through the supplier (phase 5); choosing it in the add-ons form leads to the flight booking.
   Seat selection needs a supplier with seat maps and is deferred to that supplier decision.

## Consequences

- No partial changes to paid bookings; each add-on can be cancelled or refunded on its own.
- Partner selection for insurance, transfers, eSIM and lounges is an owner decision; products stay
  empty in production until entered.
