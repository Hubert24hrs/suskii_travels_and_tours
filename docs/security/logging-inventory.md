# Logging inventory

What each component records, where it goes, and what never goes there (ASVS V16.1 to V16.4).
Data levels are defined in `data-classification.md`.

## Destinations

| Record                 | Source                          | Format and transport                                               | Destination                                              | Retention                                               |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------- |
| Request log            | API (`nestjs-pino`)             | JSON lines on stdout                                               | Container runtime, then the cloud log service (phase 12) | 30 days (log service setting, phase 12)                 |
| Application log        | API, worker (`pino`)            | JSON lines on stdout                                               | Same                                                     | 30 days                                                 |
| Server log             | Web and admin (Next.js)         | Text on stdout; errors also go to Sentry                           | Same                                                     | 30 days                                                 |
| Audit log              | API (`AuditService.record()`)   | `audit_log` rows, written in the same transaction as the change    | PostgreSQL; staff read it in the console (`audit:read`)  | Kept. Triggers refuse `UPDATE`, `DELETE` and `TRUNCATE` |
| Error events           | API, worker, web, admin, mobile | Sentry envelopes over HTTPS (ADR-046)                              | The Sentry project for the environment                   | Sentry plan setting (90 days by default)                |
| Traces and metrics     | API, worker                     | OTLP over HTTPS (ADR-047)                                          | The metrics backend                                      | Backend setting                                         |
| Field performance      | Web (beacon to the API)         | Histogram metrics (ADR-044); the beacons themselves are not logged | The metrics backend                                      | Backend setting                                         |
| Booking status history | API                             | `booking_status_history` rows                                      | PostgreSQL                                               | With the booking                                        |

Nothing else receives logs. A new destination needs an entry here and in
`external-communications.md`.

## What is recorded

Every log line carries a UTC timestamp (epoch milliseconds from the process clock, which the
host keeps in sync with NTP), the level, and the request id. The API takes a well-formed
`X-Request-Id` from upstream (8 to 128 characters of `A-Za-z0-9._-`) or mints a UUID, echoes it
in the response, and puts it on the audit entry and the Sentry event. The worker sends
`worker-<uuid>` on each call to the internal API and logs it with any failure. The web and admin
servers do the same for their own responses and Sentry events, so a support report can be
matched to its logs.

| Event                                                                                                                                                      | Where                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every request: method, path without query string, status, duration                                                                                         | Request log. 5xx at `error`, 403 and 429 at `warn`, the rest at `info`. Probes and web-vitals beacons are skipped                                                                                                                                           |
| Sign-up, sign-in success and failure, lockout, MFA and OTP failures, recovery code use, refresh token reuse, step-up, sign-out, password and email changes | Audit (`auth.*`)                                                                                                                                                                                                                                            |
| Session revocation: by the user, by eviction at the device cap, by staff, by incident                                                                      | Audit (`auth.session.*`, `auth.sessions.*`, `user.sessions_revoked`)                                                                                                                                                                                        |
| Authorization denials                                                                                                                                      | Admin routes: audit (`rbac.access_denied`). Other routes: application log `authorization denied` with user id, route and missing permission                                                                                                                 |
| Ownership misses (another user's booking)                                                                                                                  | Request log (404); deliberately indistinguishable from a missing record                                                                                                                                                                                     |
| Input validation failures                                                                                                                                  | Request log (400 or 422) with the route; the problem response lists field paths, never values                                                                                                                                                               |
| Rate limits and bot checks                                                                                                                                 | Request log (429 at `warn`); Turnstile and attestation failures in the application log with the outcome only                                                                                                                                                |
| Payment webhooks                                                                                                                                           | `webhook_events` (dedupe, outcome), audit for amount mismatches and refunds owed, metrics by result                                                                                                                                                         |
| Cars safety and boarding: SOS, boarding scans and conflicts, ride matching, seat holds                                                                     | Audit (`ride.sos_raised`, `bus.ticket_boarded`, `bus.ticket_scan_conflict`) with ride or ticket ids; metrics by outcome only (`suskii.ride.sos`, `suskii.bus.ticket_scans`, `suskii.ride.matches`, `suskii.bus.holds`), never ids or positions              |
| Partner clicks and conversions (ADR-070)                                                                                                                   | `partner_clicks` and `partner_conversions` rows (ids, statuses, amounts); metrics `suskii.partner.clicks` and `suskii.partner.conversions`; refused postbacks counted as `rejected` and logged by status                                                    |
| Server-side ad conversions (ADR-079)                                                                                                                       | `ad_conversions` rows (booking and consent ids, status, attempts, networks sent to); metric `suskii.ad_conversions` by network and outcome; failures logged with the conversion id, network and a reason only, never the hashed contact, click ids or token |
| Booking, payment, refund and ledger changes                                                                                                                | Audit with booking and payment ids; status history                                                                                                                                                                                                          |
| Every admin mutation                                                                                                                                       | Audit, enforced by the contract's `audit` list and `admin-audit.e2e-spec.ts`; edits list changed field names                                                                                                                                                |
| Access to restricted data by staff                                                                                                                         | Audit (`booking.contact_revealed` with a reason, `visa.document_accessed`, `visa.document_link_issued`)                                                                                                                                                     |
| Account data export and deletion, failed re-authentication                                                                                                 | Audit (`account.*`, `user.deleted`)                                                                                                                                                                                                                         |
| Unexpected errors and failed security controls                                                                                                             | Application log at `error` with the stack, plus Sentry; for example a visa document failing its integrity check, a rate limiter that fails open, an undocumented response status                                                                            |
| Background jobs                                                                                                                                            | Worker log with counts and ids; failures to Sentry; job metrics                                                                                                                                                                                             |

## What is never recorded

- **Credentials and secrets:** passwords, tokens, cookies, `Authorization`, CSRF tokens, OTP and
  recovery codes, TOTP secrets, keys.
- **Personal data:** emails, phone numbers, passport numbers, names in free text, and the text
  of AI trip search messages (only the outcome, latency, tokens and cost are logged, ADR-061).
- **Payment data:** card numbers (never received in the first place).

Three layers enforce it:

1. **Code convention.** Log objects carry ids and reasons (`{ bookingId, reason: error.name }`),
   not values. Reviews check new log calls.
2. **Redaction.** Pino removes the fields named in `SENSITIVE_LOG_FIELDS`
   (`packages/shared/src/log-redaction.ts`) at the top level of a log object and up to three
   levels below, plus the API's request and response headers. Request serializers keep only the
   method and path (query strings can carry tokens), and responses only the status. Tests:
   `apps/api/src/logging/logging.module.spec.ts`, `apps/worker/src/logger.test.ts`.
3. **Scrubbing for Sentry.** Messages pass through `scrubText()`, which removes emails, IP
   addresses, digit runs, long opaque strings, and query strings and fragments of URLs. Events
   carry only the tags in `ERROR_TAG_KEYS`. There are no request bodies, headers, cookies or
   user objects.

Audit metadata holds ids, reasons and changed field names only. Free-text changes record the
field name, never the text.

## Integrity and access

- **Log injection.** Pino writes JSON, so newlines and control characters in a value are
  escaped and cannot forge a line. Upstream request ids must match a short safe pattern.
- **Audit table.** Append-only at the database: triggers refuse changes, and removing them
  takes a reviewed migration. The table has no foreign key to users, so it survives account
  deletion.
- **Who reads what.** Staff read the audit log only through the console with `audit:read`. Log
  and Sentry access is limited to the engineering on-call group, decided with the cloud
  (phase 12).
- **Separation.** Logs leave the container through stdout to a separate log service, so a
  compromised container cannot rewrite what it already sent. Shipping and storage settings
  are part of phase 12 (see `checklist.md`, V16.4.3).

## Adding a log or an event

1. Log ids and reasons, never values. Use `reason: (error as Error).name` for failures from
   third parties, whose messages can echo input.
2. Is it a security-relevant action? Add it to `AuditAction` and record it in the same
   transaction as the change.
3. Can a new field carry a secret or personal data? Add its name to `SENSITIVE_LOG_FIELDS`.
