# ADR-058: Container images and supply chain

- Status: Accepted
- Date: 2026-10-25
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 12 deploys the API, worker, website and console as containers (Cloud Run by default,
ADR-059; Kubernetes through the optional Helm chart). The repository is a pnpm workspace with a
lockfile, a release cooldown and a trust policy. The images must:

- install exactly what the lockfile says;
- carry no secrets or build tooling at runtime;
- run without root;
- give the release pipeline one artefact per service that it can scan, sign and promote.

## Decision

- **One Dockerfile per service** (`apps/{api,worker,web,admin}/Dockerfile`), built from the
  repository root. Each one does the following:
  - `turbo prune --docker` keeps only the service, its workspace packages and a pruned lockfile.
    The pruned `pnpm-workspace.yaml` keeps the catalog, overrides, allowed build scripts, release
    cooldown and trust policy.
  - Dependencies install with `--frozen-lockfile --ignore-scripts`. Only allowed build scripts
    then run (`pnpm rebuild`).
  - The service and its packages are built with turbo.
  - The runtime stage starts from a clean base with production dependencies only.
- **Base image.** `node:24.21.0-alpine3.24`, pinned by digest, the Node version every test ran
  on. Dependabot's docker ecosystem proposes digest and patch updates; majors follow ADR-002.
- **Runtime hardening.** The image runs as the `node` user (uid 1000), and the code is owned by
  root, so the process cannot change it. The website and console write only to `.next/cache`.
  Compose and the Helm chart run with a read-only root filesystem, no capabilities and
  `no-new-privileges`.
- **API.** Two targets:
  - `runtime` serves the API.
  - `migrate` (the build stage with the Prisma CLI, schema and migrations) runs
    `scripts/release-database.mjs`: `migrate deploy`, then the idempotent reference seed. It runs
    once per release as a job, never at start-up (ADR-060).
- **Website and console.** These use Next.js standalone output, enabled only by
  `NEXT_OUTPUT=standalone` and traced from the repository root. `next start` keeps working for
  local runs and the e2e stack. Next.js inlines `NEXT_PUBLIC_*` at build time, so these two
  images are built per environment from the same commit. The API and worker images take all
  configuration at runtime and are promoted from staging to production by digest.
- **Health checks.** Each image declares one, for compose and Docker; Cloud Run and Kubernetes
  use their own probes on the same paths. The paths are API `/health`, worker `/health`,
  website `/robots.txt` and console `/sign-in`.
- **No secrets in images.** `.dockerignore` excludes `.env*`, `.git`, build output and caches.
  A TLS-intercepting proxy's CA can be passed as a BuildKit secret (`--secret id=ca,...`). It is
  used only during the build stage and never reaches the runtime image.
- **Pipeline.** The pipeline scans every image with Trivy (fixable high and critical fail the
  build), writes a CycloneDX SBOM, pushes by digest and signs keyless with cosign (ADR-060).

## Consequences

- All four images build and run. `scripts/release-rehearsal.mjs` deploys them with
  `NODE_ENV=production`, runs the migration job and the smoke tests, and rehearses a rollback.
- The API image is large (about 970 MB). `@prisma/client` declares the Prisma CLI as a peer, so
  production dependencies include the CLI chain (Studio, TypeScript, `effect`, PGlite). Dropping
  it needs a lockfile generated without auto-installed peers, or a bundled API. This is a
  follow-up, and it does not affect correctness.
- The website and console need one build per environment. Promoting the API and worker by digest
  still guarantees the backend that passed staging is the one in production.
