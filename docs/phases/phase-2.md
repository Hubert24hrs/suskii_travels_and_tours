# Phase 2: Backend core

Status: in progress

## Goal

Turn the API skeleton into a production-grade core that later phases build features on: validated
config, structured logs, tracing, health and readiness, RFC 9457 errors, the database schema and
seed data, a complete authentication and authorisation system, abuse controls, idempotency, an
immutable audit log, and an OpenAPI 3.1 contract with a generated, typed client.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Auth e2e tests pass, including refresh-token reuse detection.
2. OpenAPI spec generated and the client compiles.
3. Security headers and rate limits verified by tests.

## Plan

### Platform (apps/api)

| Area           | Implementation                                                                                                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config         | Zod-validated env with production-only requirements (keys, secure cookies, CORS). Root `.env` loaded in development only                                                                                                                                                   |
| Logging        | nestjs-pino, request IDs (`X-Request-Id` in and out), redaction of credentials, tokens, OTPs and PII                                                                                                                                                                       |
| Tracing        | OpenTelemetry Node SDK, auto-instrumentation, OTLP exporter only when an endpoint is configured                                                                                                                                                                            |
| Errors         | Global filter producing `application/problem+json` (RFC 9457); no stack traces or internals                                                                                                                                                                                |
| Health         | `GET /health` (liveness) and `GET /ready` (Postgres + Redis)                                                                                                                                                                                                               |
| HTTP hardening | helmet (strict CSP for a JSON API, HSTS, nosniff, referrer policy), Permissions-Policy, CORS allowlist, cookie parser, trust-proxy hops, body size limit                                                                                                                   |
| Contracts      | `@Contract()` decorator with Zod schemas: validates body/query/params, filters responses through their schema (no accidental field leaks), and feeds a native OpenAPI 3.1 generator. nestjs-zod and @nestjs/swagger do not support NestJS 12 with Zod-first DTOs (ADR-005) |

### Data (Prisma 7 + PostgreSQL 16)

Identity (User, Role, Permission, UserRole, Session, RefreshToken, MfaFactor, MfaRecoveryCode,
SocialIdentity, VerificationToken), AuditLog (UPDATE and DELETE blocked by a database trigger),
catalog (Country, City, Airport, Airline) and CMS (TrustSignal, CmsBlock, Faq). UUIDv7 IDs.
`pg_trgm` and `unaccent` extensions enabled for the phase 3 autocomplete.

Seed: countries and airports from OurAirports (public domain) with IANA time zones computed at dataset
build time, cities derived from airports, roles and permissions from the code catalog, the five trust
signals from the brand guardrails (only three verified), sample CMS blocks and FAQs. Airlines come
from the flight supplier's reference data in phase 3 (ADR-006).

### Auth, authorisation and abuse controls

- Email + password (argon2id, OWASP parameters, 10 to 128 characters, HIBP k-anonymity breach check),
  email verification, password reset, generic error messages.
- Phone OTP (hashed, 5-minute TTL, attempt cap), Google and Apple ID-token sign-in (JWKS-verified,
  enabled when client IDs are configured).
- Access JWT (15 min, EdDSA, `kid`, JWKS at `/.well-known/jwks.json`, previous keys accepted during
  rotation). Opaque refresh tokens stored hashed, rotated on every use; reuse revokes the whole family
  (session) and is audited.
- Web transport: `__Secure-` httpOnly cookies + double-submit CSRF token. Mobile: tokens in the body.
- Sessions with remote sign-out (revocation effective immediately through Redis).
- TOTP MFA (RFC 6238, replay-protected, encrypted secret) with hashed recovery codes; MFA mandatory for
  staff roles on admin routes.
- RBAC: code-defined role to permission catalog in `@suskii/shared`, deny-by-default global guard,
  `@Public()` and `@RequirePermissions()`.
- Account lockout with exponential backoff; Redis sliding-window rate limits per IP, user and route
  (stricter on auth and OTP), with `RateLimit-*` and `Retry-After` headers.
- `Idempotency-Key` interceptor (Redis, 24h): replays, in-flight conflicts, payload mismatch.
- Audit log for auth events, role changes and security events.
- Notification providers behind interfaces: SMTP (Mailpit locally) and mock email; mock SMS.

### OpenAPI and client

`pnpm generate:api` writes `apps/api/openapi.json` and regenerates `packages/api-client`
(openapi-typescript types, openapi-fetch client, TanStack Query hooks). CI fails if either is stale,
and the client must compile.

### Tests

Unit tests for config, crypto, TOTP (RFC vectors), password policy, token rotation, contracts, the
OpenAPI generator and the problem-details filter. E2E tests boot the real app against Postgres and
Redis in Testcontainers and cover every auth flow, refresh reuse detection, CSRF, RBAC and admin MFA,
rate limits, idempotency, security headers and readiness.

## Risks and mitigations

| Risk                                                                                     | Mitigation                                                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Egress policy in this sandbox blocks HIBP, OurAirports' site and Wikidata                | HIBP behind an interface (mocked in tests); datasets fetched from GitHub raw and committed with attribution |
| nestjs-zod / @nestjs/swagger peer ranges exclude NestJS 12                               | Own contract decorator + OpenAPI 3.1 generator using Zod 4's JSON Schema output (ADR-005)                   |
| Prisma 7 changed engines and config (driver adapters, `prisma.config.ts`, new generator) | Follow the bundled docs; generate the client as CommonJS to match the API build                             |
| No public airline dataset that is both current and permissively licensed                 | Airline table now, supplier reference data in phase 3 (ADR-006)                                             |
| Docker needed for e2e tests                                                              | Testcontainers works with Docker Desktop (Windows) and GitHub runners; CI already has Docker                |
