# ADR-037: Session limits, staff session lifetimes and step-up

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

The phase 11 walk of OWASP ASVS 5.0 found four session gaps:

- No documented limit on concurrent sessions (V7.1.2).
- Staff sessions lived as long as customers' (30 days idle, 90 days absolute) (V7.3.1, V7.3.2).
- No fresh authentication before the riskiest admin actions; ADR-033 left this open (V7.5.3).
- Staff could not sign an account out without disabling it, and an incident had no fast way to
  end many sessions at once (V7.4.5).

Sessions are already rows with rotating refresh tokens. A revoked session is denylisted in Redis
until its last access token expires (ADR-007).

## Decisions

1. **Staff are any account with a role besides `customer`.** Roles are read when a session starts
   and again on every refresh. A role change already signs the account out everywhere.
2. **Lifetimes.**

   | Account  | Absolute lifetime                          | Idle timeout                                | Concurrent sessions             |
   | -------- | ------------------------------------------ | ------------------------------------------- | ------------------------------- |
   | Customer | 90 days                                    | `REFRESH_TOKEN_TTL_DAYS` (30)               | `MAX_ACTIVE_SESSIONS` (10)      |
   | Staff    | `STAFF_SESSION_MAX_HOURS` (12, at most 24) | `STAFF_SESSION_IDLE_MINUTES` (30, 5 to 240) | `STAFF_MAX_ACTIVE_SESSIONS` (3) |
   - The idle timeout is the refresh token's lifetime. Every refresh issues a new one, so a session
     ends when nothing has called the API for that long.
   - The console refreshes only before a request and never polls, so an idle tab really goes idle.
   - A refresh also checks the session's age against the current policy. A session that started
     before its account became staff ends at the staff limit.

3. **Concurrent-session cap.**
   - A new sign-in beyond the cap ends the least recently used live sessions, never the new one.
   - Live means: not revoked, not expired, and holding an unexpired refresh token.
   - Each eviction is audited (`auth.session.evicted`, with the limit).
   - The account's session list shows live sessions only.
   - Signing in again always works, so the cap cannot lock anyone out.
4. **Step-up.**
   - `@StepUp()` on an admin route requires an authenticator check within
     `STEP_UP_WINDOW_MINUTES` (10, at most 30). That check is the MFA sign-in itself, or
     `POST /v1/me/mfa/step-up` with a TOTP code or a recovery code.
   - The step-up route uses the usual replay protection, lockout and rate limit, and it is
     audited (`auth.step_up.succeeded`).
   - Without a recent check the route answers `403 step-up-required`. The check runs in the
     permissions guard, before validation and before any idempotency record is written.
   - The OpenAPI document marks these routes `x-step-up`. Building the document fails if
     `@StepUp()` is used without `@AdminRoute`.
   - The route matrix test checks every marked route with a stale session.
   - The route lives under `/v1/me` rather than `/v1/auth`, because the auth controller is public
     and this route needs a signed-in session.
   - Step-up routes:
     - Role changes.
     - Account disable.
     - MFA reset.
     - Refund approval and resolution of refunds in review.
     - Trust-signal verification.
     - Markup, fee and Prime plan creation and edits.
   - Not step-up:
     - Protective actions: unverify, reject, enable, sign out everywhere.
     - Routine catalog and content work.
5. **Console prompt.**
   - When a write answers `step-up-required`, the console's API client opens one shared dialog for
     a code. After the code is accepted, it sends the write again once, with a copy kept for that
     purpose.
   - Cancelling leaves the write refused, with a message.
   - Pages need no step-up code of their own.
6. **Sign out everywhere (staff).**
   - `POST /v1/admin/users/:id/sessions/revoke` (`users:manage`) ends every session of an account
     and leaves the account active.
   - It is audited with the count (`user.sessions_revoked`).
   - Staff cannot target their own account.
7. **Incident command.**
   - `pnpm --filter @suskii/api sessions:revoke (--all | --staff | --user <id>) --reason <slug>`
     ends sessions in batches of 500. It revokes the sessions and their refresh tokens and
     denylists each session in Redis.
   - Without `--yes` it only counts.
   - Each run is audited as a system action (`auth.sessions.revoked_incident`).
   - The runbook (`docs/runbooks/session-revocation.md`) says when to use it, for example after a
     signing-key or cookie-domain compromise.

## Consequences

- Staff sign in at least once a working day, and again after 30 idle minutes. Customers notice
  nothing unless they use more than ten devices.
- The riskiest actions now need two independent things: a stolen staff cookie is not enough
  without the authenticator.
- Staff using the public website with the same account get the staff lifetimes there too. This is
  intended.
- Open for the owner:
  - Whether markup and fee changes should also need a second approver (ADR-035).
  - The final values of the lifetimes and the cap.
