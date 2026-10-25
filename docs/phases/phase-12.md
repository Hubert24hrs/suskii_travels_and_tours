# Phase 12: Deployment and release

Status: in progress

## Goal

Ship the platform: container images for the API, worker, website and console; infrastructure as
code for the default cloud (GCP Cloud Run, Cloud SQL, Memorystore) with the AWS equivalent
documented and an optional Helm chart; the full CI/CD the spec describes (staging on every merge,
production from a tag behind an approval, automatic rollback); the Cloudflare edge; and the store
listing and privacy content the app stores ask for.

## Acceptance criteria (from PROJECT_SPEC.json)

1. Tag release deploys to staging then production with approval.
2. Rollback tested.
3. Mobile builds submitted to TestFlight and Play internal track.

Tasks: Dockerfiles, Terraform for the chosen cloud (default GCP Cloud Run + Cloud SQL +
Memorystore, AWS equivalent documented), optional Helm chart; full CI/CD per `ci_cd`, staging and
production environments, Cloudflare WAF config; store listing assets checklist, privacy nutrition
labels and Data safety form content.

## What the survey found

- **No images, no infrastructure code.** `infra/` holds only the observability dashboards and
  alert rules (phase 11); `infra/README.md` reserves `terraform/`, `helm/` and `github/`.
- **Object storage is filesystem-only.** `OBJECT_STORAGE` accepts `filesystem`, which production
  refuses (Cloud Run's disk is ephemeral). Tickets, vouchers, visa documents, driver documents
  and rental photos need a real bucket.
- **Next.js builds are not standalone.** `next start` needs the whole `node_modules`; an image
  wants `output: 'standalone'` (pnpm monorepo: trace from the repo root).
- **CI** (`ci.yml`, `security.yml`, `mobile*.yml`) covers PR checks, SAST, secret scanning, ZAP,
  k6 and Maestro, but builds no image, deploys nothing and has no release path. `mobile-release.yml`
  builds with EAS but does not submit.
- **Migrations** are applied by `prisma migrate deploy`; nothing checks that a migration is
  backwards-compatible (the spec asks for expand/contract only).
- **Production config** already refuses mock providers (unless `ALLOW_MOCK_PROVIDERS=true`, the
  staging escape hatch), plaintext Postgres, Redis and provider URLs, and missing keys. The
  infrastructure must supply: `DATABASE_URL` (TLS), `REDIS_URL` (`rediss://`), `JWT_*`,
  `FIELD_ENCRYPTION_KEY`, `HMAC_SECRET`, `INTERNAL_API_TOKEN`, `TURNSTILE_SECRET_KEY`,
  `CARS_TICKET_SIGNING_KEY` and the provider keys.
- **Owner accounts.** Every acceptance criterion needs accounts this repository cannot create: a
  GCP project (or AWS account), a Cloudflare zone, an Expo account with an EAS project, an Apple
  Developer account and a Google Play console. Tracked as open questions since phases 7 and 11.

## Plan

### A. Object storage (application change)

- `S3ObjectStorage` (`OBJECT_STORAGE=s3`) behind the existing `ObjectStorage`: SigV4 signing with
  `node:crypto`, no SDK, so one adapter covers AWS S3, Google Cloud Storage (XML API with HMAC
  keys), Cloudflare R2 and MinIO (local tests). Path-style or virtual-host addressing, https in
  production, `redirect: 'error'`, timeouts, server-side encryption header, keys validated as today.
- Config: `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`,
  `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_PATH_STYLE`.
- MinIO under a compose profile; an e2e test runs the adapter against it (put, get, overwrite,
  missing object, delete, key validation); unit tests pin the SigV4 signature to AWS's published
  example. Docs: `external-communications.md`, `crypto-inventory.md`, ADR.

### B. Images

- `apps/{api,worker,web,admin}/Dockerfile`: multi-stage builds from the repo root with
  `turbo prune --docker`, pnpm from the lockfile (`--frozen-lockfile`), Node 24 Alpine, non-root
  user, no shell scripts as entrypoints, `NODE_ENV=production`, `tini`-free (`--init` style signal
  handling by Node), OCI labels, health checks. Next.js apps use `output: 'standalone'` only when
  `NEXT_OUTPUT=standalone` (so `next start` keeps working for e2e). The API image also carries
  the Prisma schema and migrations and runs `migrate` as a separate command (a Cloud Run job or a
  Helm hook), never at start-up.
- `.dockerignore` keeps `.env*`, `.git`, caches and build output out of the context.
- `docker-compose.release.yml`: the four images with Postgres, Redis and MinIO, configured like
  production (`NODE_ENV=production`, TLS-free only on the private compose network through the
  existing `*_ALLOW_PLAINTEXT` flags, `ALLOW_MOCK_PROVIDERS=true` for suppliers and payments).
  Used to rehearse a deploy and a rollback locally and in CI.
- `scripts/smoke.mjs`: post-deploy checks (API `/health` and `/ready`, `/v1/cars/features`, a
  catalog read, website home and `robots.txt`, console sign-in page, security headers present).
- `scripts/check-migrations.mjs`: fails on destructive SQL in new migrations (drop or rename of a
  table or column, type changes, `SET NOT NULL` without a backfill) unless the migration carries an
  `-- expand-contract:` note naming the release that stopped using the column. Runs in CI.

### C. Infrastructure as code

- `infra/terraform/modules/`: `network` (VPC, private service access, Serverless VPC egress),
  `database` (Cloud SQL Postgres 16, private IP only, TLS required, PITR, automated backups,
  deletion protection, IAM-based app user), `cache` (Memorystore Redis 7 with in-transit
  encryption and AUTH), `registry` (Artifact Registry with immutable tags), `secrets` (Secret
  Manager secrets: names and access only, values added out of band), `storage` (private GCS
  bucket, uniform access, versioning, lifecycle, HMAC key for the S3 adapter), `run` (Cloud Run
  services for the API, website and console, the worker as an always-on service, the migration
  job; dedicated service accounts with least privilege, min and max instances, Direct VPC egress,
  secrets mounted as env), `edge` (Cloudflare DNS, proxied records, TLS strict, HSTS, WAF managed
  rules, rate limiting on auth, search and webhooks, bot fight on the website only).
- `infra/terraform/environments/{staging,production}`: remote state in GCS, variables per
  environment, staging with `ALLOW_MOCK_PROVIDERS=true`.
- `infra/helm/suskii`: optional chart (Deployments, a pre-upgrade migration Job, Services,
  Ingress, HPA, PDB, NetworkPolicies, restricted security contexts, probes, external secrets).
- `docs/deployment/aws.md`: the AWS mapping (ECS Fargate or App Runner, RDS, ElastiCache, S3,
  Secrets Manager, CloudFront and WAF, ECR) and what changes in configuration.

### D. CI/CD

- `ci.yml` (PR): adds the migration check and image builds without push.
- `deploy.yml` (push to the default branch): build the four images once, Trivy (fail on fixable
  high and critical), CycloneDX SBOM, push to the registry, cosign keyless signature, then the
  `staging` environment: migration job, deploy, smoke tests.
- `release.yml` (tag `v*`): the same image digests, the `production` environment (required
  reviewers), migration job, a canary revision with 10% of traffic, smoke and error-rate checks,
  promotion to 100% or automatic rollback to the previous revision.
- `infra.yml`: `terraform fmt`/`validate`/`tflint`, `helm lint` and `kubeconform`, and a
  **rollback rehearsal**: a kind cluster gets release N, then release N+1 whose readiness fails;
  `helm upgrade --atomic` must roll back and the smoke tests must pass against release N. The
  same rehearsal runs with the compose release stack (`docker-compose.release.yml`).
- Mobile: `mobile-release.yml` adds EAS Submit (TestFlight, Play internal track) and EAS Update
  channels per environment.
- Deploy jobs stop with a clear error until the owner's credentials exist (GCP Workload Identity
  Federation, registry, Cloudflare token, Expo token): they never pretend to deploy.

### E. Release content and runbooks

- `docs/release/store-listing.md`: assets per store (icons, screenshots per device class, feature
  graphic, texts, keywords, URLs, age rating, review notes and the test account process).
- `docs/release/data-safety.md`: Google Play Data safety answers and Apple privacy labels, derived
  from `DATA_REGISTRY` and `docs/security/data-classification.md`.
- `docs/runbooks/deploy-and-rollback.md`: deploy, canary, rollback (Cloud Run traffic, Helm,
  compose), migration failures, and the expand/contract rules.

## Decisions to record

- ADR-057: S3-compatible object storage without an SDK.
- ADR-058: Container images and supply chain (prune, non-root, Trivy, SBOM, cosign).
- ADR-059: GCP topology (Cloud Run for all four services, Cloud SQL, Memorystore, GCS, Cloudflare
  in front).
- ADR-060: Release pipeline (staging on merge, production from tags with approval, canary,
  automatic rollback, expand/contract migrations).

## Risks

- **No cloud or store accounts here.** The acceptance criteria cannot be met from this
  repository alone. Everything up to the credentials is built and rehearsed (images, compose and
  kind deploys, rollback); the phase report lists exactly what the owner must create.
- **Tool downloads.** Terraform's registry, Helm and kind are blocked in the development sandbox;
  their checks run in GitHub Actions (`infra.yml`), where the network is open.
- **Next.js standalone in a pnpm monorepo** needs the tracing root at the repository; covered by
  building the images in CI and running the smoke tests against them.
