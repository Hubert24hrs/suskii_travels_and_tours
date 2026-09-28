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

# 2. Optional: local environment overrides (defaults work out of the box)
Copy-Item .env.example .env      # bash/zsh: cp .env.example .env

# 3. Start Postgres 16, Redis 7 and Mailpit (waits until all are healthy)
pnpm infra:up

# 4. Run every app in watch mode
pnpm dev
```

| Service            | URL                                                   |
| ------------------ | ----------------------------------------------------- |
| Web                | http://localhost:3000                                 |
| Admin              | http://localhost:3001                                 |
| API health         | http://localhost:4000/health                          |
| Worker health      | http://localhost:4100/health                          |
| Mailpit (email UI) | http://localhost:8025                                 |
| Expo dev server    | http://localhost:8081 (scan the QR code with Expo Go) |

Run a single app with a filter, for example `pnpm --filter @suskii/api dev`.

## Everyday commands

| Command                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `pnpm build`             | Build all workspaces (Turborepo caches results)      |
| `pnpm lint`              | Type-aware ESLint everywhere                         |
| `pnpm typecheck`         | TypeScript checks everywhere                         |
| `pnpm test`              | Unit tests                                           |
| `pnpm test:e2e`          | API end-to-end tests                                 |
| `pnpm format`            | Format with Prettier                                 |
| `pnpm infra:down`        | Stop local services (data is kept in Docker volumes) |
| `docker compose down -v` | Stop local services and delete their data            |

## Contributing

- Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`,
  `chore:`, ...). A Git hook checks the message and formats and lints staged files.
- Every pull request runs CI: format check, lint, typecheck, unit tests, API e2e tests and build.
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
