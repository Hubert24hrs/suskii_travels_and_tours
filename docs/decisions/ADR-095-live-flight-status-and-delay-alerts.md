# ADR-095: Live flight status and delay alerts

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for "automatic flight status tracking" and "flight delay and
  cancellation alerts" in `docs/audits/feature-parity.md`), Claude Code (implementer)

## Context

Ticketed flights were already checked for airline schedule changes every few hours (ADR-065):
a new time or a cancellation the airline records on the order, days or weeks ahead. Nothing
followed a flight on the day itself: a two-hour delay at the gate, a gate change or a
cancellation that morning reached the traveller only from the airport screens. Day-of status is
not in the booking supplier's order data; it comes from flight-data providers (the airline's
operational feed, resold). This record covers part 3 of `docs/phases/feature-parity.md`.

## Decision

### A provider interface, with the mock until the owner has an account

`FlightStatusProvider.status(flights)` takes booked flights and answers, for each, its state
(scheduled, delayed, boarding, departed, landed, cancelled, diverted), expected departure and
arrival, terminals, gates and the baggage belt, or nothing for a flight it does not know.

- **Only the flight leaves our systems.** A query holds the airline code, the flight number,
  the two airports, the local day of departure and the scheduled times. No traveller, booking
  or contact detail reaches a status provider, and the test suite asserts the query's keys.
- **`FLIGHT_STATUS_PROVIDER`** is `none` (default: nothing is read, no alert is sent, bookings
  show their booked times) or `mock`. Production refuses the mock unless `ALLOW_MOCK_PROVIDERS`,
  as for every provider: it invents times. A real adapter is one class and one enum value once
  the owner has chosen a provider.
- **The mock** runs every flight on time through its day, with a stable terminal and gate;
  `MOCK_FLIGHT_STATUS_RULES` (`LOS-KAN:delayed:45`, `LOS-LHR:cancelled`) makes a route late,
  cancelled or diverted so the journey can be walked through locally and on the test server.

### A flight is followed from a day before it leaves until it has landed

- Ticketing sets `booking_items.next_status_check_at` for a new flight booking:
  `FLIGHT_STATUS_WINDOW_HOURS` (24) before its first flight leaves.
- The worker's sweep (`POST /v1/internal/bookings/flight-status-due`, every minute) reads the
  trips that are due, at most `FLIGHT_STATUS_BATCH_SIZE` (25) a run with one provider call per
  trip, then books the next reading: every `FLIGHT_STATUS_CHECK_MINUTES` (15) while a flight is
  followed and has not finished, at the start of the next flight's window (a return leg), or
  never once every flight has landed, was cancelled or was diverted. A flight is followed until
  six hours after its scheduled arrival.
- The last reading of each flight is one row in `flight_statuses` (no personal data). A reading
  for a flight the airline has since replaced (ADR-065) is ignored and overwritten.
- A booking that is no longer confirmed stops being followed.

### What the traveller sees

`GET /v1/bookings/{bookingId}/flight-status` (the owner's session or the guest token, 404 for
anyone else) answers every flight of the booking with what is known. A flight that is not
followed yet reads `scheduled` with `checkedAt` null. A read refreshes the reading when it is
older than `FLIGHT_STATUS_CACHE_SECONDS` (120), so a traveller watching the page costs at most
one provider call every two minutes however often their client asks.

The website's booking page and the app's trip screen show a "Flight status" card once a flight
is followed: the state, the expected time with how late that is and the booked time, terminal
and gate, the baggage belt after landing, and when it was last read. They ask once a minute
while the page is in view and a followed flight has not finished. Before that, and when status
is off, the card is absent: the page looks as it did.

### Alerts: once, and again only when it matters

Every reading, from the sweep or from a traveller's read, is stored under a lock on the booking
item, where `flightAlert()` (`@suskii/shared`) decides whether the traveller is told:

- **Cancelled or diverted**: once.
- **Delayed**: before departure, when the expected delay reaches `FLIGHT_DELAY_ALERT_MINUTES`
  (30), and again each time it moves by `FLIGHT_DELAY_ALERT_STEP_MINUTES` (15) from what the
  traveller was last told. A delay that shrinks is told as "now leaves earlier": that is the one
  that makes people miss flights.
- **Back on time**: when a delay the traveller was told about has gone.
- **Gate changed**: when a departure gate replaces a known one.

One reading gives at most one alert, the most serious first, and nothing is sent once the flight
has left. An alert is an email to the booking contact (the flight, the times, the gate) and a
push to the booking's devices that says only that something changed (ADR-022). These are service
messages about a trip in progress, so they are not subject to marketing preferences.

A day-of cancellation here is information, not a refund decision: the refund offer of ADR-073
still comes only from the airline's change on the order, which the schedule-change sweep finds.
The alert says to open the booking or contact us.

## Consequences

- **API contract.** Additive only: one route and one internal route. App builds that predate
  them do not call it.
- **Cost.** A followed trip costs about 100 provider calls for a one-way (a day at four an
  hour), less once it lands. `FLIGHT_STATUS_WINDOW_HOURS`, `FLIGHT_STATUS_CHECK_MINUTES` and
  `FLIGHT_STATUS_BATCH_SIZE` bound it; the owner tunes them to the provider's plan.
- **A provider outage changes nothing.** A failed reading keeps the last one, sends no alert and
  is tried again at the next check.
- **A flight moved more than a day earlier** by the airline is first read when its old window
  would have opened. Such a move is a significant schedule change the traveller is told about
  through ADR-065.
- **Texts are not sent.** A delay alert by text would reach travellers without data at the
  airport; it costs per message and needs the owner's decision (ADR-091).

## For the owner

- A flight-data provider and plan (for example Cirium, OAG, FlightAware AeroAPI or
  AeroDataBox), then its adapter and `FLIGHT_STATUS_PROVIDER`.
- Whether delay alerts should also go by text or WhatsApp, and the delay worth telling
  (`FLIGHT_DELAY_ALERT_MINUTES`, default 30).
