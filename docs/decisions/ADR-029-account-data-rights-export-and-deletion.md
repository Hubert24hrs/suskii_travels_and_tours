# ADR-029: Account data rights, export and deletion

- Status: Accepted
- Date: 2026-10-05
- Deciders: Claude Code (implementer), pending owner review

## Context

The Nigeria Data Protection Act 2023 and the GDPR give travellers the right to a copy of their
data and to erasure, limited by obligations to keep records (spec: "DSAR export and deletion
endpoints", "data retention policy"). The app stores need in-app account deletion before release
(phase 7). Personal data now lives in about sixty tables across accounts, bookings, payments,
the ledger, visa applications, push tokens and, from this phase, memberships, referrals, alerts
and preferences. New tables arrive every phase; an export assembled by hand would drift.

## Decisions

1. **One registry, enforced.** `src/privacy/data-registry.ts` maps every Prisma model to its DSAR
   treatment: `export` (the user's own data, in the export), `erase` (deleted or blanked on
   deletion), `retain` (financial records kept for the retention period, personal fields
   redacted), or `none` (no personal data, with the reason). A unit test reads the generated
   Prisma model list and fails when a model is missing from the registry, so a new table cannot
   ship without a decision. Each registered source exports the rows that belong to the user and
   erases or redacts them.
2. **Export.** `GET /v1/me/data-export` returns one JSON document (attachment, `no-store`) with a
   section per source: profile, preferences, identities (provider and email, never tokens),
   sessions (device, created, last used; no token hashes), MFA (enabled factors, never secrets),
   saved travellers (passport numbers decrypted: it is the user's own data), bookings with
   passengers, payments, refunds and documents (metadata), wallet entries, visa applications
   (status, history, document metadata; files through their signed links), memberships,
   referrals, price alerts, notification settings and delivery log, newsletter subscriptions for
   the account's email, push tokens (masked) and audit events the user performed. Secrets, other
   people's data and internal pricing (markup, supplier cost) are never included.
3. **Re-authentication.** Export and deletion need a fresh proof: the account password (or a
   fresh OTP for passwordless accounts) and, when MFA is on, a current TOTP or recovery code,
   checked at the request. Both are rate limited and audited.
4. **Deletion preconditions.** Refused with 409 and a reason while the account has a booking that
   is not settled (in progress, held, on a plan, travelling in the future or with a refund in
   flight), or a non-zero wallet balance (support pays it out first). The rule keeps deletion
   from destroying records a traveller still needs and avoids silently forfeiting money.
5. **Anonymisation.** In one transaction: the user row becomes a tombstone (email
   `deleted-{id}@invalid`, names, phone, password hash and verification flags cleared,
   `deletedAt` set, status `deleted`); identities, sessions, MFA factors, recovery codes,
   verification tokens, travellers, push tokens, preferences, notification settings, price
   alerts and referral codes are deleted; memberships end; newsletter subscriptions for the email
   are removed. Bookings, passengers, payments, refunds and ledger entries are **retained**
   (tax and accounting obligations) with contact details and passport numbers wiped and
   documents deleted from storage; names stay on the financial record, which is what an invoice
   needs. Audit rows keep the user id (the tombstone) and no personal values (they never had
   any). A `user.deleted` audit entry records the request.
6. **Retention.** `FINANCIAL_RECORDS_RETENTION_YEARS` (default 7) documents how long retained
   records stay; the purge job is phase 11 hardening. The period is a legal decision for the
   owner.

## Consequences

- The export is complete by construction; a model added in phase 10 must choose its treatment.
- A deleted account's email can register again as a new account; the tombstone keeps foreign keys
  valid and makes "who booked this" answerable only as "a deleted account".
- Guest bookings (no account) are outside account deletion; support handles those requests with
  the booking reference until a guest DSAR flow exists.

## Implementation notes (phase 9)

- The registry is `apps/api/src/privacy/data-registry.ts`: each model has an export `section`
  (or none) and a `deletion` treatment (`delete`, `redact`, `retain`, `none`). The `satisfies`
  clause fails compilation on a missing model and `data-registry.spec.ts` compares the registry
  with both `schema.prisma` and the generated client.
- The export is `POST /v1/me/data-export` (the proof travels in the body, which a GET cannot
  carry); the e2e test checks that the document has exactly the registry's sections and contains
  no credential, hash or cost field.
- Re-authentication (`ReauthService`, `GET /v1/me/reauth`) has three methods: `password`;
  `sms_code` for passwordless phone accounts (`POST /v1/me/reauth/code`, purpose
  `reauth:{userId}`); and `recent_sign_in` for Google or Apple accounts without either, which
  accept a session created in the last 10 minutes. MFA adds a TOTP or recovery code. Failures
  count towards the sign-in lockouts and are audited.
- `GET /v1/me/deletion` lists blockers before asking for proof: `staff_account` (staff are
  offboarded by an administrator, never self-deleted), `booking_in_progress`,
  `payment_in_progress`, `upcoming_trip` (until the day after the trip ends), `visa_in_progress`,
  `refund_in_progress` and `wallet_balance`. `POST /v1/me/deletion` needs the proof plus
  `confirm: "DELETE"` and re-checks the blockers inside the transaction with the user row locked.
- The tombstone email is `deleted-{id}@deleted.invalid`; redacted booking contacts read as a
  `.invalid` address, and both email adapters drop `.invalid` recipients, so nothing is ever sent
  to a deleted account. Referrals involving the account are rejected with the flag
  `account_deleted` and lose their sign-up signals.
- Web: `/account/privacy` asks for the proof the API names, downloads the export as a blob (the
  file name comes from `Content-Disposition`) and, after deletion, forgets the local session
  hint. Mobile: the export goes to the system share sheet from a file in the app cache that is
  deleted as soon as the sheet closes; deletion then clears the tokens, account trips and cached
  queries on the phone. The in-app deletion meets the store requirement for account removal.
