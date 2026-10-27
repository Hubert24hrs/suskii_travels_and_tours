# Authentication and sessions

Every way to sign in, the strength of each, and how sessions behave (ASVS V6.1, V6.3.4, V7.1).
The design and its reasons are in ADR-007, ADR-033 and ADR-037. This page is the summary to
keep current: a new sign-in method or a change to a session limit updates it in the same change.

## Sign-in pathways

All pathways end in `AuthService.completeSignIn()`. It asks for the authenticator when the
account has MFA, issues a new session, and records `auth.login.succeeded` or `auth.login.failed`.
No other pathway creates a session.

| Pathway               | Proves                                                                      | Controls                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email and password    | Something you know                                                          | argon2id; 10 to 128 characters of any kind, never truncated or changed; checked against 9,126 common passwords, context words and Have I Been Pwned; per-IP limit and per-identifier lock                                                                                                                                                                                                                       |
| Phone and texted code | Something you have (the phone number)                                       | 6-digit code from a CSPRNG, 5 minutes, single use, 5 attempts, a new code replaces the old; 3 sends per phone per 10 minutes. The number is proven by the first code                                                                                                                                                                                                                                            |
| Google or Apple       | The provider's sign-in                                                      | ID token signature (provider JWKS at fixed URLs), issuer, audience, expiry, and a single-use nonce from `POST /v1/auth/social/nonce`. Accounts link only to a verified email, and identities are keyed by provider and subject. The app's sign-in through the website binds the nonce to a secret only the app holds (ADR-067). Test stacks can mint mock tokens (`SOCIAL_MOCK_ENABLED`, refused in production) |
| Fingerprint (app)     | Something you have (the phone's secure store) unlocked by something you are | A device credential created within 10 minutes of signing in, kept behind the biometric prompt on this device only; stored as an HMAC; five phones at most; ended with every session of the account; MFA still applies (ADR-067)                                                                                                                                                                                 |
| Authenticator (MFA)   | A second factor on top of any pathway above                                 | TOTP (RFC 6238, 30-second step, one step of drift, each step usable once) or a recovery code (10 codes of 50 bits, argon2id, single use)                                                                                                                                                                                                                                                                        |
| Staff                 | Any pathway above, plus the authenticator                                   | MFA is mandatory and cannot be turned off; admin routes also need an allowlisted IP and origin, and the riskiest actions a fresh authenticator check (step-up, 10 minutes)                                                                                                                                                                                                                                      |

Texted codes are weaker than an authenticator because numbers can be ported or intercepted.
Phone sign-in (web and app) and the phone number on the profile say so and point to an
authenticator, which every traveller can turn on. Staff must use one.

Bot checks sit in front of the costly or abusable entry points: Turnstile on the web, and device
attestation in the app (ADR-012, ADR-023). The full request limits are in `business-limits.md`.

### Lockout without denial of service

- The sign-in lock is per identifier (an HMAC of the email or phone), starts after 5 failures,
  lasts 30 seconds, and doubles up to 15 minutes.
- A locked account can still sign in with a texted code or a provider. An attacker can delay
  password sign-in for at most 15 minutes at a time.
- Answers do not reveal whether an account exists. A wrong password and an unknown account get
  the same generic error. Registration and password reset answer 202 either way and email the
  owner instead.

### Context-specific words

Passwords may not be built on the words in `PASSWORD_CONTEXT_WORDS`
(`packages/shared/src/auth.ts`): `suskii`, which covers Suskii Travels, Suskii Prime and Suskii
Errands. Look-alike characters are mapped back first, so `Susk11Pr1me!` counts. Passwords also
may not be built on the account's own email name or display name (words of four letters or
more). The list in code is the documentation; tests are in `packages/shared/src/auth.test.ts`
and `apps/api/src/crypto/password-policy.spec.ts`.

### Recovery

- **Forgotten password:** an emailed link (256 bits, 30 minutes, single use, in the URL
  fragment).
  Using the link proves control of the address, ends every session, and never signs the person
  in. MFA is still asked at the next sign-in.
- **Lost authenticator:** a recovery code. Failing that, support resets MFA after the identity
  checks in `docs/runbooks/session-revocation.md`. That proof is as strong as enrolment, which
  needs a signed-in session.
- There are no password hints or security questions.

## Sessions

| Property            | Travellers                                                          | Staff                       |
| ------------------- | ------------------------------------------------------------------- | --------------------------- |
| Access token        | Ed25519 JWT, 15 minutes, audience-bound                             | Same                        |
| Refresh token       | 256-bit opaque, rotated on every use, reuse ends the session        | Same                        |
| Inactivity timeout  | 30 days without a refresh                                           | 30 minutes                  |
| Absolute lifetime   | 90 days                                                             | 12 hours                    |
| Concurrent sessions | 10                                                                  | 3                           |
| Web transport       | `__Secure-` HttpOnly cookies; the refresh cookie only on `/v1/auth` | Same, on the console origin |
| App transport       | Bearer token in memory, refresh token in Keychain or Keystore       | (No staff app)              |

**Why traveller sessions are long.** NIST SP 800-63B AAL1 allows sessions of up to 30 days
before re-authentication. We allow 30 days idle and 90 days absolute, like comparable travel
and retail apps. This is safe enough because:

- the access token lives 15 minutes, and every refresh is checked server-side;
- the session list shows every device, and any of them can be signed out;
- anything sensitive needs fresh proof: data export, account deletion, changing the phone,
  enrolling MFA, and signing out other devices all need a password, a texted code, or a sign-in
  in the last 10 minutes, plus the authenticator when enabled;
- money moves only through hosted checkout, never with stored credentials.

Staff sessions follow AAL2 (12 hours absolute, 30 minutes idle).

**Concurrent sessions.** A new sign-in beyond the cap ends the least recently used session. It
never ends the current one. The ended device must sign in again; the eviction is audited
(`auth.session.evicted`).

**Termination.**

- **Sign-out** revokes the session server-side and denylists it in Redis, so its access tokens
  stop working at once.
- **Automatic:** a password change ends the other sessions; a reset, MFA reset, disabling or
  deleting the account ends all of them.
- **Travellers** can sign out any device from the session list (another device needs fresh
  proof).
- **Staff** with `users:manage` can sign out any account. Operations can sign out all staff or
  everyone with `sessions:revoke`.

**Federation.** Google and Apple only prove identity at sign-in. A Suskii session does not
follow the provider's session: signing out of Google does not end it, and our sign-out does not
end the Google session. Every provider sign-in needs a new ID token with a new nonce. There is
no single sign-on with other Suskii services yet (an open owner question: Suskii Errands).

**Re-authentication and step-up.** Sensitive actions take a proof (`ReauthService`). The
riskiest admin actions take a recent authenticator check (step-up). Both raise assurance on the
current session instead of issuing new tokens. Tokens are only ever issued by the server, in
HttpOnly cookies or response bodies, and are never accepted from URLs, so a session cannot be
fixed by an attacker (accepted deviation from V7.2.4, ADR-048).
