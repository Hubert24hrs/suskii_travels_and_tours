# ADR-065: Airline schedule changes on ticketed flights

- Status: Accepted
- Date: 2026-10-26
- Deciders: Claude Code (implementer), pending owner review

## Context

Airlines often change ticketed flights: new times, a new flight number, or another routing.
Nothing told us or the traveller. The booking page and the e-ticket kept the old times, check-in
reminders went out for the old departure, and nobody could accept the change.

Duffel records every change the airline makes to an order (`airline_initiated_changes`):

- `removed` holds the changed slices as they were, and `added` the slices that replace them.
- `available_actions` says what can be done through the API (`accept`, `cancel`, `change`,
  `update`).
- `action_taken` says how the change was resolved, here or in Duffel's dashboard (`accepted`,
  `cancelled`, `changed`).

`GET /air/orders/{id}` returns the order's current slices together with its changes, and
`POST /air/airline_initiated_changes/{id}/actions/accept` accepts one. The API has no call to
read a single change. Duffel can send webhooks for changes, but we have no webhook endpoint for
Duffel, and a missed webhook would leave a traveller uninformed.

## Decision

### Supplier contract

`FlightSupplier` gains three members. Their defaults report nothing, so suppliers without
support are never checked.

- `tracksChanges`: whether the supplier reports airline changes.
- `orderChanges({ orderId, offer })`: returns `{ slices, changes }`, which are the order's
  flights now and every change, each with `removed`, `added`, `acceptable` and `actionTaken`.
- `acceptAirlineChange({ orderId, offer, changeId })`: accepts a change and returns the order as
  it is then. It must be safe to repeat.

The Duffel adapter works as follows:

- **One call per check.** It reads the order once.
- **Unreadable changes stay visible.** A change whose slices cannot be read is reported with
  empty slices and `acceptable: false`, so it goes to support. Nobody should accept what they
  cannot see.
- **Unreadable orders fail the check.** An order whose own flights cannot be read fails the
  check, which runs again later.
- **Failed acceptances are re-checked.** When an accept call fails or times out, the adapter
  reads the order. A change that Duffel accepted anyway counts as done, as cancellations do
  (ADR-064).

The mock moves the first flight of ticketed orders on routes named in
`MOCK_SCHEDULE_CHANGE_RULES` (`LOS-ABV:90`). It does so once per order, on the first check, and
only before departure. Test hooks let tests make acceptances fail or change a change's state.

### Polling, not webhooks

- **Who is checked.** Ticketing books the first check of every flight order whose supplier
  tracks changes, in `booking_items.next_change_check_at`.
- **The sweep.** The worker's one-minute booking sweep calls
  `POST /v1/internal/bookings/schedule-changes-due`. That route checks due items, oldest first,
  at most `SCHEDULE_CHANGE_BATCH_SIZE` (10) per run. It starts no new check after 20 seconds.
- **Scheduling.** The next check is booked before the supplier is called, at
  `SCHEDULE_CHANGE_CHECK_HOURS` (6). An order the supplier keeps failing therefore never blocks
  the others.
- **When checks stop.** They stop (null) once the booking is no longer `CONFIRMED`, the last
  flight has left, or the supplier no longer tracks changes.
- **Older orders.** The migration makes flights ticketed before this release due at once. The
  first sweeps stop checking those that have already flown.

Polling costs one supplier call per live order every six hours, at most 600 calls an hour with
the defaults. It needs no new public endpoint or webhook secret. Webhooks can be added later to
make a check due sooner.

### Storage and the itinerary

- **One row per change.** Each change is stored in `flight_schedule_changes`, unique per
  supplier and supplier change id. The row holds `removed` and `added` in our slice shape,
  `acceptable`, and `status` (`open`, `accepted`, `cancelled`, `changed`) with `resolved_at`.
- **What the rows hold.** Flight numbers, airports and times: no personal data. The rows follow
  the booking's retention (`DATA_REGISTRY`: retain with the booking).
- **Concurrency.** Syncing takes a row lock on the booking item, so a sweep and an acceptance
  never interleave.
- **When the itinerary moves.** The booking keeps the booked flights while a change is open, so
  the traveller sees what they agreed to next to what the airline proposes. Once no change is
  open, the booking's slices follow the airline's order when they differ (flights, airports or
  times). This happens whether the change was accepted by the traveller, by support or by
  Duffel. The e-ticket is then rendered again, and the change is audited
  (`booking.itinerary_updated`).
- **Audit actions.** `booking.schedule_change_detected` (system),
  `booking.schedule_change_accepted` (the traveller) and `booking.schedule_change_resolved`
  (resolved elsewhere). Metadata holds ids and states only.

### Telling people

- **The traveller.** Each new change is emailed to the booking's contact (`schedule-changed`)
  and pushed to the booking's devices (`schedule-changed`, opening the trip). The email lists
  each changed flight, old and new times in airport local time, and what to do next: accept
  online, wait for support, or nothing (already accepted). It is a booking message, so it is
  always sent; guests get an access link valid until the changed flights have left.
- **Operations.** Operations (`OPS_ALERT_EMAIL`) are alerted with ids only when:
  - a change cannot be accepted online (`airline.schedule_change`);
  - an open change becomes unacceptable;
  - the airline resolved an open change by cancelling or changing the order elsewhere
    (`airline.schedule_change_resolved`). The booking then needs a person.

### Accepting

- **The route.** `POST /v1/bookings/{bookingId}/schedule-changes/{changeId}/accept` loads the
  booking through `BookingsService.load()` (owner or guest token; anything else answers 404) and
  takes a per-booking Redis lock.
- **Supplier first.** The supplier accepts first; then the change is closed and the itinerary
  moves in one transaction.
- **When it is refused.**
  - 409 `schedule-change-not-acceptable` when the change is not open, cannot be accepted online,
    the booking is not `CONFIRMED`, or the supplier refuses.
  - 503 when the supplier cannot be reached. The change stays open and can be tried again.
- **Repeating.** Accepting an accepted change answers the booking.
- **Cancelling instead.** This stays on online cancellation (ADR-064) when `flightCancellable`,
  or with support. Airlines usually refund a significant change in full, and the refund quote
  shows what this airline offers.

### Clients

- **The booking.** It shows `scheduleChange`, the latest change, with `previous` and `updated`
  slices. The field is additive, so older app builds ignore it.
- **The banner.** The website's booking page and the app's trip screen show an open change as a
  banner:
  - the booked and new times side by side;
  - "Accept new times" when it is acceptable (never offline in the app);
  - otherwise, a note that support will be in touch.

## Sandbox results

Duffel's documentation could not be reached from the build container, so it is not known
whether test mode can simulate an airline change. The sandbox check (`duffel-sandbox.yml` with
`book`) reads its paid order back through `orderChanges()`. It fails if that read fails or if
the order's flights differ from the booked offer. This proves the order read and slice mapping
against Duffel. Acceptance against Duffel can only be checked on a real change, so it is covered
by the unit tests (shaped after the SDK's types) and the e2e tests on the mock.

## Consequences

- **More Duffel calls.** One call per live order every six hours, and two per acceptance (accept,
  then read the order). The batch size and interval are settings.
- **Delay.** A change is found up to `SCHEDULE_CHANGE_CHECK_HOURS` after the airline makes it.
  Webhooks would shorten this.
- **No console view.** The admin console does not show changes yet. Operations get the email
  alert and resolve the change in Duffel's dashboard; the next check mirrors the result.
- **Open questions for the owner:**
  - whether to shorten the interval close to departure;
  - whether staff need a console view and actions for changes;
  - whether to register Duffel webhooks for faster detection.
