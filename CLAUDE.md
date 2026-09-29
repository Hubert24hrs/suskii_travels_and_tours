# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository. The full product and engineering
spec is in [`PROJECT_SPEC.json`](./PROJECT_SPEC.json). Read it before starting a phase. This file is
the working summary and is updated at the end of every phase.

## What we are building

**Suskii Travels and Tour** is a one-stop travel shop: flights, hotels, packages, tours, visa assistance
and travel add-ons, with flexible payment. It ships as:

- `apps/web`: Next.js public website (SEO-heavy, SSR/ISR)
- `apps/mobile`: Expo React Native app (iOS + Android, EAS cloud builds only)
- `apps/admin`: Next.js admin console (RBAC, MFA mandatory)
- `apps/api`: **one** NestJS API shared by all three clients (PostgreSQL + Redis)
- `apps/worker`: BullMQ workers (fare refresh, deals, ticketing reconciliation, notifications, installments)

Primary market: Nigeria, then wider Africa, then global. Default currency `NGN`, default locale `en-NG`.

## Execution protocol (non-negotiable)

1. Phases run strictly in order (see `PROJECT_SPEC.json#/phases`). Don't start phase N+1 until phase N
   meets all its acceptance criteria.
2. At the start of a phase, write the plan to `docs/phases/phase-<n>.md` (files, risks), then implement.
3. At the end of a phase: lint, typecheck, test and build every affected workspace, fix all failures,
   update `CHANGELOG.md` and this file, make one conventional commit per logical unit, then **stop** and
   print a phase report (what was built, how to run it, test results, open issues, decisions needed).
4. Ambiguity: pick the most secure, conventional option, record it as
   `docs/decisions/ADR-<nnn>-<title>.md`, and continue.
5. No `TODO: implement` code in completed phases. Stubs only behind clearly named mock adapters
   (`MockFlightSupplier`, and so on).

## Phase status

| Phase | Name                                             | Status                |
| ----- | ------------------------------------------------ | --------------------- |
| 0     | Foundation and repo bootstrap                    | Done                  |
| 1     | Design tokens and component libraries            | Done                  |
| 2     | Backend core                                     | Done, awaiting review |
| 3     | Search, catalog and supplier adapters            | Not started           |
| 4     | Web homepage                                     | Not started           |
| 5     | Flight and hotel booking flow (web)              | Not started           |
| 6     | Payments, flexible payment and refunds           | Not started           |
| 7     | Mobile app                                       | Not started           |
| 8     | Packages, tours, visa and add-ons                | Not started           |
| 9     | Accounts, Suskii Prime, referrals, notifications | Not started           |
| 10    | Admin console                                    | Not started           |
| 11    | Hardening                                        | Not started           |
| 12    | Deployment and release                           | Not started           |
| 13    | Optional: AI trip search                         | Not started           |

## Repository layout

```
apps/
  api/        NestJS 12 API (CJS output, URI versioning /v1, Jest), Prisma 7, openapi.json
  worker/     Node ESM worker process (Vitest)
  web/        Next.js 16 App Router
  admin/      Next.js 16 App Router (noindex)
  mobile/     Expo SDK 57 + Expo Router + NativeWind 4 (Jest)
packages/
  config/         Shared TSConfig presets, ESLint flat-config factories, Prettier, Vitest base
  shared/         Domain constants, traveller rules, Zod schemas (dual ESM/CJS via tsup)
  design-tokens/  Single token source -> Tailwind v4 theme (web), v3 preset (NativeWind), CSS vars
  ui-web/         Radix-based web components (TS source), Storybook 10, Vitest browser + axe tests
  ui-native/      NativeWind components (TS source), bottom sheets, Jest + RNTL tests
  api-client/     Generated OpenAPI types + openapi-fetch client + TanStack Query hooks (TS source)
  i18n/           README only until phase 4
infra/        Terraform + Helm (phase 12). Local infra lives in the root docker-compose.yml
docs/         decisions/ (ADRs), phases/ (phase plans), runbooks and security docs later
```

## Commands

Run from the repo root. All scripts are cross-platform (PowerShell, bash, zsh).

| Command                                           | What it does                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm install`                                    | Install all workspaces (pnpm 10.33, Node 24 LTS >= 24.9 enforced)   |
| `pnpm infra:up`                                   | `docker compose up -d --wait` (Postgres 16, Redis 7, Mailpit)       |
| `pnpm infra:down`                                 | Stop local infra (data kept in named volumes)                       |
| `pnpm dev`                                        | Run every app in watch mode through Turborepo                       |
| `pnpm build`                                      | Build every workspace (dependencies first)                          |
| `pnpm lint`                                       | ESLint (type-aware) in every workspace                              |
| `pnpm typecheck`                                  | `tsc --noEmit` in every workspace                                   |
| `pnpm test`                                       | Unit tests (Vitest; Vitest browser for ui-web; Jest for API/native) |
| `pnpm build:storybook`                            | Static Storybook for ui-web                                         |
| `pnpm --filter @suskii/ui-web dev`                | Storybook dev server on port 6006                                   |
| `pnpm test:e2e`                                   | API e2e tests: real app + Postgres/Redis in Testcontainers (Docker) |
| `pnpm generate:api`                               | Rebuild `apps/api/openapi.json` and the api-client schema           |
| `pnpm --filter @suskii/api db:deploy` / `db:seed` | Apply migrations / seed reference data (idempotent)                 |
| `pnpm --filter @suskii/api db:migrate`            | Create a migration after editing `prisma/schema.prisma`             |
| `pnpm --filter @suskii/api keys:generate`         | Print fresh JWT keys, encryption key and HMAC secret                |
| `pnpm --filter @suskii/api data:build`            | Refresh `prisma/data` from OurAirports (review the diff)            |
| `pnpm format` / `format:check`                    | Prettier write / check                                              |
| `pnpm --filter @suskii/api dev`                   | Run a single workspace                                              |

Local ports: web `3000`, admin `3001`, API `4000`, worker health `4100`, Expo Metro `8081`,
Postgres `5432`, Redis `6379`, Mailpit SMTP `1025` and UI `8025`. Docker ports bind to `127.0.0.1` only.

Tooling notes for agents:

- Tool versions are newer than most training data (TypeScript 6, NestJS 12, Next.js 16, Expo SDK 57,
  Turborepo 2.11). Read the docs bundled with the installed package before changing its config,
  e.g. `node_modules/turbo/docs/`. Version pins and their reasons are in ADR-002.
- Turborepo's auto-generated `AGENTS.md` is disabled (`agentGuidance: false`); this file is the
  single agent guide.
- The API's Jest runs need `node --experimental-vm-modules` on Node >= 24.9 (NestJS 12 is ESM-only).
  Use the package scripts rather than calling `jest` directly.
- ui-web tests need Chromium: `pnpm --filter @suskii/ui-web exec playwright install chromium`, or
  set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing binary.
- React Native Testing Library 14 APIs are async: `await render(...)`, `await fireEvent.press(...)`.
- Prisma 7: the client is generated into `apps/api/src/generated/prisma` (gitignored, `postinstall`)
  and uses the `pg` driver adapter; `prisma.config.ts` loads the root `.env` for CLI commands.
  Prisma blocks `migrate reset` from agents without the user's consent; create a fresh database or
  use `prisma migrate diff` instead.
- E2E tests reuse running services when `E2E_DATABASE_URL` / `E2E_REDIS_URL` are set (the database
  is truncated, so never point them at data you care about).

## Conventions

### TypeScript and code

- TypeScript `6.0.x`, `strict` plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`. No `any`: use `unknown` and narrow.
- ESLint is type-aware (`typescript-eslint` `recommendedTypeChecked`). `no-floating-promises` and
  `no-misused-promises` are errors, which matters for money and booking code.
- Prefer `async/await`, small pure functions, explicit return types on exported functions.
- Workspace packages are named `@suskii/<name>`. Shared dependency versions live in the
  `catalog:` section of `pnpm-workspace.yaml`. Use `"dep": "catalog:"` in package manifests.
- `packages/shared` is framework-agnostic: no React, Nest or Node-only APIs.

### Architecture rules (from the spec)

- Supplier adapters isolate third-party APIs; domain code never imports vendor SDKs.
- Money: integer minor units (`BIGINT`) + ISO-4217 code. Never floats.
- Timestamps in UTC; flights also store the airport IANA timezone and local time.
- `Idempotency-Key` required on every write that creates bookings, payments or refunds.
- Bookings are driven by an explicit, audited state machine.
- Webhooks are the source of truth for payment status.
- REST under `/v1` (Nest URI versioning); infra probes such as `/health` are version-neutral.

### API conventions (apps/api)

- Every route has a `@Contract()` (Zod params/query/body/responses, `operationId`, documented
  errors). Responses are filtered through their schema, so return plain objects with ISO date
  strings. Register reusable schemas with `named('Name', schema)`. Run `pnpm generate:api` after
  any contract change and commit both generated files (an e2e test and CI check them).
- Routes are authenticated by default. `@Public()` opts out; `@RequirePermissions(...)` and
  `@AdminRoute(...)` (staff + MFA session + IP allowlist) authorise. Inject the caller with
  `@CurrentAuth()`. Permissions come from `ROLE_PERMISSIONS` in `@suskii/shared`.
- Always check resource ownership (answer 404 for other users' resources, never 403).
- Throw `ProblemDetailsException(status, slug, title, detail?)` for client errors; auth helpers
  live in `src/auth/errors.ts`. Never put values, tokens or PII in details.
- Writes that create bookings, payments or refunds set `idempotent: true` in the contract.
- Add stricter limits with `@RateLimit(...)` (policies in `rate-limit.decorator.ts`).
- Record security-relevant actions with `AuditService.record()` (add the action to `AuditAction`),
  inside the same transaction as the change when possible. Metadata: ids and reasons only.
- Hash low-entropy or personal values with `HmacService` (per-purpose keys); encrypt stored secrets
  with `FieldEncryption` using a record-bound context string.
- External providers sit behind abstract classes (`EmailProvider`, `SmsProvider`,
  `BreachedPasswordChecker`) with mock adapters for tests and local development.

### Security guardrails

- Never commit `.env` files, secrets, or real supplier credentials. Use `.env.example` placeholders.
- Never log PII, tokens, passport numbers or payment data.
- Never see or store raw card data (SAQ-A: hosted checkout or tokenised fields only).
- Trust signals are CMS-driven with a `verified` flag. Only verified ones render. IATA accreditation
  and traveller counts stay hidden until proof exists.
- Never use Wakanow names, marks, copy or imagery. The membership is **Suskii Prime**.

### Design system

- `packages/design-tokens/src/tokens.ts` is the only place visual values live. Spec values must stay
  identical to `PROJECT_SPEC.json` (tested); derived tokens are documented in ADR-003/ADR-004.
- Style with token utilities only: `bg-primary`, `text-foreground`, `text-muted`, `text-h2`,
  `p-4` (4px scale), `rounded-lg`, `shadow-card-hover`, `focus-visible:focus-ring`. Tailwind's default
  palette and scales are removed, so `bg-red-500` or `p-7` simply do not exist.
- Never write hex/rgb colours, px/rem lengths, arbitrary values (`w-[13px]`) or literal inline styles
  in components; guard tests fail the build. Native icons take `iconColor` / `iconSize`.
- Orange (`accent`) fills take dark `on-accent` text; inputs use `border-strong` (ADR-004).
- Components contain no user-facing copy: labels are props, so apps pass localised strings.
- New or changed pairings of text and background go in `contrast-contract.ts`.
- New ui-web component = component + story (with a play function for open states) + an entry in
  `src/index.ts`; the story is then axe-checked at mobile and desktop widths automatically.

### Git

- Conventional Commits, enforced by commitlint in the `commit-msg` hook (`feat:`, `fix:`, `chore:`,
  `docs:`, `ci:`, `build:`, `refactor:`, `test:`).
- `pre-commit` runs lint-staged: Prettier on every staged file, ESLint `--fix` on staged TS/JS in
  `apps/*` and `packages/*`.
- Line endings are LF everywhere (`.gitattributes`).

## Key decisions

- [ADR-001: Architecture](docs/decisions/ADR-001-architecture.md)
- [ADR-002: Toolchain and versions](docs/decisions/ADR-002-toolchain-and-versions.md)
- [ADR-003: UI stack and design-token pipeline](docs/decisions/ADR-003-ui-stack-and-token-pipeline.md)
- [ADR-004: Accessible derived colour tokens](docs/decisions/ADR-004-accessible-derived-colour-tokens.md)
- [ADR-005: Zod route contracts and OpenAPI 3.1](docs/decisions/ADR-005-zod-contracts-and-openapi.md)
- [ADR-006: Reference data sources](docs/decisions/ADR-006-reference-data-sources.md)
- [ADR-007: Authentication, sessions and abuse controls](docs/decisions/ADR-007-authentication-and-sessions.md)

## Open questions for the owner

Tracked in `PROJECT_SPEC.json#/open_questions_for_owner` and repeated in each phase report until they
are answered: suppliers, IATA or consolidator, SSO with Suskii Errands, GCP or AWS, brand assets and legal
entity, Suskii Prime pricing.
