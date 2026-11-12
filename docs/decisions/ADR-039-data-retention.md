# ADR-039: Data retention

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

Before phase 11, only fare snapshots, visa documents and push tokens were pruned. Sessions,
tokens, stored idempotent responses, payment webhooks (whose payloads can carry the payer's email),
notification logs, search logs, expired quotes and unconfirmed newsletter sign-ups grew without
limit. Financial records of deleted accounts were kept "for the retention period" (ADR-029) with
nothing ending it. ASVS 5.0 V14.2.7 asks for retention periods per data class and for data to be
deleted when they end.

## Decisions

1. **Every table declares its retention** in `DATA_REGISTRY` (`retention`). The kinds are:
   - `account`: kept while the account exists.
   - `reference`: configuration data.
   - `rule`: purged by the daily sweep.
   - `job`: purged by its own existing job.
   - `parent`: goes, or is anonymised, with its session or booking.
   - `append-only`: the audit log and the ledger.

   The `satisfies` clause fails the build when a table has none. `data-registry.spec.ts` fails
   when a sweep rule is claimed by no table, when reference data claims personal data, or when
   anything except the audit log and the ledger is append-only.

2. **The sweep.** `RetentionService.run()` runs from the worker every
   `RETENTION_SWEEP_INTERVAL_HOURS` (24) through `POST /v1/internal/retention/run`. It is
   idempotent and audited once per run (`retention.swept`, counts only). The periods are code
   constants, reviewed like any change:

   | Rule                   | Removed                                                     |
   | ---------------------- | ----------------------------------------------------------- |
   | `sessions`             | 30 days after revocation or expiry (refresh tokens cascade) |
   | `verification-tokens`  | 7 days after expiry                                         |
   | `idempotency-keys`     | at expiry (24 hours)                                        |
   | `booking-access-links` | 30 days after expiry                                        |
   | `offers`               | 30 days after expiry, unless a booking used the quote       |
   | `webhook-events`       | 90 days after a processed event arrived                     |
   | `notifications`        | 180 days                                                    |
   | `search-logs`          | 400 days (anonymous; year-on-year analytics)                |
   | `newsletter-pending`   | 30 days for sign-ups never confirmed                        |
   | `closed-bookings`      | see 3                                                       |

3. **Financial records.** A booking in a final status (confirmed, failed, cancelled, refunded or
   expired) whose last change is older than `FINANCIAL_RECORDS_RETENTION_YEARS` (7) is
   anonymised, for guests, members and deleted accounts alike:
   - Its contact is replaced with the redacted payload and its guest token removed.
   - Passenger names, birth dates, nationality and document data are cleared.
   - Add-on details, staff notes, access links and stored documents (files too) are deleted.
   - `anonymisedAt` is set.

   Amounts, statuses, history and ledger entries stay: they are not personal once the names are
   gone, and the ledger is append-only and must keep balancing.

4. **Not swept.** The audit log and the ledger are append-only by database trigger. They hold
   ids, amounts and keyed hashes, never personal values. Archiving them (partition drop after
   the period) is an operations task for phase 12.

## Consequences

- Personal data now has an end date everywhere it is stored. A support request about a trip older
  than seven years can be answered from amounts and dates only.
- The first sweep in production may remove many rows. The worker allows it five minutes, and a
  later run continues where it stopped.
- Open for the owner:
  - The legal retention period for financial records (7 years by default).
  - Whether 90 days of payment webhooks is enough for chargeback disputes with each provider.
