# ADR-057: S3-compatible object storage without an SDK

- Status: Accepted
- Date: 2026-10-25
- Deciders: Claude Code (implementer), pending owner review

## Context

Tickets, vouchers, visa documents, driver documents and rental photos go through `ObjectStorage`
(`put`, `get`, `delete`). Until now the only adapter wrote to the local disk, which production
refuses: Cloud Run and any container platform give each instance its own ephemeral disk. The
default cloud is GCP (ADR-059), the AWS path must stay open, and Cloudflare is already the
edge.

The options were:

- one adapter per cloud SDK (`@google-cloud/storage`, `@aws-sdk/client-s3`);
- GCS's JSON API with metadata-server tokens;
- the S3 API, which all three stores speak.

## Decision

`S3ObjectStorage` (`OBJECT_STORAGE=s3`) talks to the S3 API directly, with requests signed by
AWS Signature Version 4 (`src/documents/sigv4.ts`, `node:crypto` only). One adapter covers:

- AWS S3;
- Google Cloud Storage (XML API with an HMAC key, region `auto`);
- Cloudflare R2;
- any S3-compatible server for development (Versity's gateway under the compose `s3` profile).

- **Credentials.** A dedicated storage identity whose HMAC key can only read and write the
  documents bucket. The key is stored in the secret manager (`OBJECT_STORAGE_ACCESS_KEY_ID`,
  `OBJECT_STORAGE_SECRET_ACCESS_KEY`).
- **Transport.** https in production unless `OBJECT_STORAGE_ALLOW_PLAINTEXT` declares a private
  network (the compose release rehearsal), with a timeout (`OBJECT_STORAGE_TIMEOUT_MS`) and
  `redirect: 'error'`.
- **Keys.** Object keys keep the existing allowlist (lower-case ids and fixed names), checked
  before any request.
- **Errors.** Failures carry the HTTP status and the store's error code, never the key or the
  credentials.
- **Buckets.** Private, uniform access, versioned and encrypted at rest. All three stores encrypt
  at rest by default; Terraform also sets it. The adapter never creates buckets.
- **What goes in.** Nothing changes in what is stored: visa, driver and rental files were already
  encrypted per file before they reach storage, and generated PDFs carry no secrets.

## Consequences

- No new dependency, so nothing new for the pnpm trust policy or the release cooldown. The signer
  is pinned to the two worked examples in the S3 documentation (unit test).
- `test/object-storage.e2e-spec.ts` runs the adapter against a gateway that checks every
  signature:
  - round trips and overwrites;
  - missing objects;
  - key validation;
  - a rejected signature;
  - the production transport rule.
- An HMAC key is a static secret. It is rotated yearly with a second key so there is no
  downtime (`docs/security/crypto-inventory.md`). A later move to workload identity tokens would
  replace only the credential part of the adapter.
- Only single-request uploads are used. Documents are capped at 10 MB, well under the 5 GB
  single-PUT limit.
