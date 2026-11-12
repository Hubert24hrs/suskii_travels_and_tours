# Key rotation

Use this runbook for a scheduled rotation (see `docs/security/crypto-inventory.md` for the
schedule) or at once when a key may have leaked. The key designs are in ADR-007 and ADR-038.

## If a key may have leaked

1. Open an incident. Record which key, where it was exposed, since when, and who had access.
2. Rotate it now, using the "compromise" path for that key below.
3. Decide with the owner whether personal data was exposed. A leaked encryption key matters
   only together with database access, and a leaked token secret only for the time it was
   valid. If people's data may have been read, the regulator must be notified within 72 hours
   (NDPA 2023, and the GDPR for EU and UK travellers). Prepare the facts for counsel.
4. Remove the exposure: purge the key from the log, ticket, repository or chat, and rewrite
   history if it was committed. Push protection and gitleaks should have caught a commit;
   record why they did not.

New values always come from `pnpm --filter @suskii/api keys:generate`, which prints a fresh set
locally. Put each value straight into the secret manager, never into a file or a chat. Never
reuse a value across environments.

## Access-token signing key (`JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`)

Tokens carry a `kid` (the key's thumbprint), and the API verifies against the current key plus
`JWT_PREVIOUS_PUBLIC_KEYS` (`|`-separated).

**Scheduled:**

1. Generate a new pair.
2. Set the new pair, and append the old public key to `JWT_PREVIOUS_PUBLIC_KEYS`.
3. Deploy the API. New tokens use the new key, and existing tokens stay valid.
4. After one token lifetime (`ACCESS_TOKEN_TTL_SECONDS`, 15 minutes), remove the old public key
   and deploy again.

**Compromise:** do the same without step 2's previous key, so every access token signed with the
leaked key fails at once. Clients refresh with their refresh tokens, which are opaque values
stored in the database and are not affected. If refresh tokens could also be exposed, sign
everyone out:
`pnpm --filter @suskii/api sessions:revoke --all --reason signing-key-rotation --yes` (see
[Session revocation](session-revocation.md)).

## Field encryption key (`FIELD_ENCRYPTION_KEY`, `FIELD_ENCRYPTION_KEY_ID`)

Each ciphertext names its key id. `keys:reencrypt` rewrites every encrypted column and JSON key
listed in `ENCRYPTED_FIELDS` that is not under the current id, including wrapped visa document
keys. Document contents are not re-encrypted, because their per-document keys are only
re-wrapped.

1. Generate a key and choose the next id (`k1` becomes `k2`).
2. Set `FIELD_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_KEY_ID` to the new pair, and add the old pair
   as `k1:<base64>` to `FIELD_ENCRYPTION_PREVIOUS_KEYS`.
3. Deploy the API. New writes use `k2`, and old ciphertexts still decrypt.
4. From an operations shell with the same configuration, count first, then rewrite:

   ```bash
   pnpm --filter @suskii/api keys:reencrypt          # counts per field, changes nothing
   pnpm --filter @suskii/api keys:reencrypt --yes    # rewrites; repeat until it prints "done"
   ```

5. Remove the old pair from `FIELD_ENCRYPTION_PREVIOUS_KEYS`, deploy, then destroy the old key.

**Compromise:** the same steps, run at once. Backups taken before the rotation still need the
old key, so keep it in the secret manager, marked compromised, only until those backups expire.

## HMAC master secret (`HMAC_SECRET`)

Per-purpose keys are derived from it (`apps/api/src/crypto/hmac.service.ts`). Lookup hashes
cannot be re-derived without the original values, so there is no previous-key support. Rotate
only on compromise. On its own, a leaked secret lets an attacker forge short-lived signed links
and CSRF tokens. It does not reveal stored data.

Rotating it changes every digest. Before rotating, plan for these effects:

| Purpose                                                                 | Effect of rotation                                                          | Recovery                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `booking-access`, `booking-access-link`                                 | Guest booking links stop working                                            | Travellers sign in, or support resends the confirmation (console)                                                   |
| `booking-voucher`                                                       | Vouchers can no longer be found by code                                     | Re-derive the digests from the encrypted codes before reopening redemption (no script yet: open item from phase 11) |
| `booking-email`                                                         | Staff search by email misses older bookings                                 | Search by reference                                                                                                 |
| `csrf`, `otp`, `identifier`                                             | Open forms and sent codes fail; sign-in locks and rate-limit counters reset | Users reload or request a new code                                                                                  |
| `visa-document-url`, `addon-link`                                       | Links already issued fail (they last minutes)                               | Request a new link                                                                                                  |
| `push-token`, `newsletter`, `referral-signal`, `card-fingerprint`, `ip` | Older rows no longer match new events                                       | Devices register again on next launch; fraud signals rebuild over time                                              |
| `recovery-code` (codes from before phase 11)                            | Those codes stop working                                                    | MFA reset by support with identity checks ([Session revocation](session-revocation.md))                             |

Steps: set the new secret, deploy the API, then tell support which effects to expect.

## Bus ticket signing key (`CARS_TICKET_SIGNING_KEY`, `CARS_TICKET_PREVIOUS_PUBLIC_KEYS`)

Boarding passes carry the `kid` of the key that signed them, and scanners verify offline with
the public keys from `GET /v1/buses/ticket-keys` (the current key plus
`CARS_TICKET_PREVIOUS_PUBLIC_KEYS`, `|`-separated).

- **Scheduled:**
  1. Put the current public key into `CARS_TICKET_PREVIOUS_PUBLIC_KEYS` and a new private key
     from `keys:generate` into `CARS_TICKET_SIGNING_KEY`, then deploy. New passes use the new
     key; passes already issued keep verifying.
  2. Scanners pick up the new key list the next time they are online; ask operators to open the
     scan screen on a connection before their next departures.
  3. Remove the old public key once the last pass it signed is past its boarding window (6
     hours after that departure). Removing it sooner makes those passes scan as `unknown_key`.
- **Compromise:** rotate without keeping the old public key, so forged passes stop verifying at
  once. Passes already issued then scan as `unknown_key`: reissue them by asking travellers to
  reopen their booking (the passes are re-signed on read) and tell operators to check the
  manifest until every scanner has the new key.

## Internal API token (`INTERNAL_API_TOKEN`)

The worker uses it to call `/v1/internal`. Set the new value for the API and the worker, then
deploy both together. Sweeps fail with 401 for the minute in between and run again on the next
tick.

## Provider credentials

Rotate them in the provider's dashboard, then update the secret manager and redeploy:

- **Payment providers:** rotate the secret key, and the webhook secret or hash where there is a
  separate one. Stripe allows two webhook secrets during a roll. For the others, expect
  rejected webhooks for a few minutes. The providers retry, and reconciliation verifies anything
  still pending ([Payment provider outage](payment-provider-outage.md), 2B).
- **`DUFFEL_API_TOKEN`:** create the new token, deploy, then revoke the old one.
- **Turnstile, Expo, email and SMS credentials:** create, deploy, revoke.

## Verify

- `/ready` is up, and the error rate has not moved.
- Sign-in and token refresh work (web and app).
- `keys:reencrypt` reports nothing left under the old id (field key).
- Webhooks are `processed` (payment secrets), and the ticketing and refund sweeps run (internal
  token).
- Record the rotation in the incident record, or in the key schedule for a planned one.
