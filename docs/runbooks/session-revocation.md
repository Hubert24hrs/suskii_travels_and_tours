# Session revocation and account recovery

Use this runbook for a suspected account takeover, a compromised staff account or device, a
leaked token, and support requests to recover an account whose second factor is lost. The
design is in ADR-007 (sessions) and ADR-037 (staff hardening).

## How revocation works

- A session holds a refresh token family. Access tokens live 15 minutes.
- Revoking a session marks it in the database and puts its id on a Redis denylist for one
  token lifetime. The API refuses its access tokens at once instead of when they expire.
- End sessions only through the console, `SessionService`, or the `sessions:revoke` script.
  Never delete rows by hand: that skips the denylist and the audit entry.

## One account taken over

1. **Contain** (console, Users, the account):
   - **Sign out everywhere** ends every session at once (`users:manage`, audited as
     `user.sessions_revoked`).
   - **Disable** the account if the attacker may still hold the password or the email
     mailbox. Disabling also signs it out (step-up required). Bookings and payments stay
     intact.
2. **Assess:** in the audit log, filter by the account to see sign-ins
   (`auth.login.succeeded` with IP hash and user agent), changes to password, email, phone and
   MFA, data exports (`account.data_exported`), new bookings and wallet use. Check the
   account's bookings for contact details changed after the takeover.
3. **Recover the account with its owner** (identity checks below):
   - **Re-enable** the account.
   - The owner resets the password through **Forgot password**. Reset ends all sessions and
     never bypasses MFA: sign-in afterwards still asks for the authenticator.
   - If the attacker enrolled their own authenticator, use **Reset MFA** so the owner can
     enrol again. Reset MFA removes the factor and recovery codes and signs the account out
     (step-up required).
4. **Money:** refunds or wallet movements the attacker caused go through the normal refund
   flow with maker-checker. Never adjust balances directly.
5. **Personal data:** if the attacker exported data or viewed bookings, record it for the
   breach assessment (NDPA and GDPR, 72 hours to notify the regulator when people are at
   risk).

## A staff account or device is compromised

1. **Sign out everywhere** on the staff account, then **Disable** it. Another super admin
   must do this, because nobody can change their own account and the last super admin cannot
   be disabled.
2. Review the audit log for that actor since the suspected time. Look for role changes, refund
   approvals, pricing and markup edits, contact reveals and document access. Revert pricing and
   content changes through the console (each edit is audited). Recall refunds with the provider
   where possible.
3. If more than one staff account could be affected, or a staff session cookie may have leaked
   from a shared machine, sign out all staff (dry run first):

   ```bash
   pnpm --filter @suskii/api sessions:revoke --staff --reason incident-YYYY-MM-DD
   pnpm --filter @suskii/api sessions:revoke --staff --reason incident-YYYY-MM-DD --yes
   ```

4. Remove the person's roles when access should end (console, Users, Roles; step-up required).
5. Check `ADMIN_IP_ALLOWLIST` and `ADMIN_ORIGINS` are still what the owner approved.

## Everyone, at once

Use this when the signing key, the database's session tables, or Redis may be exposed:

```bash
pnpm --filter @suskii/api sessions:revoke --all --reason <slug>          # counts only
pnpm --filter @suskii/api sessions:revoke --all --reason <slug> --yes
```

Every traveller and staff member signs in again. Rotate the signing key at the same time if it
may have leaked ([Key rotation](key-rotation.md)). Tell support before running it.

## Account recovery: identity checks

Support resets a second factor or recovers a locked-out account only after checking identity.
The aim is to make social engineering at least as hard as the factor it replaces.

**Never accept or ask for:** passwords, one-time codes, recovery codes, card numbers or CVVs,
or photos of passports sent through chat or email.

| Step | Check                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | The request comes from the account's verified email address, or the person signs in with a texted code to the verified phone (if one exists). A request from a new address is never enough |
| 2    | They state two facts only the owner knows: a booking reference with its travel date, the lead passenger's surname, or the date the account was created (month and year)                    |
| 3    | Staff accounts: their manager confirms by a separate channel, and a super admin performs the reset                                                                                         |
| 4    | Wait 24 hours before resetting MFA on an account with recent changes to email, phone or password (an attacker's sequence), unless step 3 applies                                           |
| 5    | Record in a booking note or the ticket: which checks passed, who approved, and the request time. No personal data beyond the account id                                                    |

Then use **Reset MFA** in the console and tell the person to sign in and enrol again. The
console records `user.mfa_reset` with the staff member's id.

## Verify

- The account shows no active sessions (console), and new sign-ins appear only from the owner.
- Audit entries exist for each action taken.
- For bulk revocation, the script's count matches what the console shows afterwards.
