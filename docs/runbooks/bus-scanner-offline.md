# Bus scanner offline

**Alerts:** `BusDepartureNotScanned` (a departure is over 30 minutes past its time with sold
seats and nobody boarded), `BusScansInvalid` (more than 20 passes failed the signature check in
15 minutes).
**Dashboard:** Suskii operations, Cars row: departures nobody was scanned onto, scans by result.
**Background:** ADR-050 (QR boarding passes and scanning), ADR-051 (bus holds and sales).

## How boarding works

- Each seat has a QR boarding pass: an Ed25519 signature over the ticket, the trip and its
  boarding window (3 hours before to 6 hours after departure), drawn on the traveller's phone or
  printed from the PDF. No personal data is in the code.
- Operator agents scan with the app (camera or pasted code). A scan boards a ticket once; a
  second scan answers "already used" with the time.
- A scanner without a connection verifies passes itself with the public keys from
  `GET /v1/buses/ticket-keys` and syncs its scans later (`POST /v1/operator/tickets/sync`, in
  the order they were made). The first scan of a ticket to reach the API boards it; any later
  one answers "already used" and is recorded as a conflict in the audit log.

## 1. Departure not scanned (`BusDepartureNotScanned`)

1. Call the operator (console, **Buses**, Operators): is the agent's phone offline, or did they
   board without scanning?
2. **Offline:** nothing to do on our side. Scans sync when the phone reconnects and the trip's
   boarded count catches up (the app's scan screen shows boarded of sold for each departure).
   Ask the agent to open the app on a connection once the coach is away.
3. **Not scanned at all:** the trip's manifest (`GET /v1/operator/trips/{id}/manifest` for the
   operator's agents) is the record of who bought seats. Remind the operator that unscanned passes stay valid until
   the end of the boarding window, and note it on the trip.
4. A departure that did not run: cancel it from the console (Buses, Trips, **Cancel trip**).
   Every paid booking is refunded in full automatically.

## 2. Many invalid scans (`BusScansInvalid`)

1. Look at the reasons in the API logs for `/v1/operator/tickets/scan` (results are counted by
   result and offline flag; reasons are `malformed`, `bad_signature`, `unknown_key`,
   `not_yet_valid`, `expired`).
2. `unknown_key` after a signing key rotation: the previous public key must stay in
   `CARS_TICKET_PREVIOUS_PUBLIC_KEYS` until every pass signed with it is past its window
   (see [Key rotation](key-rotation.md)). Add it back and redeploy if it was removed too soon.
3. `bad_signature` or `malformed` in bulk from one terminal: possibly forged passes. Ask the
   operator to board only scanned "Boarded" results, check the manifest, and keep the request
   ids for the incident record.
4. `not_yet_valid` or `expired`: travellers at the wrong departure. The agent directs them to
   the operator's desk.

## 3. Verify

- `suskii_bus_trips_unscanned` back to 0 after the scans sync.
- Invalid scans at their usual low level.
