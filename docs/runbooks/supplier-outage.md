# Supplier outage

**Alert:** `SupplierErrorRateHigh` (more than 20% of a supplier's calls failing for 10 minutes).
**Dashboard:** Suskii operations: supplier latency and errors.
**Background:** ADR-009 (suppliers and search orchestration), ADR-014 (booking lifecycle).

## What happens automatically

- **Search:** the search fans out to every enabled supplier within a 12-second budget, with 10
  seconds per supplier. A failing supplier drops out and the results are marked partial.
- **Circuit breaker:** per API instance, at least 5 calls with half failing in a minute open it.
  Calls are then skipped for 30 seconds, and one probe decides whether to close it again.
- **Quotes and booking creation:** these re-check the price with the supplier, so they fail for
  that supplier's offers. The traveller sees an error and can search again.
- **Ticketing:** runs in the worker. Retryable failures back off for 1, 2, 4, 8 and 16 minutes
  (`TICKETING_MAX_ATTEMPTS`, 6). After that the booking is refunded automatically, or sent to
  review when the supplier may have issued tickets anyway (see
  [Ticketing backlog](ticketing-backlog.md)).

## 1. Confirm (5 minutes)

1. Which supplier, and which operations fail? `suskii_supplier_calls_total` has `supplier`,
   `operation` and `outcome` (`ok`, `timeout`, `error`, `circuit_open`). The API log line
   `supplier search failed` carries the supplier and the reason.
2. Check the supplier's status page and its dashboard. Errors that start all at once with no
   incident on their side usually mean a revoked or expired token (`DUFFEL_API_TOKEN`): the
   supplier dashboard shows rejected requests.
3. Is it us? A spike in search volume can exhaust the supplier's quota. Check that the per-IP
   search quotas are holding (429s in the request log) and that the deal refresh runs on its
   schedule.

## 2. Mitigate

| Situation                                | Action                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Short outage (minutes)                   | Nothing. The breaker and partial results cover it; ticketing retries                                                                                                                                                                                                                                    |
| Credentials revoked or expired           | Rotate the token in the secret manager and redeploy ([Key rotation](key-rotation.md))                                                                                                                                                                                                                   |
| Long outage                              | Usually nothing: the open breaker already makes searches skip the supplier in milliseconds. Removing it from `FLIGHT_SUPPLIERS` or `HOTEL_SUPPLIERS` also stops ticketing, holds and payment re-checks for its existing bookings, so do that only when none of its bookings are in TICKETING or on hold |
| The only supplier for a vertical is down | Leave it enabled; searches show no results. Tell support, and post a notice through the CMS if the owner agrees                                                                                                                                                                                         |
| Bookings piling up in TICKETING          | Follow [Ticketing backlog](ticketing-backlog.md)                                                                                                                                                                                                                                                        |

Do not raise `SUPPLIER_TIMEOUT_MS` or `SEARCH_TIMEOUT_MS` to wait out a slow supplier: the spec's
12-second search budget protects every traveller's search.

## 3. Verify recovery

- The supplier's error ratio is back under 5% and latency is normal on the operations
  dashboard.
- Searches are no longer partial (`partial` in search logs) and quotes succeed.
- Bookings that were retrying ticketing have moved to CONFIRMED, or to refunds you have
  reviewed.

## 4. Afterwards

- Re-enable a supplier you removed, then watch one search cycle and the ticketing sweep.
- Deal and destination snapshots refresh on their next scheduled run. Run
  `pnpm --filter @suskii/worker refresh:once` to refresh them at once.
- Record how long the outage lasted and how many bookings it touched.

## Flight cancelled with the supplier but not on the booking

Online flight cancellation (ADR-064) confirms with the airline first and then updates the
booking. If that second step fails, the API logs and reports
`Flight cancelled with the supplier but not on the booking` with the booking id.

1. Look the booking up in the console and the order in the supplier's dashboard (the booking
   item's supplier order id). Confirm the order shows as cancelled there and note the refund
   the airline gave.
2. If the booking is still `CONFIRMED`, refund the traveller's share from the console (refunds,
   maker-checker), using the `booking.flight_cancelled` rule: what they paid times the airline's
   refund divided by what we paid the airline, rounded down. Record the reason.
3. If the booking had changed for another reason (a staff refund already running), reconcile the
   two refunds before approving anything, so the traveller is never refunded twice.

## Airline schedule changes

The schedule change sweep (ADR-065) asks each ticketed flight's supplier for airline changes
every `SCHEDULE_CHANGE_CHECK_HOURS`. Travellers are told by email and push and can accept online.
Operations get an alert (ids only) in three cases.

- **`airline.schedule_change`: a change that cannot be accepted online.** Open the booking in
  the console and the order in the supplier's dashboard (the booking item's supplier order id).
  Contact the traveller about the new times, and resolve the change in the supplier's dashboard:
  accept it, change the flight or cancel. The next check mirrors the result. The booking's
  itinerary and e-ticket follow once the change is accepted.
- **`airline.schedule_change_resolved` with `cancelled`: the order was cancelled with the
  airline.** The booking is still `CONFIRMED` but there is no flight. Refund the traveller from
  the console (refunds, maker-checker) with the refund the airline gave, and record the reason.
- **`airline.schedule_change_resolved` with `changed`: the order was changed elsewhere.** Check
  that the new flights are what the traveller agreed to. The booking's itinerary follows the
  airline's on the next check once no change is open.

If checks fail (`suskii_schedule_change_checks_total{outcome="failed"}`, or `airline schedule
change checks failed` in the worker log), the supplier is down or refusing order reads. Checks
retry on the next interval and need no action unless failures continue after the supplier
recovers.
