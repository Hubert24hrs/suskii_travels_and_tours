# Data classification and protection requirements

Every kind of data the platform creates or processes, its protection level, and what each level
requires (ASVS V14.1). `DATA_REGISTRY` (`apps/api/src/privacy/data-registry.ts`) lists every
table with its export section, deletion treatment and retention; this page groups that data by
sensitivity. Review it when a change adds a kind of personal data. The registry's compile check
and spec make that change visible.

The primary market is Nigeria, so the Nigeria Data Protection Act 2023 applies first. The same
controls cover the GDPR for travellers in the EU and the UK. Card data is out of scope: the
platform never sees it (SAQ-A, hosted checkout only).

## Levels

| Level            | What it covers                                                                  |
| ---------------- | ------------------------------------------------------------------------------- |
| **Secret**       | Credentials and keys. Disclosure gives access to accounts, money or other data. |
| **Restricted**   | Identity documents and data that enables fraud or identity theft.               |
| **Confidential** | Personal data and commercial data: what a person booked and paid, our margins.  |
| **Internal**     | Operational data with no personal values: configuration, audit ids, metrics.    |
| **Public**       | Published catalog and content.                                                  |

## Inventory

| Data                                                                    | Level        | Where                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passwords, recovery codes                                               | Secret       | Only argon2id hashes (`users.password_hash`, `mfa_recovery_codes`)                                                                                                                                 |
| Session refresh tokens, email and reset links, guest booking tokens     | Secret       | Only SHA-256 or HMAC digests (`refresh_tokens`, `verification_tokens`, `bookings`)                                                                                                                 |
| Access tokens (JWT)                                                     | Secret       | Never stored. Readable payload: user id, session id, roles, MFA flag, sign-in methods and Prime benefits. No name, email or phone                                                                  |
| TOTP secrets                                                            | Secret       | AES-256-GCM, context `mfa-factor:{userId}:totp`                                                                                                                                                    |
| Keys and provider credentials                                           | Secret       | Secret manager and process memory only (`crypto-inventory.md`)                                                                                                                                     |
| Passport and identity numbers                                           | Restricted   | AES-256-GCM per row (`booking-passenger:{id}:passport`, `traveller:{id}:passport`); responses show the last three characters                                                                       |
| Visa documents (scans, photos, statements)                              | Restricted   | Object storage, AES-256-GCM per document key wrapped with `visa-document:{id}`; file names encrypted too; deleted 90 days after the application closes                                             |
| Booking contact (email, phone)                                          | Restricted   | AES-256-GCM, `booking:{id}:contact`; HMAC for lookup; responses mask it                                                                                                                            |
| Add-on details (insurance and transfer details), staff booking notes    | Restricted   | AES-256-GCM per item or note                                                                                                                                                                       |
| Push tokens                                                             | Restricted   | AES-256-GCM, HMAC for lookup; pruned when stale                                                                                                                                                    |
| Stored idempotent responses                                             | Restricted   | AES-256-GCM (they can hold guest tokens); 24 hours                                                                                                                                                 |
| Driver NIN, licence number and bank details                             | Restricted   | AES-256-GCM per driver (`driver:{id}:nin`, `:licence`, `:payout-account`); HMACs for uniqueness; never in responses except to the driver; cleared on account deletion                              |
| Driver documents (licence scan, vehicle papers, selfie)                 | Restricted   | Object storage, AES-256-GCM per document key wrapped with `driver-document:{id}`; staff with `drivers:review` only, audited                                                                        |
| Renter licence (number, expiry, scan) for self-drive rentals            | Restricted   | Number AES-256-GCM (`rental-licence:{id}:number`), shown as the last three characters; scan sealed per file; staff with `ground:manage` only, audited; deleted 30 days after the return            |
| Rental handover photos and delivery addresses                           | Confidential | Photos sealed per file (`rental-photo:{id}`), immutable once attached, destroyed `RENTAL_PHOTO_RETENTION_DAYS` after the return; delivery address in the item snapshot, coarsened with the booking |
| Live and historic positions (driver pings, ride pickup and drop-off)    | Restricted   | `drivers.last_*` only while online; `ride_location_pings` 90 days; ride places coarsened to about 1 km after 90 days; riders and share links see positions rounded to about 110 m                  |
| Emergency contacts                                                      | Restricted   | AES-256-GCM per contact (`emergency-contact:{id}`); the rider only; texted on SOS                                                                                                                  |
| Ride PINs, trip share tokens, ticket QR payloads                        | Secret       | argon2id hash and encrypted copy (PIN), HMAC (share tokens), never stored (QR payloads, signed on demand)                                                                                          |
| Account email and phone                                                 | Confidential | `users` (unique, plain for sign-in); hashed with HMAC wherever else they are needed (rate limits, referrals, newsletter)                                                                           |
| Names, dates of birth, nationality, gender of travellers                | Confidential | `booking_passengers`, `travellers`                                                                                                                                                                 |
| Itineraries, bookings, vouchers, visa applications                      | Confidential | Booking tables; voucher codes as HMAC plus ciphertext                                                                                                                                              |
| Rides, bus tickets, rentals, ratings, safety incidents                  | Confidential | Cars tables with their bookings; rating comments and handover notes cleared with the booking                                                                                                       |
| Payments, refunds, wallet, ledger                                       | Confidential | Amounts, provider references and status. Never card numbers; the card fingerprint is an HMAC                                                                                                       |
| IP addresses                                                            | Confidential | Only as HMAC (`ip` purpose) in sessions, audit entries and rate limits                                                                                                                             |
| Device data (user agent, push platform)                                 | Confidential | `sessions`, `push_tokens`; no advertising ids                                                                                                                                                      |
| Markups, supplier costs, fees, promo rules                              | Confidential | Pricing tables; never leave the API (responses carry prices only)                                                                                                                                  |
| Webhook payloads                                                        | Confidential | `webhook_events`; can hold the payer's email; 90 days                                                                                                                                              |
| Audit entries                                                           | Internal     | Actor id, action, target id, reasons and changed field names; append-only                                                                                                                          |
| Search logs                                                             | Internal     | Routes, dates and counts, no user id; 13 months                                                                                                                                                    |
| Metrics, traces, web-vitals                                             | Internal     | Route templates and labels from fixed lists (`logging-inventory.md`)                                                                                                                               |
| Catalog, deals, destinations, airports, verified trust signals, content | Public       | Published by staff through the admin API                                                                                                                                                           |

## Requirements by level

| Requirement          | Secret                                                                            | Restricted                                                                                    | Confidential                                                  | Internal                   |
| -------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------- |
| At rest              | Hashed, or encrypted in the field with a key per purpose                          | Field encryption bound to the row, plus storage encryption                                    | Storage encryption (managed database, phase 12)               | Storage encryption         |
| In transit           | TLS 1.2+ everywhere, including Postgres and Redis in production (ADR-038)         |                                                                                               |                                                               |                            |
| Integrity            | GCM tags and HMACs detect tampering                                               | GCM tag bound to the row                                                                      | Database constraints; the ledger refuses updates              | Audit table is append-only |
| Responses            | Never returned (tokens only once, at issue)                                       | Masked or partial; full value only to its owner, once, where needed                           | Owner (404 for anyone else) or staff with the permission      | Staff with the permission  |
| Logs, traces, Sentry | Never. Redacted by field name (`SENSITIVE_LOG_FIELDS`) and scrubbed from messages | Never                                                                                         | Ids only, never values                                        | Allowed                    |
| Access               | No person reads them                                                              | Owner; staff only through an audited route with a reason (visa officers through signed links) | Owner; staff by role (`ROLE_PERMISSIONS`)                     | Staff by role              |
| Retention            | Until revoked or expired, then purged                                             | Shortest workable (visa documents 90 days after closing)                                      | Retention rules (ADR-039); financial records 7 years          | Retention rules            |
| Account deletion     | Deleted                                                                           | Deleted                                                                                       | Deleted or redacted; financial rows kept without contact data | Kept (ids only)            |
| Mobile device        | Keychain / Keystore (`secureStorage`)                                             | Encrypted MMKV (`secureCache`); screen capture blocked on sensitive screens                   | Encrypted MMKV                                                | Preferences storage        |
| Browser              | HttpOnly cookies; guest token in session storage, moved out of the URL            | Never stored in the browser                                                                   | Not stored beyond the page (form state only)                  | Allowed                    |

Privacy-enhancing measures: HMAC pseudonyms instead of raw identifiers for IP addresses and
lookups, aggregated metrics with bounded labels, web-vitals without ids or query strings, and
data minimisation in exports to suppliers (only what the fare or room needs).

## Adding data

1. Classify it here.
2. Add the table to `DATA_REGISTRY` with its export section, deletion treatment and retention.
3. Restricted data: add an encryption context to `encryption-contexts.ts` and the column to
   `ENCRYPTED_FIELDS`.
4. Add the field name to `SENSITIVE_LOG_FIELDS` (`packages/shared/src/log-redaction.ts`) if it
   can appear in a log object.
5. Add it to the data export and account deletion in the same change.
