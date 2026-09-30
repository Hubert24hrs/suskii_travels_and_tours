# ADR-023: Device attestation and mobile bot protection

- Status: Accepted
- Date: 2026-09-30
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec asks for Play Integrity and App Attest verification on sensitive endpoints (login,
payment start) and Cloudflare Turnstile on guest checkout. Turnstile is a web widget, so native
apps cannot present it, and the `X-Suskii-Client` header that identifies the mobile app is not a
security control: anyone can send it. Real verification needs the owner's Google Cloud project
(Play Integrity decoding with a service account) and Apple team id and bundle id (App Attest).

## Decisions

1. **Challenge and header.** The app asks `POST /v1/attestation/challenges` for a random,
   single-use challenge (Redis, five minutes), obtains a platform token bound to it and sends
   `X-Suskii-Attestation` (base64url JSON: version, platform, challenge, token and, on iOS, the
   App Attest key id and whether it is a first attestation or an assertion). The API consumes the
   challenge before verifying, so a token cannot be replayed.
2. **Client.** `@expo/app-integrity` (Expo's module for SDK 57): Play Integrity standard requests
   with the request hash set to the challenge hash on Android; on iOS one App Attest key per
   install, attested once, then assertions. Development and e2e builds use a mock token
   (`mock:<challenge>`) selected at build time (`EXPO_PUBLIC_ATTESTATION=mock`), never at runtime.
3. **Verifier interface.** `DeviceAttestationVerifier` with `MockDeviceAttestationVerifier`, which
   accepts only `mock:<challenge>` so tests prove the binding. Production refuses the mock unless
   `ALLOW_MOCK_PROVIDERS=true`. Play Integrity and App Attest verifiers are added when the owner
   provides the Google Cloud project and service account and the Apple team id; until then
   `DEVICE_ATTESTATION=none` rejects every attestation.
4. **Guest checkout.** A guest booking needs a valid Turnstile token or a valid attestation. With
   no verifier configured, mobile guest checkout fails closed in production, as it should: the app
   cannot reach the stores without the same Google and Apple accounts anyway.
5. **Sensitive endpoints.** `ATTESTATION_MODE` (`off`, `report`, `enforce`) applies to login,
   registration and payment start for requests that identify as mobile. `report` verifies and
   logs failures without blocking (for rollout); `enforce` answers 403 `attestation-required`.
   Because the header is spoofable, this is defence in depth against modified apps, not against
   scripts, which remain limited by rate limits, lockout and the guest bot check.

## Consequences

- The attestation hooks are exercised end to end with the mock in tests and the Maestro build;
  real verdicts need the owner's accounts and a device test before launch.
- Adding a real verifier is a new class behind the interface plus environment variables; no
  client change is needed.
