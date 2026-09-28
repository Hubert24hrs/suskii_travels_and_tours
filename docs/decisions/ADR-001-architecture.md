# ADR-001: System architecture

- Status: Accepted
- Date: 2026-09-28
- Deciders: Hubert Labs (owner), Claude Code (implementer)

## Context

Suskii Travels and Tour needs a public website, iOS and Android apps and an admin console for
flights, hotels, packages, tours, visa assistance and add-ons. The business is early-stage, starts in
Nigeria, and has to be fast to market while handling money, personal data (passports) and supplier
integrations safely. One small team will build and run it, with Windows as the main development OS.

## Decision

### 1. One monorepo: Turborepo + pnpm workspaces

All apps and shared packages live in one repository. pnpm gives strict, disk-efficient installs.
Turborepo runs tasks in dependency order and caches them locally and in CI. A pnpm **catalog**
pins one version of every shared dependency.

### 2. One backend: a NestJS modular monolith

A single NestJS API (`apps/api`) serves web, admin and mobile. Each bounded context (auth, catalog,
flight-search, bookings, payments, and so on; see `PROJECT_SPEC.json#/architecture/backend_modules`)
is a Nest module with its own providers and no reaching into another module's persistence.
Cross-module calls go through exported services. That leaves clean seams to extract search, booking
or payments into services later if scale demands it, without paying the cost of distributed systems
on day one.

Background work (fare refresh, deal generation, ticketing reconciliation, notifications, installment
reminders) runs in a separate process, `apps/worker`, on BullMQ over Redis. It deploys and scales
independently from the request-serving API.

### 3. Shared code through workspace packages

| Package                        | Consumers                       | Rule                                                                |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| `@suskii/shared`               | API, worker, web, admin, mobile | Framework-agnostic: Zod schemas, types, constants, money/date utils |
| `@suskii/api-client`           | web, admin, mobile              | Generated from the API's OpenAPI 3.1 spec, never hand-written       |
| `@suskii/design-tokens`        | ui-web, ui-native               | Single source of truth for visual design                            |
| `@suskii/ui-web` / `ui-native` | web + admin / mobile            | Components consume tokens only                                      |
| `@suskii/i18n`                 | web, admin, mobile              | Message catalogs, locale formatting                                 |
| `@suskii/config`               | every workspace                 | Tooling config only, never shipped                                  |

Web, mobile and API validate with the same Zod schemas, so a rule like "infants <= adults" is
written once.

### 4. Data and integration principles (binding for all phases)

- PostgreSQL 16 through Prisma. Redis 7 for cache, rate limits, idempotency keys and queues.
- Money is integer minor units (`BIGINT`) plus an ISO 4217 code. Never floating point.
- Timestamps in UTC. Flights also store the airport's IANA timezone and local time.
- Third-party suppliers (flights, hotels, payments, FX, email, SMS) sit behind interfaces
  (`FlightSupplier`, `PaymentProvider`, ...). Domain code never imports a vendor SDK. Mock adapters
  come first so every flow can be built and tested without credentials.
- Bookings follow an explicit, persisted, audited state machine
  (`PROJECT_SPEC.json#/architecture/booking_state_machine`).
- Payment webhooks are the source of truth. Client redirects only trigger a status poll.
- Writes that create bookings, payments or refunds require an `Idempotency-Key`.

### 5. API conventions

- REST with Nest URI versioning: public routes live under `/v1/...`.
- Infrastructure probes (`/health`, and readiness from phase 2) are version-neutral, so load
  balancer and orchestrator config never changes with API versions.
- The OpenAPI 3.1 document is generated from code and drives `@suskii/api-client`.

### 6. Local infrastructure

`docker-compose.yml` sits at the repo root (so `docker compose up` works without flags) and runs
Postgres 16, Redis 7 (`noeviction`, as BullMQ requires) and Mailpit for email. Ports bind to
`127.0.0.1` only. Cloud infrastructure (Terraform, Helm) lives under `infra/` from phase 12.

## Consequences

Positive:

- One PR can change a schema, the API and all three clients atomically. CI checks them together.
- A single deployable API plus a worker is simple to operate, observe and secure.
- Mock adapters let development proceed before supplier contracts are signed.

Negative, and how we handle them:

- A monolith can grow tangled. Module boundaries are enforced by convention and review now. A lint
  rule to forbid cross-module deep imports can be added once modules exist (phase 2).
- The monorepo's install footprint is large (React Native plus Next.js plus Nest). Turborepo caching
  and `--affected` runs in CI keep feedback fast.
- Shared packages must build before their consumers. Turborepo's `^build` dependency handles it.

## Alternatives considered

- **Microservices from day one**: rejected. Operational cost (service discovery, distributed
  tracing, cross-service transactions for bookings and payments) outweighs the benefits at this stage.
- **Separate repositories per app**: rejected. Types and schemas would drift, and cross-cutting
  changes would need coordinated releases.
- **Nx instead of Turborepo**: viable. Turborepo was chosen for its smaller configuration surface,
  as the spec requested.
- **BFF per client**: rejected for now. One versioned API and a generated client cover all three
  clients. It can be revisited if mobile and web data needs diverge sharply.
