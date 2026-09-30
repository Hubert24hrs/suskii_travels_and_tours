# Suskii Travels and Tour

Your one-stop travel shop: flights, hotels, packages, tours, visa assistance and travel add-ons with
honest prices and flexible payment. One NestJS API serves a Next.js website, an Expo mobile app (iOS
and Android) and a Next.js admin console.

- Product and engineering spec: [`PROJECT_SPEC.json`](./PROJECT_SPEC.json)
- Working guide for contributors and Claude Code: [`CLAUDE.md`](./CLAUDE.md)
- Architecture decisions: [`docs/decisions/`](./docs/decisions)
- Phase plans: [`docs/phases/`](./docs/phases)

## Repository layout

| Path              | What it is                                                          |
| ----------------- | ------------------------------------------------------------------- |
| `apps/api`        | NestJS API (REST under `/v1`), shared by every client               |
| `apps/worker`     | Background workers (BullMQ queues arrive in later phases)           |
| `apps/web`        | Next.js public website                                              |
| `apps/admin`      | Next.js admin console                                               |
| `apps/mobile`     | Expo React Native app                                               |
| `packages/shared` | Domain constants, Zod schemas, types shared by API and clients      |
| `packages/config` | Shared TypeScript, ESLint, Prettier and Vitest configuration        |
| `infra/`          | Terraform and Helm (phase 12). Local services: `docker-compose.yml` |
| `docs/`           | ADRs, phase plans, runbooks                                         |

## Prerequisites

| Tool           | Version          | Windows install                                                                  |
| -------------- | ---------------- | -------------------------------------------------------------------------------- |
| Node.js        | 24 LTS (>= 24.9) | `winget install OpenJS.NodeJS.LTS`, or `fnm` / `nvm-windows` (reads `.nvmrc`)    |
| pnpm           | 10.33 (pinned)   | `corepack enable`, then pnpm picks the version from `package.json` automatically |
| Docker Desktop | Current          | `winget install Docker.DockerDesktop` (WSL 2 backend)                            |
| Git            | Current          | `winget install Git.Git`                                                         |

The repository enforces LF line endings through `.gitattributes`, so no `core.autocrlf` changes are
needed. Mobile builds for iOS run on Expo EAS cloud runners, so no Mac or Xcode is required.

## Quick start

The commands work the same in PowerShell, bash and zsh.

```powershell
# 1. Clone and install
git clone https://github.com/hubert24hrs/suskii_travels_and_tours.git
cd suskii_travels_and_tours
corepack enable
pnpm install

# 2. Local environment (the defaults work with docker compose)
Copy-Item .env.example .env      # bash/zsh: cp .env.example .env
# Optional: stable keys so sessions and MFA survive API restarts; paste the output into .env
pnpm --filter @suskii/api keys:generate

# 3. Start Postgres 16, Redis 7 and Mailpit (waits until all are healthy)
pnpm infra:up

# 4. Create the database schema and load reference data (airports, roles, starter content)
pnpm --filter @suskii/api db:deploy
pnpm --filter @suskii/api db:seed

# 5. Run every app in watch mode
pnpm dev

# 6. In a second terminal, once the API is up: fill the homepage deals and hotel prices
pnpm --filter @suskii/worker refresh:once
```

The worker also refreshes deals every 3 hours and hotel destinations every 6 hours while it runs.
It calls the API's internal routes with `INTERNAL_API_TOKEN`; the value in `.env.example` works
locally and is refused in production (generate one with `keys:generate`).

To get a local super admin, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env` before
seeding, sign in, then enrol an authenticator app (`POST /v1/me/mfa/totp`): admin routes require an
MFA-verified session. Emails (verification, password reset) appear in Mailpit; SMS codes use a mock
adapter until an SMS provider is contracted.

Search runs against mock suppliers by default (`FLIGHT_SUPPLIERS=mock`); their offers are synthetic
and labelled `supplier: "mock"`. Try it once the API is up:

```bash
curl -s "http://localhost:4000/v1/catalog/places?q=lagos"
curl -s -X POST http://localhost:4000/v1/flights/searches -H 'Content-Type: application/json' \
  -d '{"slices":[{"origin":"LOS","destination":"LHR","departureDate":"2026-12-10"}],"passengers":{"adults":1,"children":0,"infants":0},"cabinClass":"economy"}'
```

To book end to end locally, open a search such as
`http://localhost:3000/flights/search?trip=one_way&from=LOS&to=ABV&depart=2026-12-10&adults=1`,
pick a fare and complete checkout. Payments use the mock provider: its test page takes no card and
sends a signed webhook to the API. The confirmation email with the e-ticket or voucher appears in
Mailpit, and documents are stored under `.data/objects`. Set `MOCK_REPRICE_RULES=LOS-DXB:500` to
see the price-change consent step on Lagos-Dubai fares. With the worker running, unpaid bookings
expire at their deadline and failed ticketing attempts are retried every minute.

Flexible payment works locally too. Search an international route three or more weeks out, such as
`http://localhost:3000/flights/search?trip=one_way&from=LOS&to=LHR&depart=2026-12-10&adults=1&refundable=1`:
refundable fares offer "Reserve now, pay later", and Flex fares also offer installments, with the
schedule shown before you commit. The booking page then takes each payment, and cancelling a partly
paid plan refunds it through the mock provider. With the worker running, reminders go out 3 days
and 1 day before each due date, missed payments default after the grace period and pending
payments are reconciled. Real providers (`PAYMENT_PROVIDERS=paystack,flutterwave,stripe`) need
test-mode keys in `.env` and their webhook URL, `/v1/payments/webhooks/<provider>`, registered in
the provider dashboard; see ADR-016 for the go-live checklist.

| Service            | URL                                                      |
| ------------------ | -------------------------------------------------------- |
| Web                | http://localhost:3000                                    |
| Admin              | http://localhost:3001                                    |
| API health         | http://localhost:4000/health                             |
| API readiness      | http://localhost:4000/ready                              |
| API contract       | `apps/api/openapi.json` (OpenAPI 3.1)                    |
| Worker health      | http://localhost:4100/health                             |
| Mailpit (email UI) | http://localhost:8025                                    |
| Expo dev server    | http://localhost:8081 (open it in the development build) |

Run a single app with a filter, for example `pnpm --filter @suskii/api dev`.

## Everyday commands

| Command                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `pnpm build`             | Build all workspaces (Turborepo caches results)      |
| `pnpm lint`              | Type-aware ESLint everywhere                         |
| `pnpm typecheck`         | TypeScript checks everywhere                         |
| `pnpm test`              | Unit tests                                           |
| `pnpm test:e2e`          | API and web end-to-end tests (needs Docker running)  |
| `pnpm generate:api`      | Regenerate the OpenAPI document and typed API client |
| `pnpm format`            | Format with Prettier                                 |
| `pnpm infra:down`        | Stop local services (data is kept in Docker volumes) |
| `docker compose down -v` | Stop local services and delete their data            |

The web end-to-end suite (`apps/web/e2e`, Playwright) builds and starts its own API, worker refresh
and web app on ports 4000 and 3000, so stop `pnpm dev` first, then run
`pnpm --filter @suskii/web test:e2e`. It finishes with the Lighthouse gate (mobile performance 90+,
accessibility and SEO 100). Set `E2E_BASE_URL` to test a stack that is already running instead,
and `CHROME_PATH` if Lighthouse cannot find Chromium. Reports land in `apps/web/playwright-report`
and `apps/web/lighthouse-report`.

## Mobile app

The app uses native modules (Keychain / Keystore, an encrypted cache, device attestation), so it
runs in a development build of the app rather than Expo Go.

- **Android**: with Android Studio and an emulator, `pnpm --filter @suskii/mobile android` builds
  and installs the development build and starts Metro. Run `adb reverse tcp:4000 tcp:4000` so the
  emulator reaches the local API on `localhost`; a physical phone needs
  `EXPO_PUBLIC_API_BASE_URL=http://<your-computer's-LAN-IP>:4000` (plain http is allowed only for
  development and e2e builds).
- **iOS**: build the development client on EAS (`eas build --profile development --platform ios`)
  once the Expo account exists, or run `pnpm --filter @suskii/mobile ios` on a Mac with Xcode.
- **Tests**: `pnpm --filter @suskii/mobile test` (Jest). The Maestro critical path runs in the
  `Mobile` workflow on an Android emulator; to run it locally, start the stack with
  `pnpm --filter @suskii/web e2e:stack`, build the `e2e` APK (see `.github/workflows/mobile.yml`)
  and run `bash apps/mobile/e2e/run-android.sh <apk> maestro-report`.
- **Secret scan**: `pnpm --filter @suskii/mobile build`, then
  `pnpm --filter @suskii/mobile scan:bundle dist`. Everything in the bundle is public, so only
  `EXPO_PUBLIC_*` settings may reach it.
- **Store builds** go through EAS (`Mobile release` workflow) and need the owner's Expo, Apple and
  Google accounts.

## Contributing

- Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`,
  `chore:`, ...). A Git hook checks the message and formats and lints staged files.
- Every pull request runs CI: format check, lint, typecheck, unit tests, API e2e tests, an OpenAPI
  drift check and build. After changing an API endpoint, run `pnpm generate:api` and commit the
  regenerated files.
- Never commit `.env` files or credentials. Add new variables to `.env.example` with an empty or
  local-only value.

## Troubleshooting (Windows)

- **`ERR_PNPM_UNSUPPORTED_ENGINE`**: your Node.js is older than 24.9. Install Node 24 LTS and reopen
  the terminal.
- **Ports already in use**: override `POSTGRES_PORT`, `REDIS_PORT`, `MAILPIT_SMTP_PORT` or
  `MAILPIT_UI_PORT` in `.env`, then run `pnpm infra:up` again.
- **Scripts blocked in PowerShell** (`running scripts is disabled`): run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **Docker commands hang**: make sure Docker Desktop is running and uses the WSL 2 backend.
- **ui-web tests say Chromium is missing**: run `pnpm --filter @suskii/ui-web exec playwright install chromium` once.
