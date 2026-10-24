# Ride safety incident

**Alerts:** `RideSosRaised` (a rider or driver pressed SOS), `SafetyIncidentUnacknowledged` (an
incident has been open for 10 minutes with nobody on it).
**Dashboard:** Suskii operations, Cars row: open safety incidents, live rides.
**Background:** ADR-050 (safety, PINs, sharing, SOS), ADR-052 (live updates).

People come first. Money, refunds and the driver's standing can wait until everyone is safe.

## What the platform has already done

- An SOS creates a `sos` safety incident with the reporter, the ride and, when the phone sent
  one, the position (full precision, staff only).
- If the rider raised it, each of their emergency contacts (account security, at most three)
  got a text naming the city and the national emergency number, never coordinates in clear.
- PIN lockouts (five wrong PINs) and route deviations open incidents of their own kinds.

## 1. Acknowledge (first 2 minutes)

1. Console, **Rides and safety**, Incidents: open the newest `open` incident and press
   **Acknowledge**. This stops `SafetyIncidentUnacknowledged` and records who is on it.
2. Open the ride from the incident: status, rider and driver first names, vehicle and plate,
   pick-up and drop-off, and the driver's last reported position.

## 2. Reach the people involved

1. Call the reporter on the number on their account (console, Users). If there is any sign of
   danger, or no answer after two attempts, call the national emergency number (112) with the
   city, vehicle, plate and last position.
2. Call the other party only when doing so cannot put the reporter at risk.
3. If the ride is still moving and the reporter wants it stopped, **Stop ride** on the live
   rides page ends it and refunds it in full (`safety:manage`). The driver is told the ride
   was cancelled by staff.

## 3. Resolve

1. Console, Incidents, **Resolve** with the outcome: `false_alarm`, `assisted`,
   `escalated_to_police`, `driver_suspended` or `other`, and a short note with no personal data.
2. If the driver's conduct caused it, suspend them (console, **Drivers**, `safety_concern`).
   They go offline at once and cannot accept rides until reinstated.
3. A PIN lockout without a safety concern: confirm with the rider, then resolve as
   `false_alarm`. The ride stays locked for the driver; stop it from the console so the rider is
   refunded and can book again.

## 4. Verify

- `suskii_safety_incidents_open{status="open"}` is back to 0.
- The ride is completed or cancelled, and any refund is `succeeded` (console, Refunds).

## 5. Afterwards

- Write the incident review within one working day for anything beyond a false alarm. Note the
  times of the SOS, the acknowledgement, the first call and the resolution.
- Never copy positions, phone numbers or names into chat, tickets or the review: refer to the
  incident and ride ids.
