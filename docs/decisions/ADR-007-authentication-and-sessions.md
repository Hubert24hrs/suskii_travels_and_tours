# ADR-007: Authentication, sessions and abuse controls

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

`PROJECT_SPEC.json#/security` requires argon2id with a HIBP k-anonymity check, 10-15 minute
asymmetric access JWTs with JWKS rotation, rotating refresh tokens with reuse detection and family
revocation, httpOnly Secure SameSite=Lax cookies plus CSRF on the web, secure storage on mobile,
optional TOTP MFA (mandatory for admins), lockout with exponential backoff, generic errors, email
and phone verification, device management with remote sign-out, RBAC, rate limits and an immutable
audit log. Several details were left open; these are the choices.

## Decisions

### Tokens

- **Access token**: EdDSA (Ed25519) JWT, `typ: at+jwt`, 15 minutes, claims `sub`, `sid` (session),
  `roles`, `mfa`, `amr`. `kid` is the RFC 7638 thumbprint. `GET /.well-known/jwks.json` publishes the
  current key and every key in `JWT_PREVIOUS_PUBLIC_KEYS`, which stay valid for verification during a
  rotation. Keys come from the environment (PEM or base64 PEM; generate them with
  `pnpm --filter @suskii/api keys:generate`); dev and test use an ephemeral pair; production refuses
  to boot without keys.
- **Refresh token**: opaque (`srt_` + 256 random bits), stored as SHA-256, rotated on every use.
  A session is the rotation family. Presenting a rotated or revoked token, or losing a concurrent
  refresh race, revokes the session, all its tokens and its live access tokens, and writes
  `auth.refresh_token.reused` to the audit log. Clients must single-flight refreshes (the web and
  mobile API clients will). Idle expiry is `REFRESH_TOKEN_TTL_DAYS` (30); absolute session lifetime
  is 90 days.
- **Immediate revocation**: revoking a session writes a Redis denylist entry (`sid`, TTL = access
  token lifetime) that the global guard checks on every request. The check fails closed.

### Transports

- **Mobile** (`transport: token`, the default): tokens in the response body, stored in
  expo-secure-store; requests use `Authorization: Bearer`.
- **Web** (`transport: cookie`): `__Secure-suskii_at` (httpOnly, SameSite=Lax, Path=/),
  `__Secure-suskii_rt` (httpOnly, SameSite=Strict, Path=/v1/auth), `__Secure-suskii_csrf` (readable).
- **CSRF**: signed, session-bound tokens: `nonce.HMAC(sessionId.nonce)`. Every cookie-authenticated
  write, and refresh/logout with the refresh cookie, must send it in `X-CSRF-Token`. Binding to the
  session (rather than plain double-submit) defeats cookie injection from sibling subdomains and
  tokens taken from an attacker's own session. Bearer requests need no CSRF token.

### Account privacy

- Registration always answers `202 accepted`. New emails get a verification link; existing ones get
  an "account exists" notice. The password is hashed before the lookup so both paths take the same
  time. Password reset always answers `202`; the email work runs after the response.
- Sign-in errors are one generic `invalid-credentials` for unknown accounts, wrong passwords and
  disabled accounts; unknown accounts burn an argon2 verification to equalise timing.
- Residual risk, accepted: an attacker who registers an existing email and then tries to sign in can
  infer that the email was taken. This needs two rate-limited requests, trips the lockout, and
  notifies the real owner. Removing it would mean blocking sign-in until email verification, which
  the owner may prefer later (a small change in `AuthService.login`).
- Unverified emails may sign in; later phases decide which actions require `emailVerified`.

### Credentials and factors

- argon2id at OWASP parameters (19 MiB, t=2, p=1), rehash on login when parameters rise.
  Passwords 10-128 characters. HIBP range API with padding; fails open (logged) if unreachable.
- Phone OTP: 6 digits, 5 minutes, HMAC-hashed in Redis, 5 guesses per code, 60-second resend
  cooldown, and the lockout counter per number. A phone number is attached to an account only after
  verification, so an unverified number can never be used to take over an account.
- TOTP (RFC 6238, SHA-1, 30 s, 6 digits, plus or minus one step), secret encrypted with AES-256-GCM
  (record-bound AAD), replay-protected by storing the last accepted step with a conditional update.
  Ten single-use recovery codes, HMAC-hashed. Staff cannot disable MFA.
- Google and Apple: ID tokens verified against the providers' JWKS, issuer, audience
  (`GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS`; a provider without client IDs answers 404), expiry and
  optional nonce (raw or SHA-256, Apple's native flow). Linking to an existing account by email
  happens only when the provider says the email is verified. If the existing account never verified
  its email, its password is removed and its sessions revoked first (account pre-hijacking defence).

### Authorisation

- Global guards in order: `AuthGuard` (deny by default, `@Public()` opts out), `RateLimitGuard`,
  `PermissionsGuard`. Roles map to permissions in `@suskii/shared` (code is the source of truth; the
  database tables are synced at boot for foreign keys and reporting).
- `@AdminRoute(...permissions)` additionally requires a staff role, an MFA-verified session and,
  when `ADMIN_IP_ALLOWLIST` is set, an allowlisted IP. Denials on admin routes are audited.
- Role changes revoke the target's sessions so they apply immediately; nobody can change their own
  roles.

### Abuse controls

- Lockout: after 5 failures per identifier (email, `user:<id>`, phone, or user for MFA) within an
  hour, each further failure locks it for 30 s, doubling up to 15 minutes. Identifiers are HMAC'd;
  unknown accounts are locked the same way.
- Rate limits: Redis sliding-window counters (O(1) memory, atomic Lua). Every request counts against
  a global per-IP ceiling (600/min) and a per-route limit per user or IP (120/min); auth, OTP, reset
  and account-security routes add stricter IP, phone, email or user limits. `RateLimit-*` headers on
  responses, `429` problem details with `Retry-After` on rejection. The limiter fails open if Redis
  is unreachable, because it protects capacity; revocation checks fail closed, because they protect
  accounts.

### Audit and secrets

- `AuditService` writes the append-only `audit_log` (a trigger rejects UPDATE, DELETE and TRUNCATE),
  with actions from a closed union type, keyed-hashed IPs and PII-free metadata, optionally inside
  the same transaction as the change.
- `HMAC_SECRET` feeds HKDF-derived keys per purpose (IP, CSRF, OTP, recovery codes, identifiers);
  `FIELD_ENCRYPTION_KEY` is the AES key until the KMS envelope adapter (phase 12) writes `v2`
  envelopes.

## Consequences

- Web and mobile share every endpoint; only the transport differs.
- One Redis round trip per authenticated request (revocation) plus a few for rate limits.
- Two browser tabs refreshing with the same token at the same moment sign the user out; the client
  must serialise refreshes.
- Emails are sent in-process after the response until the worker owns notifications (phase 7).
