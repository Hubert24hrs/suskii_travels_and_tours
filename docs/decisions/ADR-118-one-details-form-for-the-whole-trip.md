# ADR-118: One details form for the whole trip

- Status: Accepted
- Date: 2026-11-13
- Deciders: the owner (asked for one details form for the whole trip, after ADR-117 left each
  prepared part with its own), Claude Code (implementer)
- Amends: ADR-117 (Ask Suskii puts the whole trip together), ADR-099 (combined trips)

## Context

With ADR-117, Ask Suskii puts the parts it prepared on one combined trip with one total. The
trip page then shows each prepared part with "Enter details", which opens that part's own
checkout. A traveller with a flight, a stay, a car, a transfer and insurance fills in five
forms and types the same names, dates of birth and contact details into each before the one
payment. ADR-117 listed one form for every part as the next step, and the owner asked for it.

## Decision

1. **One request books every prepared part.** `POST /v1/trips/{tripId}/book` (the caller's
   own trip, a session, `Idempotency-Key`, the booking rate limit) takes the contact once,
   every traveller once (one to nine, at least one adult), the transfer details once and the
   terms. `TripBookingService.book()` builds each prepared part's ordinary booking request and
   creates it with `BookingsService.create()`: every check, price, reservation and add-on rule
   of a single checkout applies unchanged. The trip is then paid once on its page, as before.
2. **Each part takes the travellers its quote was priced for**, in the order the trip lists
   its parts (the flight first):
   - a flight and an add-on (a transfer, insurance): the first adults, children and infants of
     the form, as many of each as the quote counts;
   - a stay: one lead guest per room, from the adults in order;
   - a rental car: the first adult, who shows the licence at pickup.

   A part priced for more travellers than the form names is refused with
   `trip-travellers-short`. A meal request goes with the flight alone, and a traveller is
   saved to the account once, with the first part that names them.

3. **All or nothing.** When one part refuses, the bookings this request made are cancelled
   again (reason `trip_booking_failed`), which releases package and tour seats and rental cars.
   The problem names the part (`part`), and a traveller's issue is moved from the part's own
   list to the traveller's place in the form (`issues[].index`), so the client marks the right
   field. Only when every part is booked does each join the trip (`TripsService.addPart()`,
   which drops its prepared entry and closes a checkout the trip had open).
4. **The form, on the website and in the app** (`/trips/{id}/details`, `/trips/built/{id}/details`),
   opened from the trip page's "Enter everyone's details once":
   - the travellers come from `tripFacts()` over each quote's `tripPartFacts()`
     (`@suskii/shared`): the most of each kind any part takes, the trip's whole span of dates,
     passports required when any part goes abroad and optional with a domestic flight;
   - the transfer's flight number and arrival time start from the flight the trip arrives on
     (`arrivingFlight()`), and the traveller can change them;
   - the parts with their quoted prices and the total with the prepared parts;
   - the checks of a single checkout (`validateCheckout()`) before anything is sent, and one
     `Idempotency-Key` per body, so a lost answer is never booked twice and a corrected form is
     a new request.
     The website's page is a private payment page (`noIndex`, our own scripts only, no "Ask
     Suskii" button); the app's screen is behind `RequireAccount` and `useSensitiveScreen()`.
5. **What the form leaves out**: checked bags, seats and meal requests (offered on the
   flight's own checkout, which "Enter details" on the trip page still opens), saved travellers,
   company bookings and payment plans, none of which a combined trip takes (ADR-099).
6. **The assistant says so.** The `trip_handoff` note now says the details are entered once
   for every part, in every language and on WhatsApp, and `platform.guide`'s combined trips
   topic describes the form. No prompt or tool changed, so the evals are unaffected.

## Consequences

- A trip Ask Suskii put together needs one form, then one payment.
- Nothing about booking or paying changed: each part is still an ordinary booking with its own
  terms, re-checked before payment, cancelled and refunded on its own. The trip holds no names.
- One quote that has run out stops the whole form. The message names the part, which the
  traveller chooses again from the trip page; nothing was booked.
- A part already booked from its own checkout stays as it is: the form books only what is still
  prepared.
- Tests: four API e2e cases (booked and joined, all or nothing with seats released, travellers
  short, nothing prepared), three app screen tests and a website e2e test. The website test
  answers the trip's prepared parts in the browser, because only the assistant's summary
  writes them; the booking itself is covered against the API.
- The phone check has no flow for it: its stack cannot prepare parts without the assistant's
  model.

## Alternatives considered

- **One booking with several items.** A booking can hold items, but every product's rules,
  suppliers, fulfilment and cancellation run per booking; mixing them in one would be the second
  booking flow ADR-099 refuses.
- **Book each part as soon as its details are complete, keeping what succeeded.** It would leave
  a trip half booked without the traveller asking for it. All or nothing is clearer, and an
  unpaid booking cancelled again costs nothing.
- **Bags and seats in the form.** They depend on one flight's offer and seat map; the flight's
  own checkout already does it well, and the trip page still opens it.
