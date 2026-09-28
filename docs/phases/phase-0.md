# Phase 0: Foundation and repo bootstrap

Status: complete, awaiting owner review

## Goal

Create a monorepo that installs, lints, typechecks, tests and builds on a clean clone (Windows,
macOS and Linux), with local infrastructure in Docker and a CI workflow that runs on every PR.

## Acceptance criteria (from PROJECT_SPEC.json)

1. `pnpm install && pnpm build` succeeds on a clean clone.
2. `docker compose up` starts Postgres 16, Redis 7 and Mailpit.
3. CI passes on an empty PR.

## Plan

### Root tooling

| File                                                     | Purpose                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `package.json`                                           | Root scripts (turbo tasks, format, infra), `packageManager` pin, engines                    |
| `pnpm-workspace.yaml`                                    | Workspace globs, dependency **catalog** (one version per shared dep), allowed build scripts |
| `turbo.json`                                             | Task graph: `build`, `dev`, `lint`, `typecheck`, `test`, `test:e2e`, `clean`                |
| `.gitattributes`, `.editorconfig`                        | Force LF line endings so Windows checkouts match CI                                         |
| `.nvmrc`                                                 | Node 24 LTS                                                                                 |
| `prettier.config.mjs`, `.prettierignore`                 | Re-export of the shared Prettier config                                                     |
| `commitlint.config.mjs`, `.husky/*`, `.lintstagedrc.mjs` | Conventional commits, Prettier + ESLint on staged files                                     |
| `.env.example`                                           | Every variable from the spec, placeholders only                                             |
| `docker-compose.yml`                                     | Postgres 16, Redis 7 (`noeviction` for BullMQ), Mailpit; ports bound to `127.0.0.1` only    |
| `.github/workflows/ci.yml`                               | install, format check, lint, typecheck, unit, e2e, build                                    |

### Workspaces created in this phase

| Workspace         | Contents in phase 0                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/config` | TSConfig presets, ESLint flat-config factories (base, node, next, expo), Prettier config, Vitest base   |
| `packages/shared` | Product constants from the spec (currencies, locales, verticals) with type guards; dual ESM/CJS build   |
| `apps/api`        | NestJS 12 bootstrap, URI versioning (`/v1`), version-neutral `GET /health`, Jest unit + e2e tests       |
| `apps/worker`     | Node process with Zod-validated env and graceful shutdown; queues arrive in later phases                |
| `apps/web`        | Next.js 16 App Router shell rendering product copy from `@suskii/shared` (no styling until tokens land) |
| `apps/admin`      | Next.js 16 shell, `noindex`                                                                             |
| `apps/mobile`     | Expo SDK 57 + Expo Router shell rendering product copy from `@suskii/shared`                            |

`packages/design-tokens`, `ui-web`, `ui-native`, `api-client`, `i18n` and `infra/terraform`, `infra/helm`
get a README only (no `package.json`), so they are not fake workspaces. Each one is built in the phase
named in its README.

### Docs

`CLAUDE.md`, `README.md` (Windows-first setup), `CHANGELOG.md`, `docs/decisions/ADR-001-architecture.md`,
`docs/decisions/ADR-002-toolchain-and-versions.md`.

## Risks and mitigations

| Risk                                                                  | Mitigation                                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NestJS 12 core is ESM-only; the official app template compiles to CJS | Follow the official template (CJS output, `require(esm)` on Node >= 22.12); shared packages ship dual ESM/CJS so CJS consumers never depend on `require(esm)` |
| TypeScript 7 (native) is not supported by typescript-eslint yet       | Pin TypeScript 6.0.x (ADR-002)                                                                                                                                |
| ESLint 10 not supported by `eslint-plugin-react` (used by Next/Expo)  | Pin ESLint 9.x (ADR-002)                                                                                                                                      |
| Expo + pnpm isolated `node_modules`                                   | Expo SDK 54+ supports isolated installs; verified by bundling the app in CI (`expo export`)                                                                   |
| Duplicate React versions across web and mobile                        | One React version (Expo SDK 57's `19.2.3`) pinned via the pnpm catalog                                                                                        |
| CRLF line endings on Windows breaking Prettier checks and Husky hooks | `.gitattributes` forces LF; `.editorconfig` matches                                                                                                           |

## Implementation notes (what changed versus the plan)

- **Node 24.9+ is now required** (was: Node 22.12+ allowed). Jest 30 can only load the ESM-only
  NestJS 12 packages from CommonJS tests on Node >= 24.9 with `--experimental-vm-modules`. Enforced
  with `engines` + `engineStrict` so a wrong Node version fails at `pnpm install`. See ADR-002.
- **ESLint 10 was tried and reverted to 9.39**: `eslint-plugin-react` (used by both
  `eslint-config-next` and `eslint-config-expo`) crashes on ESLint 10.
- **Expo peer fixes**: `react-dom` added to the mobile app (Expo peer), and pnpm `overrides` pin
  `react-native-worklets` and `@react-native/metro-config` to Expo SDK 57's versions.
- **tsup + TypeScript 6**: tsup's declaration build injects the deprecated `baseUrl`;
  `ignoreDeprecations: "6.0"` is scoped to that step only.
- **Worker** gained a small, tested lifecycle runner (ordered start, reverse-order idempotent stop)
  and a `/health` server, so the process has a real reason to stay alive and orchestrators can probe it.
- Turborepo's auto-generated `AGENTS.md` is disabled; `CLAUDE.md` stays the single agent guide.
  Expo's generated `apps/mobile/.gitignore` is kept because Expo CLI re-creates it.
