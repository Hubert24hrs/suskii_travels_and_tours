# ADR-038: Social sign-in nonces, field-encryption key rotation and transport security

- Status: Accepted
- Date: 2026-10-06
- Deciders: Claude Code (implementer), pending owner review

## Context

The phase 11 ASVS walk found three protocol and cryptography gaps:

- Google and Apple sign-in accepted an optional nonce chosen by the client, so a leaked ID token
  could be replayed until it expired (V10.5.1, V10.1.2).
- Field encryption had one key and no key id in the envelope, so a key could not be rotated
  without downtime or guesswork (V11.1.1, V11.2.2).
- Nothing required TLS between the API or worker and Postgres, Redis or each other (V12.3.1,
  V12.3.3).

No client uses social sign-in yet. Phase 12 adds a cloud KMS adapter.

## Decisions

1. **Server-issued social nonces.**
   - `POST /v1/auth/social/nonce` (public, rate limited) returns a random 256-bit nonce. Redis
     keeps only its SHA-256, for 10 minutes.
   - Sign-in requires the nonce. The ID token must carry it: raw for Google, SHA-256 hex for
     Apple's native flow.
   - The nonce is consumed atomically (`DEL` returns 1) only after the signature, issuer,
     audience, expiry and nonce claim have all been checked. So a failed attempt leaves the nonce
     for a retry, and a replayed token always fails.
2. **Key ring for field encryption.**
   - New envelopes are `v2.<keyId>.<iv>.<ciphertext>.<tag>` (AES-256-GCM, context as AAD), under
     `FIELD_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_KEY_ID`.
   - Retired keys in `FIELD_ENCRYPTION_PREVIOUS_KEYS` (`id:base64`) keep decrypting.
   - Phase 2 `v1` envelopes have no key id and are tried against every key in the ring. The GCM
     tag rejects the wrong keys.
   - Decryption errors never name a key id.
3. **One registry of encrypted data.**
   - Every context string lives in `src/crypto/encryption-contexts.ts`.
   - Every encrypted column, including envelopes inside JSON (add-on details, sealed idempotent
     responses), is listed in `ENCRYPTED_FIELDS` with its purpose.
   - A unit test parses `schema.prisma` and fails when a column named like ciphertext is not in
     the registry.
   - The cryptography inventory is generated from the same list.
4. **Rotation command.**
   - `pnpm --filter @suskii/api keys:reencrypt` counts envelopes that are not under the current
     key. With `--yes` it rewrites them, in id order, in batches.
   - Each update applies only if the stored envelope is unchanged, so a concurrent write wins.
     Running the command again picks up anything it skipped.
   - Runbook: `docs/runbooks/key-rotation.md`.
5. **TLS in production.**
   - The API refuses to start with a Postgres URL that does not insist on TLS
     (`sslmode=require`, `verify-ca` or `verify-full`, or `ssl=true`), or with `redis://`
     instead of `rediss://`.
   - The worker refuses `redis://` and a non-https `API_INTERNAL_URL`.
   - `DATABASE_ALLOW_PLAINTEXT`, `REDIS_ALLOW_PLAINTEXT` and `API_INTERNAL_ALLOW_PLAINTEXT` are
     explicit opt-outs, for hops that are private and encrypted another way: a Unix socket, a
     local Cloud SQL Auth Proxy, a sidecar, or a mesh with mTLS.
   - Configuration errors name the variable, never its value.

## Consequences

- Mobile and web social sign-in, when added, must fetch a nonce first. Libraries for Google
  Identity Services, Credential Manager and Sign in with Apple all accept one.
- Key rotation is a configuration change, a deploy and one command. The old key is removed only
  after a dry run reports zero envelopes left under it.
- Production deployments must provision TLS endpoints or declare the private hop. Phase 12's
  Terraform and Helm charts set this explicitly.
