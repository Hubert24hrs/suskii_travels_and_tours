# ADR-094: Seat selection on flights

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for "seat selection where supported" in
  `docs/audits/feature-parity.md`), Claude Code (implementer)

## Context

Only buses had a seat picker. Airlines sell seats per flight and per passenger, at prices that
differ by seat and change until the order is made, and many sell none in advance. This record
covers part 2 of `docs/phases/feature-parity.md`.

## Decision

### The supplier says what can be chosen

`FlightSupplier.seatMaps(offer)` answers one map per flight of the offer (a flight is a segment,
numbered across all slices), or nothing. A map is rows of sections of seats; a seat has its
designator (`12A`), whether it can be chosen, the airline's price and what we know about it
(window, aisle, extra legroom, exit row). The default answer is "none", so a supplier sells seats
only once its adapter implements the call.

- **The mock airline** sells seats on every flight (a fixed layout per cabin, about a third
  taken, exit rows and window or aisle seats priced), so the test stack and the test app show the
  feature. Tests switch it off or take a seat through `sellsSeats` and `takenSeats`.
- **Duffel** reads `GET /air/seat_maps?offer_id=` for the offer it would book. A seat is offered
  only when every traveller with a seat can buy it at one price, so the map needs no price per
  traveller. The adapter is behind `DUFFEL_SEAT_SELECTION` (default off) until one sandbox booking
  with a seat confirms the order payload; off, Duffel flights answer no map.

### Loaded when asked, for a quote

`GET /v1/quotes/{quoteId}/seat-maps` answers the maps for a flight quote, with prices in the
quote's currency (converted rounding up). It is a supplier call, so clients make it only when the
traveller presses "Choose seats", and it shares the quote route's limits. Nothing is held: a seat
is the traveller's only when the airline confirms the order.

### Stored with the booking item, beside the bags

`POST /v1/bookings` takes `seats: [{ flight, passengerIndex, designator }]`. The API reads the
map again and refuses (`422 seats-invalid` with a `reason`) a seat that is unknown or taken, a
seat chosen twice, two seats for one traveller on a flight, a seat for a lap infant, or an unknown
traveller or flight. The rules live in `seatChoiceIssue()` (`@suskii/shared`) so both clients
apply them before sending.

An accepted seat is stored in `booking_items.services` as
`{ type: 'seat', serviceId: 'seat:<flight>:<designator>', passengerIndex, quantity: 1, flight,
designator, price }`: no new table and no migration, and everything that already treats paid
extras with care treats seats the same way.

- **Price.** A seat is charged at the airline's price with no markup, as its own lines
  (`price.seats`) inside the total. Service tax follows the margin (ADR-072), and a seat has
  none.
- **No holds or installments.** A booking with a seat pays in full, as one with a paid bag does
  (ADR-063): the airline does not hold a seat price.
- **Checked again before payment.** The pre-payment re-check reads the map once more. A taken
  seat ends the booking like a sold-out bag (`410 offer-unavailable`, nothing is charged); a
  changed seat price is a price change the traveller agrees to.
- **Booked with the order.** Ticketing passes the seats to `book()` with the price paid; the
  supplier refuses the order when a seat has gone or its price moved, which goes down the
  existing failed-ticketing path (automatic refund).
- **Cancellation.** What we paid the supplier includes the seats, so the traveller's share of an
  airline refund (ADR-064) is computed over fare, bags and seats together.

Seats are not part of the quote's `services` list: clients read that list as "the bag on offer".

### Clients

The website's picker is a lazy chunk opened from a "Seats" section at checkout; the app's sits
under the traveller cards (nothing above them moves, which the Maestro flow depends on). Both
show one flight at a time, pick for one traveller at a time, name each seat for screen readers
("Seat 12A, window, ₦2,000"), keep 48 px targets, and add a "Seats" line to the price summary. The
map reads left to right in every language: seat letters name a side of the aircraft. The booking
page, the trip screen and the itinerary PDF list each traveller's seats.

## Consequences

- **API contract.** Additive only: one route, `seats` on the booking request (default none),
  `price.seats` and `passengers[].seats` on a booking (default empty). App builds that predate
  them ignore the new fields.
- **Supplier calls.** A traveller who opens the map costs one supplier call, a booking with seats
  one more, and its payment one more. Travellers who never open it cost none.
- **A seat can be lost between the map and payment.** The traveller is told and chooses again
  (before the booking) or the booking ends unpaid (at payment). We never book another seat in
  its place.
- **Changing or adding a seat after booking is not built.** It needs the airline's order change
  API; travellers use the airline's own "manage booking" with the booking reference.

## For the owner

- One run of the Duffel sandbox check with booking on (`sandbox:duffel --book`, or the
  `duffel-sandbox.yml` workflow): it reads the seat maps and orders one seat with the test
  ticket. When it passes, set `DUFFEL_SEAT_SELECTION=true`.
- Whether Suskii adds a fee to seats (none today: the airline's price is passed on).
