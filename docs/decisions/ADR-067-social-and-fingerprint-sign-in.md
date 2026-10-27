# ADR-067: Google, Apple and fingerprint sign-in, and signing in after registering

- Status: Accepted
- Date: 2026-10-27
- Deciders: Claude Code (implementer), pending owner review

## Context

The owner could not sign up in the app. Two things went wrong:

- **No server.** The test app had no server to reach (ADR-066).
- **No session.** Registration only said "check your email", and the test stack sends no real
  email. The API lets an unconfirmed email sign in, but nobody was told to.

The owner also asked for three things:

- sign-up with a Google or Apple account;
- later sign-ins with the same account;
- fingerprint sign-in.

The API has verified Google and Apple ID tokens since phase 2: JWKS, issuer, audience, expiry, a
single-use nonce, and protection against pre-hijacked accounts. No client used it, and there are
no OAuth client ids yet: they are an owner decision.

## Decision

### Signing in after registering

Registration still answers 202 whether or not the email exists. The website and the app then sign
in with the same email and password:

- A new account goes straight in.
- A password that does not open the account means the email already had one. The page says so
  ("sign in with its password, or reset it") instead of claiming success.

No new information leaks: anyone could try the sign-in anyway.

### Google and Apple

`GET /v1/auth/social/providers` says which buttons to show. Both clients show
"Continue with Google" and "Continue with Apple" under the email form.

- **Website.** The browser goes to the provider for an ID token (Google `response_type=id_token`;
  Apple `code id_token` with `response_mode=fragment`), with a nonce from the API and a random
  state. It comes back to `/sign-in/callback`, which:
  - reads the fragment once and strips it, so the token never reaches a server log;
  - checks the state saved in session storage;
  - signs in with the cookie session.
- **App, iPhone, Apple.** The system Sign in with Apple sheet (`expo-apple-authentication`), with
  the nonce's SHA-256.
- **App, otherwise.** Google everywhere and Apple on Android go through the website.
  1. The app asks for a nonce bound to the SHA-256 of a 256-bit secret only it holds
     (`binding`).
  2. It opens `/sign-in/app` in the system browser.
  3. The callback hands the token back to the app's fixed address (`suskii://auth/social`) with
     the app's state.
  4. The app checks the state and sends the token with the secret (`bindingSecret`). The API
     refuses a bound nonce without the matching secret, so a token another app catches on the
     way back is useless.
- **Why the website.** It needs only the web client id and Apple Services ID. It avoids a native
  Google sign-in module: `expo-auth-session` 57.0.16 failed pnpm's trust-downgrade check, and
  Google no longer allows custom URL schemes for Android OAuth clients. The deep-link resolver
  leaves `suskii://auth/social` to the waiting sign-in screen instead of routing it.
- **Client ids.** The website needs `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and
  `NEXT_PUBLIC_APPLE_SERVICES_ID`; the API needs `GOOGLE_CLIENT_IDS` and `APPLE_CLIENT_IDS`.
  Without them the buttons stay hidden.

### The mock provider on test stacks

`SOCIAL_MOCK_ENABLED` lets a test stack stand in for both providers. Production refuses it, even
with `ALLOW_MOCK_PROVIDERS`, because it signs anyone in as any email.

- **Minting.** `POST /v1/auth/social/mock-token` signs an ID token for the email the tester
  types. It is EdDSA, with a key derived from `HMAC_SECRET` (so every replica agrees) and the
  issuer `https://mock-social.suskii.invalid/{provider}`.
- **Verifying.** The token passes the same verifier as real ones: signature, issuer, audience,
  expiry and single-use nonce.
- **Same account.** The subject is fixed by provider and email, so the same "account" always
  reaches the same user.
- **Where it is on.** The e2e stack and the hosted test server (ADR-066) turn it on. There, both
  buttons ask "Choose a test account" instead of leaving for the provider.

### Fingerprint sign-in (app)

- **Offer.** Once signed in by any method, a phone with a fingerprint or face enrolled offers
  "Use fingerprint" once. It is also under Account.
- **Creating a credential.** `POST /v1/me/device-credentials` works only within 10 minutes of
  signing in. It returns a credential id and a 256-bit secret, once.
- **Storage.** The app stores both in the secure store with `requireAuthentication`, on this
  device only (`WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`). Reading them needs a fresh fingerprint or
  face. A plain flag in `preferences` holds only the credential id, so the sign-in screen can
  offer the button without prompting.
- **Signing in.** `POST /v1/auth/device` trades the credential for a session: auth method
  `device`, AMR `swk`. MFA still applies when it is on. The API keeps only an HMAC of the id and
  secret (`device-credential` key). At most five phones keep one; turning it on for a sixth
  retires the oldest.
- **Ending.** A credential ends with every session of the account: password reset or change,
  sign-out everywhere, staff actions, incident revocation and account deletion. The app forgets a
  credential the API refuses and says how to turn it on again. Signing out keeps it (it is how the
  person signs in again); deleting the account forgets it.
- **Storage rules.** `device_credentials` is in the data registry (exported under MFA, deleted
  with the account). Revoked rows are purged after 30 days (`device-credentials` retention rule).

## Consequences

- **The asked-for flows.** Sign-up works on the test server in one step, by email, Google or
  Apple (mock). Fingerprint sign-in works on any phone with a biometric enrolled.
- **Real providers.** Google and Apple need the owner's OAuth client ids (Google web client, Apple
  Services ID and App ID). They are listed under open questions.
- **Device trust.** Fingerprint sign-in is as strong as the phone's biometric and its secure
  hardware. A copied secret alone could sign in until revoked, which is why it never leaves the
  device's secure store. The user can turn it off for a phone, and every "sign out everywhere"
  ends it.
