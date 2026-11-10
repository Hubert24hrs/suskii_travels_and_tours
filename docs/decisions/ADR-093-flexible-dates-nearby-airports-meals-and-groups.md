# ADR-093: Flexible dates, nearby airports, meal requests and group requests

- Status: Accepted
- Date: 2026-11-09
- Deciders: the owner (asked for the features in `docs/audits/feature-parity.md`), Claude Code
  (implementer)

## Context

The owner's feature lists for flights ask for flexible dates, cheapest date suggestions, nearby
airports, meal preferences where supported, group reservations and other flights after a
disruption. The audit found each missing or partly built: the search form already had a
"Flexible dates (± 3 days)" box that changed nothing, a booking takes nine travellers at most, and
nothing recorded a meal. This record covers part 1 of `docs/phases/feature-parity.md`.

## Decision

### Flexible dates: one cached search per day, only when asked

`POST /v1/flights/date-prices` takes a one-way or return search and answers the lowest total for
all travellers on the days around it (`FLEXIBLE_DATES_DAYS` each side, 0 to 3, default 3).

- **Each day is an ordinary search** through `FlightSearchService.resolve()`, so it shares the
  search cache, the circuit breakers and the pricing rules. The price is what the results page
  would show for that day: nothing is stored and nothing is estimated.
- **A return trip keeps its length.** Both dates move by the same number of days. Days in the
  past or beyond the booking horizon are left out. Multi-city searches get no days.
- **Only on request.** Up to six extra supplier searches per call is real cost and counts against
  the supplier's look-to-book terms, so clients call it only when the traveller ticks
  "Flexible dates" or presses "See prices on nearby days" (`flex=1` in the URL). The route has its
  own limits (6 a minute and 200 a day per address) and runs three days at a time.
- **A failed day is not an error.** A day whose supplier cannot answer comes back `unavailable`
  and reads "Check price"; `none` means the day has no flights.

### Nearby airports: from the catalog, as links

`GET /v1/catalog/airports/{iataCode}/nearby` lists large and medium airports with scheduled
service within `radiusKm` (20 to 300, default 150), nearest first, by great-circle distance over
the catalog's coordinates. Clients show them under the results as the same search from or to that
airport. No fare is fetched for them: the link is a search the traveller chooses to run.

### Meal requests: only where the fare takes one

A passenger may carry one of seven requests (`MEAL_REQUESTS`, mapped to the airline codes VLML,
VGML, MOML, KSML, GFML, DBML and CHML).

- **Supplier-led.** An offer says whether it takes requests (`mealRequests`). The mock airline
  does on international flights. The Duffel adapter does not set it: Duffel's order API has no
  field we have confirmed for special meals. Where the fare takes none, checkout shows no choice
  and says to ask the airline with the booking reference, rather than collecting a preference we
  cannot pass on.
- **Checked on the server.** A meal on a fare that takes none, for a lap infant, or a child's
  meal for an adult is refused (`passengers-invalid`, issues `meal_unavailable` and
  `meal_not_for_passenger`).
- **A request, not a promise.** The copy says so at checkout, and the itinerary PDF prints
  "meal requested" with the code.
- **Sensitive.** Halal, kosher and diabetic meals can reveal religion or health. The value is
  stored on `booking_passengers.meal_request`, shown only with the booking, left out of logs,
  audit metadata, analytics and ad events, and cleared with the passenger's other details on
  deletion and retention.

### Group requests: a support conversation, not a booking flow

Airlines price ten travellers or more through their group desks, with deposits and name
deadlines that differ per airline. `POST /v1/flights/group-requests` therefore starts a support
conversation (ADR-083) whose first message is the request in a fixed layout, and the team
answers there.

- **A topic, not a category.** `support_conversations.topic` is a nullable text column with one
  value, `group_booking`. Adding a value to the category enum would break the revision still
  serving during a release (expand/contract); a nullable column does not. The console inbox
  filters by topic.
- **Validated like a search.** Airports must exist in the catalog and dates must be in range;
  10 to 500 travellers. Guests pass the same bot check and give an email, as for any conversation.
- **People answer.** The after-hours assistant (ADR-085) is not consulted on a conversation with
  a topic: it has no group fares to cite.

### Other flights after a disruption: a link to the booked search

Beside the refund offer for a significant airline change (ADR-073), the booking shows "See other
flights on this route": the search the booking came from. It is only a search. The refund and
the new booking stay two steps the traveller takes, so the rules of ADR-073 (the airline cancels
first; we never fund a refund) are untouched. Rebooking in one step would need the airline's
change API and is not built.

## Consequences

- **API contract.** Additive only: `mealRequests` on a flight offer, `meal` on a booking
  passenger (optional in requests, default none), `topic` on a conversation, and three new
  routes. App builds that predate them ignore the new fields.
- **Search volume.** A traveller who asks for flexible dates costs up to seven searches instead
  of one. The limits above and the shared cache bound it; `FLEXIBLE_DATES_DAYS=0` turns the
  feature off.
- **Group requests need people.** They wait in the support inbox like any conversation and follow
  its SLA timers (ADR-083).

## For the owner

- One Duffel sandbox booking to confirm how Duffel takes special meal requests (if at all), then
  the adapter can set `mealRequests`.
- Who answers group requests, and each airline's group desk contact.
- Counsel's view on whether a meal request is special-category data in each market
  (`docs/compliance/privacy-obligations.md`), and the matching answer on the store forms.
