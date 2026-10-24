# ADR-050: Cars threat model

- Status: Accepted
- Date: 2026-10-24
- Deciders: Claude Code (implementer), pending owner review
- Spec name: ADR-cars-threat-model

## Context

Cars adds three new kinds of users and one unauthenticated surface:

- **Riders** book buses, rides and rentals.
- **Drivers** (vetted independents) see riders' pickup points, names and live trips.
- **Operator agents** scan bus tickets for their operator.
- **The public trip link** shows a live trip to anyone holding it.

It also adds data the platform did not hold before: continuous location, national identity
numbers, driver's licences, emergency contacts and vehicle photos. This model extends
`docs/security/threat-model.md` and applies before any of these features ships.

## Assets

| Asset                                                | Why it matters                 | Level (data-classification.md) |
| ---------------------------------------------------- | ------------------------------ | ------------------------------ |
| Live and historic location of riders and drivers     | Physical safety; stalking risk | Restricted                     |
| NIN, licence numbers, KYC references, document scans | Identity theft                 | Restricted                     |
| Emergency contact phones                             | Third parties' data            | Restricted                     |
| Ride PIN, share tokens, QR ticket payloads           | Grant boarding or trip access  | Secret                         |
| Seat inventory, rental availability                  | Revenue; denial of sale        | Internal                       |
| Fares, ledger, driver earnings                       | Money                          | Confidential                   |
| Handover photos, odometer and fuel                   | Evidence in deposit disputes   | Restricted                     |

## STRIDE

### Riders and bookings

| Threat                 | Example                                              | Control                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | Someone books with a stolen account                  | Existing auth, MFA option, session controls (ADR-007, ADR-037)                                                                                           |
| Tampering              | Client sends its own price or fare                   | The server computes totals and the client sends only quote ids (`Offer` re-pricing, ADR-025); seat and vehicle ids are re-checked                        |
| Repudiation            | A rider denies cancelling                            | Ride state transitions and booking transitions are audited with the actor                                                                                |
| Information disclosure | A rider reads another rider's ride, ticket or rental | Object-level checks in services, 404 for others; cross-tenant e2e tests per route                                                                        |
| Denial of service      | Bots hold every seat                                 | At most 6 seats per hold and 2 live holds per account or IP; holds rate limited per IP; 10-minute TTL; the booking itself needs a session or a bot check |
| Elevation              | A rider calls driver or operator routes              | Role and permission guards plus record ownership (assigned driver, operator membership)                                                                  |

### Drivers

| Threat                 | Example                                                | Control                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing               | An unvetted person drives under someone else's account | Going online requires a verified NIN, a valid licence, a registered and insured vehicle, and admin approval, checked in the service; selfie check through the KYC adapter |
| Tampering              | Fake GPS to inflate fares or steal rides               | Upfront fares (ADR-051), so location does not change the price; plausibility checks reject jumps above 50 m/s and pings faster than every 5 s                             |
| Tampering              | Starting a trip without the rider                      | 4-digit PIN stored as an argon2 hash; 5 attempts, then locked and an incident raised                                                                                      |
| Repudiation            | A driver denies a no-show                              | Arrive and start timestamps; location history for 90 days                                                                                                                 |
| Information disclosure | A driver scrapes riders' data                          | A driver sees the rider's first name and pickup only for offered or assigned rides; phone numbers are not shared (in-app contact only)                                    |
| Information disclosure | Drivers' positions leak                                | The rider sees a rounded position only during their ride; the admin map is staff-only; heatmaps use aggregates only                                                       |
| Denial of service      | A driver accepts and never shows                       | Offer timeouts; driver cancellations recorded; rating and cancellation-rate thresholds (minimum-rating policy)                                                            |
| Elevation              | A driver accepts a ride not offered to them            | Accept requires an open offer row for that driver and that ride; a conditional update makes exactly one acceptance win                                                    |

### Operator agents

| Threat                 | Example                                    | Control                                                                                                                  |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Spoofing               | Fake QR tickets                            | Ed25519-signed payload (ticket id, trip id, departure window); verified online and, in offline mode, with the public key |
| Tampering              | Reusing a ticket                           | Single-use scan by conditional update; a duplicate scan answers `already_scanned` with the first scan's time             |
| Information disclosure | An agent scans tickets of another operator | Scan checks the agent's operator membership against the trip's operator; others get `not_found`                          |
| Elevation              | An agent edits routes or fares             | `tickets:scan` grants scanning only; inventory changes need staff `ground:manage`                                        |

### Public trip link

| Threat                 | Example                | Control                                                                                                                       |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Information disclosure | A link is guessed      | 128-bit random token, stored as an HMAC; `404` for unknown tokens                                                             |
| Information disclosure | A link leaks too much  | Only the driver's first name, plate, vehicle model and colour, location rounded to about 100 m, ETA and status; no rider data |
| Information disclosure | A link lives forever   | Expires at trip end + 30 minutes; the rider can revoke it                                                                     |
| Denial of service      | Polling floods the API | Rate limited per IP and per token; cached for 5 s                                                                             |

### SOS and safety

| Threat                 | Example                           | Control                                                                                             |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Denial of service      | SOS throttled during an emergency | SOS is never rate limited below 1 per 60 s per user; it is processed synchronously, not queued      |
| Spoofing               | Fake SOS to harass a driver       | SOS creates an incident for staff triage; nothing automatic happens to the driver                   |
| Information disclosure | Emergency contacts exposed        | Phones encrypted per record; the SMS goes through the provider adapter; only the rider manages them |

## Rules derived from this model

1. Every Cars route has an object-level check, and an e2e test that another account gets 404.
2. No Cars response includes phone numbers, NINs, licence numbers or document URLs, except to
   the owner or to staff with the right permission, through signed links.
3. PINs, share tokens and QR payloads never reach logs: `SENSITIVE_LOG_FIELDS` gains `pin`,
   `shareToken`, `qrPayload` and `nin`.
4. Location is collected only while a driver is online or a ride is active. The app requests
   background location only then and stops when either ends.

## Residual risks

- KYC adapters are mocks until the owner contracts a provider (decision gate). Driver vetting in
  development is simulated, and production refuses the mock.
- The PIN can be shoulder-surfed. It only proves the rider is present, and the trip still needs
  the matched driver.
- Offline ticket scanning cannot detect a duplicate scan made on another offline device. Scans
  are reconciled when the device reconnects, and a second scan raises an alert.
