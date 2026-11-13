# Suskii Travels and Tour

Your one-stop travel shop: flights, hotels, packages, tours, visa assistance, buses, car rental and
travel add-ons with honest prices and flexible payment, a whole trip booked and paid once, and an
assistant, Ask Suskii, that plans it with the traveller. One NestJS API serves a Next.js website,
an Expo mobile app (iOS and Android) and a Next.js admin console.

- Product and engineering spec: [`PROJECT_SPEC.json`](./PROJECT_SPEC.json)
- Working guide for contributors and Claude Code: [`CLAUDE.md`](./CLAUDE.md)
- Architecture decisions: [`docs/decisions/`](./docs/decisions) (ADR-001 to ADR-118)
- Phase plans: [`docs/phases/`](./docs/phases)
- What the owner still has to do (accounts, keys, legal), step by step: [`docs/owner/launch-checklist.md`](./docs/owner/launch-checklist.md)
- Every stand-in (mock provider, sample data, test switch) to replace before the public launch: [`docs/owner/going-live.md`](./docs/owner/going-live.md)
- The testing backend on Google Cloud and how to redeploy it: [`docs/owner/deploy-backend-on-google-cloud.md`](./docs/owner/deploy-backend-on-google-cloud.md)
- Guides for developers: [`docs/guides/`](./docs/guides) (adding an agent, a tool or a prompt version; adding a web-data vendor or a site to read)

## What is built

Every area below is built and tested on the API, the website and the app (the console where
staff act). Most wait only for the owner's accounts and keys; `CLAUDE.md` holds the status of
each, and the owner's open questions.

| Area                          | What travellers and staff get                                                                                                                                                                  | Where to read more                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Flights                       | Search (one way, return, multi city), flexible dates, nearby airports, bags, seats, meal and group requests, holds, online cancellation, airline changes with a full refund offer, live status | ADR-009, ADR-063 to ADR-065, ADR-073, ADR-093 to ADR-095 |
| Hotels                        | Duffel Stays, Hotelbeds and Expedia adapters merged into one list; photos, room details, filters, collections and deals, a pin map, recent searches                                            | ADR-062, ADR-071, ADR-086, ADR-096, ADR-097              |
| Packages, tours, visa, extras | Suskii's own products with seats, vouchers, visa documents behind signed links, add-ons on their own or linked to a booking                                                                    | ADR-025 to ADR-028                                       |
| Cars                          | Intercity buses with seat maps and QR boarding passes (offline too), car rental by day, week and month; rides are built and stay off in production                                             | `docs/phases/cars.md`, ADR-049 to ADR-056, ADR-098       |
| Combined trips                | A flight, hotel, car, transfer and insurance as one trip with one total and one payment; one details form for every part                                                                       | ADR-099, ADR-117, ADR-118                                |
| Payments                      | Hosted checkout (Paystack, Flutterwave, Stripe) by method, a double entry ledger, holds, installments, refunds with a second approver, risk review                                             | ADR-014 to ADR-019, ADR-040, ADR-074                     |
| Accounts                      | Sign in with a password, Google, Apple or a fingerprint, "Remember me", saved travellers, data export and deletion, Suskii Prime, referrals, alerts                                            | ADR-007, ADR-029 to ADR-032, ADR-067, ADR-108            |
| Companies                     | Members in roles, a travel policy, approval before payment, spend reports, a prepaid company wallet                                                                                            | ADR-078, ADR-090                                         |
| Ask Suskii                    | An assistant on the website, in the app and on WhatsApp that searches, prepares every product, sums up the whole trip and hands over to a person                                               | ADR-101 to ADR-109, ADR-112, ADR-117                     |
| Staff console                 | Roles with MFA, bookings, refunds, catalog, prices, content, support inbox, reviews, the assistant's switches, approvals and assisted quotes                                                   | ADR-033 to ADR-037, ADR-104                              |
| Support and reviews           | Conversations tied to bookings with reply targets, WhatsApp, an after hours assistant; verified reviews of finished trips with moderation                                                      | ADR-077, ADR-083 to ADR-085                              |
| Reach and trust               | Seven languages (Arabic right to left), all-in prices with tax per country, SEO pages from fare history, metasearch, ads with consent, a status page                                           | ADR-072, ADR-075, ADR-076, ADR-079 to ADR-082, ADR-087   |
| Hardening and compliance      | WCAG 2.2 AA, PCI DSS SAQ A payment pages, privacy registers and records of processing, load tests, alerts and runbooks                                                                         | ADR-037 to ADR-048, ADR-088, ADR-089                     |

## Repository layout

| Path              | What it is                                                          |
| ----------------- | ------------------------------------------------------------------- |
| `apps/api`        | NestJS API (REST under `/v1`), shared by every client               |
| `apps/worker`     | Background workers (BullMQ queues and schedules)                    |
| `apps/agent`      | The assistant's agents (LangGraph.js); reaches the API's tools only |
| `apps/web`        | Next.js public website                                              |
| `apps/admin`      | Next.js admin console                                               |
| `apps/mobile`     | Expo React Native app                                               |
| `packages/shared` | Domain constants, Zod schemas, types shared by API and clients      |
| `packages/config` | Shared TypeScript, ESLint, Prettier and Vitest configuration        |
| `infra/`          | Terraform and Helm (phase 12). Local services: `docker-compose.yml` |
| `docs/`           | ADRs, phase plans, runbooks, guides, security and privacy records   |

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

Packages, tours, visa assistance and add-ons are Suskii's own inventory, entered through the
admin API; a fresh database has none. For local work, load clearly marked sample inventory with
`pnpm --filter @suskii/api db:seed:demo` (refused in production), then open
`http://localhost:3000/packages`, `/tours`, `/visa` or `/travel-add-ons`. Confirmed packages and
tours get a voucher code and QR; visa bookings open an application page per applicant where
documents are uploaded, encrypted, virus-scanned (mock scanner by default; run ClamAV with
`docker compose --profile av up -d clamav` and `ANTIVIRUS_PROVIDER=clamav`) and viewed through
short-lived signed links.

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
- **Tests**: `pnpm --filter @suskii/mobile test` (Jest). The Maestro journeys (the critical path,
  a combined trip and more) run in the `Mobile` workflow on an Android emulator; to run them
  locally, start the stack with
  `pnpm --filter @suskii/web e2e:stack`, build the `e2e` APK (see `.github/workflows/mobile.yml`)
  and run `bash apps/mobile/e2e/run-android.sh <apk> maestro-report`.
- **Secret scan**: `pnpm --filter @suskii/mobile build`, then
  `pnpm --filter @suskii/mobile scan:bundle dist`. Everything in the bundle is public, so only
  `EXPO_PUBLIC_*` settings may reach it.
- **Store builds** go through EAS (`Mobile release` workflow) and need the owner's Expo, Apple and
  Google accounts.

### Try the Android test build on a phone

The `Mobile test APK` workflow publishes a sideloadable build at a fixed address:
`https://github.com/Hubert24hrs/suskii_travels_and_tours/releases/download/mobile-test-apk/suskii-travels-test.apk`.
It is published only after the `Phone check` workflow has installed that file on an emulator and
booked with it against the online test server (ADR-100). The app finds the online test server by
itself (`Test server` workflow, ADR-066), so installing it is enough.

To use a stack on your own computer instead, your phone reaches it over your Wi-Fi (ADR-054):

1. Find your computer's address on the network (Windows `ipconfig`, macOS
   `ipconfig getifaddr en0`, Linux `hostname -I`), for example `192.168.1.20`. Phone and computer
   must be on the same Wi-Fi, and the firewall must allow ports 3000 and 4000.
2. With Docker running, build with the website pointed at that address, then start the stack
   (Testcontainers starts Postgres and Redis, migrates and seeds sample data):

   ```bash
   pnpm install
   NEXT_PUBLIC_API_BASE_URL=http://192.168.1.20:4000 pnpm build
   E2E_PUBLIC_WEB_URL=http://192.168.1.20:3000 pnpm --filter @suskii/web e2e:stack
   ```

   In PowerShell set the variables first (`$env:NEXT_PUBLIC_API_BASE_URL = "http://192.168.1.20:4000"`).
   Wait for `STACK READY`.

3. Install the APK on the phone (allow installs from your browser), open it, go to **Account,
   Test server**, enter `http://192.168.1.20:4000` and `http://192.168.1.20:3000`, save, then close
   and reopen the app. Payments use the mock provider page; no real money moves.
4. To take rides, start the stack with `E2E_DEMO_DRIVERS=true` in front of the `e2e:stack` command
   (ADR-056). A sample driver accepts each ride, drives to the pick-up and asks in that terminal
   for the PIN shown in the app. Type it to start the trip; the driver then follows the route and
   completes it.
5. To see Duffel's test-mode flights and hotels instead of the mock suppliers, start the stack
   with `E2E_FLIGHT_SUPPLIERS=duffel` and/or `E2E_HOTEL_SUPPLIERS=duffel` in front of the
   `e2e:stack` command. Put your Duffel test token in `DUFFEL_API_TOKEN`, either in the shell or
   in the root `.env`, which is never committed. The stack refuses a live token.
   - Hotels need Stays enabled on your Duffel account.
   - Duffel Airways (ZZ) is Duffel's test airline.
   - Bookings become test orders, so no money moves.

   In PowerShell:

   ```powershell
   $env:E2E_FLIGHT_SUPPLIERS = "duffel"; $env:E2E_HOTEL_SUPPLIERS = "duffel"
   $env:E2E_PUBLIC_WEB_URL = "http://192.168.1.20:3000"
   pnpm --filter @suskii/web e2e:stack
   ```

   To check the token and both adapters without a phone, run the **Duffel sandbox check**
   workflow (Actions tab). It uses the `DUFFEL_API_TOKEN` repository secret, with `journey` for
   the full API booking journey.

## Cars: buses, rides and car rental

Ground transport runs on the same booking, payment and ledger pipeline as the other products
(`docs/phases/cars.md`, ADR-049 to ADR-053).

- **Sample data**: `pnpm --filter @suskii/api db:seed:demo` adds bus operators and departures,
  Lagos ride places and fare rules, demo drivers and rental cars (all flagged as samples).
- **Flags**: `CARS_BUSES_ENABLED`, `CARS_RIDES_ENABLED`, `CARS_RENTALS_ENABLED` and the feature
  flags (`CARS_PRICE_BREAKDOWN_ENABLED`, `CARS_DEPARTURE_PLANNER_ENABLED`, `CARS_BUNDLES_ENABLED`,
  `CARS_SAFETY_SUITE_ENABLED`, `CARS_OFFLINE_QR_ENABLED`) are on when unset outside production
  and must be set explicitly in production. `GET /v1/cars/features` tells clients what is on.
- **Keys**: `pnpm --filter @suskii/api keys:generate` also prints `CARS_TICKET_SIGNING_KEY` (the
  Ed25519 key that signs boarding passes); without it the API signs with a key that changes on
  every restart. Rotation keeps the old public key in `CARS_TICKET_PREVIOUS_PUBLIC_KEYS`
  (`docs/runbooks/key-rotation.md`).
- **Providers**: maps, KYC and payouts default to mock adapters (`MAPS_PROVIDER`,
  `KYC_PROVIDER`, `PAYOUT_PROVIDER`); `MAPS_PROVIDER=osrm` with `OSRM_URL` uses a self-hosted
  OSRM. With rides on, production refuses mock routing and KYC unless
  `ALLOW_MOCK_PROVIDERS=true`.
- **Trying it**: book a bus or a rental on `/buses` or `/rentals`. Rides need a signed-in rider
  and an approved driver who is online near the pick-up. Locally,
  `pnpm --filter @suskii/api rides:demo` (API built, sample data seeded, the API's `HMAC_SECRET`
  and `FIELD_ENCRYPTION_KEY` in `.env`) lets the sample drivers take rides and asks you for the
  rider's PIN (ADR-056). Operator agents (role
  `operator_agent`, granted by staff with `ground:manage` when they add the account to an
  operator) scan boarding passes in the app.
- **Tests**: `buses`, `rides`, `drivers`, `rentals`, `cars-data`, `cars-payments` and `cars-p9`
  in the API e2e suite; `e2e/cars.spec.ts` on the website; `cars.spec.ts` in the console; the
  app's `cars-*`, `driver-screens`, `trip-planning` and `offline-scan` tests.

## The assistant and prices from other websites

Suskii Agent is a set of agents that answer travellers on the website, in the app and
(optionally) on WhatsApp, and staff in the console. It is off in production until the owner
switches it on, and search, booking and payment never depend on it
(`docs/phases/ai-agent.md`, ADR-101 to ADR-107).

- **What it may do.** Read what the traveller may read, prepare things a person decides (a
  support handover, a price request, a proposal in the approvals queue), and ask the traveller
  to confirm an action of their own on a card. It never approves or sends a refund, captures a
  payment, posts to the ledger or confirms a booking: those are not tools, and the API does
  not start with one registered. An answer is shown only after a guard in code checked its
  figures, contacts and outcomes against what the tools returned.
- **How it is built.** `apps/agent` is a separate service with no route to the platform but
  the API's tool gateway (`/v1/internal/agent-tools`), where every call is checked against the
  sealed grant of its run. Its working state lives in a database schema of its own.
- **What travellers see.** It is called Ask Suskii and is reached from one button that moves
  around the screen (ADR-109). It searches every product, prepares a booking as a quote and
  hands the traveller its checkout; after a flight it offers the rest of the trip, and when the
  traveller has what they want it sums everything up with one total and, for a signed-in
  traveller, puts the parts on a combined trip that is filled in with one details form and paid
  once (ADR-117, ADR-118). It never books, holds a seat or takes a name, a document or money.
- **Trying it.** `pnpm dev` starts the agent service beside the API with a mock model that
  says one fixed sentence; `AGENT_SERVICE=mock` answers inside the API without the service.
  A real model is Google's Gemini: through Vertex AI as the machine's own identity, with no key
  (`AGENT_MODEL_PROVIDER=vertex`, ADR-112, as on the testing backend), or with a key
  (`gemini`, or `anthropic` for Claude) in `LLM_API_KEY`. The website's chat is on
  `/assistant`, the app's behind the same button and under Account, the staff chat in the
  console under "Ask the assistant".
- **Measuring it.** Three evals run on every change with recorded answers and need no key:
  `pnpm --filter @suskii/agent eval:agent-routing --recorded` (also `-grounding`, `-safety`).
  Against the real model: `infra/gcp/cloudbuild.agent-eval.yaml` on Cloud Build with no key
  (about 2 US dollars a run; the command is in `docs/owner/going-live.md`), or Actions, Agent
  evals, with a key. They passed against Gemini 3.5 Flash on Vertex AI (ADR-112); the prompts
  of ADR-117 wait for their run.
- **Prices from other websites** (price intelligence, ADR-102) are observations, never offers:
  shown as indicative with when and where they were seen, and sold only after a person
  verified the price with a supplier (an assisted quote, ADR-104). Every site starts closed and
  is read only after a person approved it with a recorded basis; none is approved today. Five
  vendor adapters exist beside our own fetcher and the mock; none has been run against a live
  account.
- **Running it.** Staff pause everything from the console within seconds. Runbooks:
  `docs/runbooks/ai-agent.md` and `docs/runbooks/price-intelligence.md`. What it may cost a
  month, as estimates: `docs/owner/assistant-cost-estimate.md`.
- **Extending it.** `docs/guides/adding-an-agent.md` and
  `docs/guides/adding-a-scrape-provider-or-source.md`.

## The testing backend

What runs online today is a testing backend on one Compute Engine machine in London (project
`suskii-travels-staging`, ADR-111): the API, the worker, Ask Suskii, the website and the
console in containers beside PostgreSQL, Redis and Caddy.

| Address                                                     | What                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `https://web.endpoints.suskii-travels-staging.cloud.goog`   | The website                                           |
| `https://admin.endpoints.suskii-travels-staging.cloud.goog` | The staff console                                     |
| `https://api.endpoints.suskii-travels-staging.cloud.goog`   | The API (the app's test build talks to it)            |
| `https://mail.endpoints.suskii-travels-staging.cloud.goog`  | The mailbox that keeps every email it sends (ADR-113) |

- **Redeploying** is one command in Cloud Shell, from the repository folder:
  `git pull && bash scripts/gcp/deploy-vm.sh suskii-travels-staging`. It builds the images on
  Cloud Build and releases them through the machine's metadata; settings given once (such as
  `FLIGHT_SUPPLIERS=duffel`) are remembered.
- **What is real there**: Ask Suskii answers with Gemini on Vertex AI under a cap of 2 US
  dollars a day, and flights come from Duffel's test mode. Everything else is a stand-in:
  payments approve on a test page, exchange rates are made up, the catalogue is samples, and
  email stays in the mailbox. `docs/owner/going-live.md` lists each one and what replaces it.
- **The phone**: the `Mobile test APK` workflow, started with the testing backend's API and
  website addresses, publishes a test build that talks to it.

## Deploying and releasing

What runs online today is the testing backend above (ADR-111). The managed shapes are built and
not applied: Cloud Run behind Cloudflare (ADR-059, the pipeline in ADR-060) and the backend
alone on Cloud Run (ADR-110); they wait for the owner's domains, budget and GitHub environments.

- **Images.** `apps/<app>/Dockerfile`, built from the repository root, for example
  `docker build -f apps/api/Dockerfile --target runtime -t suskii-api:local .` (`--target migrate`
  for the database step).
- **Rehearse a release locally.** Build the six images with the `:local` tags (API, its
  `migrate` target, worker, agent, web, admin), then run `pnpm release:rehearse`. It deploys
  them as production does, checks the agent service's two doors from the inside, refuses a
  broken release and rolls back.
- **A new environment.** `infra/terraform/README.md` covers the GCP project, Cloudflare zone,
  secrets, GitHub environment and the first super admin (`staff:bootstrap`).
- **Releases** (once `DEPLOY_ENABLED` and the GitHub environments exist). Merging to main
  deploys staging. A `v*` tag on main deploys staging, then production after approval, with a
  canary and automatic rollback. Watching and rolling back:
  `docs/runbooks/deploy-and-rollback.md`.
- **Mobile.** `mobile-v*` tags build on EAS and submit to TestFlight and the Play internal track.
  Store listing and privacy form content is in `docs/release/`.
- **Kubernetes** instead of Cloud Run: `infra/helm/suskii`. AWS: `docs/deployment/aws.md`.

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
