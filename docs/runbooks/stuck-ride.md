# Stuck ride

**Alerts:** `RideDispatchStalled` (a ride has searched for a driver for over 15 minutes),
`RideStuckInProgress` (a ride has been in progress for over 4 hours), `RideNoDriverRateHigh`
(over 30% of searches in an hour ended without a driver).
**Dashboard:** Suskii operations, Cars row: oldest search, live rides, searches by outcome.
**Background:** ADR-051 (fares, refunds, earnings), ADR-053 (matching and geodata).

## How matching works

- The worker calls `/v1/internal/rides/dispatch` every few seconds (`rides-dispatch` job on the
  `rides` queue). The API holds a Redis lock (`lock:ride-dispatch`), so overlapping runs from
  several workers do nothing.
- Each run starts scheduled rides that are due, expires offers nobody answered within
  `RIDE_OFFER_SECONDS`, ends searches older than `RIDE_MATCH_TIMEOUT_SECONDS` (default 5
  minutes) as `no_driver` with a full refund, and offers each waiting ride to the nearest
  eligible online driver within `RIDE_MATCH_RADIUS_METRES`.
- A search older than the timeout therefore means runs are not happening.

## 1. Dispatch stalled (`RideDispatchStalled`, pages)

1. Worker health: `GET http://<worker>:4100/health` and its log. `rides dispatched` and
   `rides found no driver and were refunded` lines appear while it works.
2. Queue: `suskii_queue_jobs{queue="rides"}`. Waiting jobs that never complete mean the worker
   cannot reach Redis or the API; failed jobs show `InternalApiError` with the status.
3. Run one sweep by hand from a secured operations shell:

   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
     "$API_INTERNAL_URL/v1/internal/rides/dispatch"
   ```

   The answer counts `started`, `offered`, `expired` and `timedOut`. All zero while rides are
   searching means the run did nothing: rides switched off (`CARS_RIDES_ENABLED`), or the lock
   is held by a crashed run.

4. A lock left by a crashed run expires on its own within 30 seconds. If runs keep doing nothing,
   restart the API instances one at a time.
5. When runs resume, the old searches time out and are refunded automatically. Check the
   refunds reach `succeeded` (console, Refunds).

## 2. Ride in progress for hours (`RideStuckInProgress`)

1. Console, **Rides and safety**, Live rides: find the ride and its driver.
2. Contact the driver (console, Drivers, then the account's phone): usually the app was closed
   before **Complete trip**. The driver completes it from driver mode; the fare and earnings
   settle then.
3. If the driver cannot be reached, or the rider reports the trip ended long ago, stop the ride
   from the console. Stopping refunds the rider in full and pays the driver nothing, so record
   why in a note and, if the trip did happen, pay the driver through support.
4. If anything suggests a safety problem, switch to [Ride safety incident](ride-safety-incident.md).

## 3. Many searches without a driver (`RideNoDriverRateHigh`)

1. Live rides and the Cars row: are drivers online? A city with no online drivers refunds
   every request.
2. Driver applications waiting for review keep supply low: see
   [Driver document backlog](driver-document-backlog.md).
3. Every `no_driver` ride is refunded in full automatically; nothing is owed to riders.
4. Do not widen `RIDE_MATCH_RADIUS_METRES` during an incident without the operations lead: a far
   driver means a long wait and a worse trip than a quick refund.

## 4. Verify

- `suskii_rides_oldest_search_age_seconds` stays under 300 and `suskii_rides_longest_trip_age_seconds`
  under a few hours.
- `suskii_ride_matches_total{outcome="assigned"}` grows again.
