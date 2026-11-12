# ADR-060: Release pipeline, canary and rollback

- Status: Accepted
- Date: 2026-10-25
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec's pipelines are:

- **Pull requests:** checks plus a preview deploy.
- **Main:** e2e, signed and scanned images, deploy to staging, smoke tests.
- **Tags:** manual approval, `prisma migrate deploy` with expand/contract migrations only, a canary
  or rolling production deploy, automatic rollback on failed health checks.
- **Mobile:** EAS builds, EAS Submit to TestFlight and the Play internal track, EAS Update
  channels.

The acceptance criteria for phase 12 are:

- a release tag deploys to staging, then production with approval;
- rollback is tested;
- mobile builds are submitted to the stores' test tracks.

ADR-059 places the services on Cloud Run behind Cloudflare. No cloud, Expo or store account
exists yet.

## Decision

### Environments and triggers

| Workflow                 | Trigger                                              | Does                                                           |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------------------- |
| `ci.yml`                 | pull requests, main                                  | checks, tests, e2e, the migration guard (unchanged otherwise)  |
| `deploy.yml`             | CI green on a main push (once `DEPLOY_ENABLED=true`) | staging deploy of that commit                                  |
| `release.yml`            | tag `v1.2.3` on a commit of main with green CI       | staging, then production after approval, with a canary         |
| `deploy-environment.yml` | called by the two above                              | one deploy of one commit to one environment                    |
| `infra.yml`              | infrastructure changes                               | Terraform and Helm checks, compose and kind release rehearsals |
| `mobile-release.yml`     | `mobile-v*` tags, by hand                            | EAS build (and submit), or an EAS Update                       |

- **Approval.** It is the `production` GitHub environment's required reviewers. The deploy job
  runs in that environment, and Workload Identity Federation accepts tokens only from the
  matching environment (ADR-059). Without approval the job never gets credentials.
- **Gating.** A tag deploys only a commit on main whose CI check passed.

### Images: build once, promote by digest

- **Staging builds the API, migrate and worker images once per commit.** Each image is:
  - scanned by Trivy (a fixable HIGH or CRITICAL finding fails the deploy);
  - pushed under the immutable tag `sha-<commit>`;
  - signed keylessly with cosign (Sigstore, the workflow's GitHub identity);
  - given a CycloneDX SBOM attestation.
- **Production promotes them.** It verifies staging's signatures (identity: this repository's
  `deploy-environment.yml` on main or a release tag), then copies the same digests with
  `cosign copy`. Its deployer may read staging's repository (`registry_readers`).
- **The website and console are built per environment.** Next.js inlines their public settings at
  build time. They come from the same commit and go through the same scan, signature and SBOM.

### Order of a deploy

1. **Database step.** The `migrate` Cloud Run job on the new image:
   - `prisma migrate deploy` as the schema owner;
   - the idempotent reference seed;
   - the app role (ADR-059).

   It runs before any new revision. Migrations must be expand/contract:
   `scripts/check-migrations.mjs` fails CI on a statement that would break the revision still
   serving (drops, renames, type changes, new NOT NULL without default, TRUNCATE) unless the
   migration carries an `-- expand-contract:` line saying why it is safe.

2. **Services.**
   - Cloud Run moves traffic to a revision only once its startup probe passes (`/ready` for the
     API: Postgres and Redis reachable). A revision that fails it takes no traffic and fails the
     deploy.
   - Staging rolls each service forward.
   - Production deploys the API and website as tagged candidates with no traffic, then sends them
     10% for 10 minutes. During that window it runs the smoke tests through Cloudflare every
     minute, then checks each candidate's own 5xx ratio in Cloud Monitoring
     (`scripts/canary-check.mjs`): above 2% with at least 50 requests fails, and fewer requests
     leave the decision to the smoke tests.
   - Then the candidates are promoted, followed by the worker and console.
3. **Smoke tests** against the public hosts (`scripts/smoke.mjs`). The console is checked only
   when GitHub's runners can reach it (`SMOKE_ADMIN`); the edge allowlist usually keeps them out.

### Rollback

- **Automatic.** If anything fails after traffic moved (canary, promotion, worker, console,
  smoke), the deploy job puts every service back on the revision that served before it started.
  The database stays as it is: expand/contract migrations serve both revisions.
- **By hand.**
  - Run `release.yml` with an earlier tag. Its images already exist, so it only redeploys them.
  - In an emergency, `gcloud run services update-traffic <service> --to-revisions <rev>=100`
    (`docs/runbooks/deploy-and-rollback.md`).
- **Helm.** `helm upgrade --atomic` restores the previous revision on failed readiness;
  `helm rollback` goes back by hand.
- **Rehearsed.**
  - `scripts/release-rehearsal.mjs` runs locally and in CI. It deploys release N on the compose
    stack as in production (migrations as the owner, the API as the row-only role), runs the ops
    command, deploys a broken N+1 that the health gate refuses, rolls back and smoke-tests again.
  - `scripts/helm-rehearsal.mjs` runs on kind in CI. It covers install, a broken upgrade rolled
    back by `--atomic`, a manual `helm rollback` and in-cluster smoke tests.

### Mobile

- **Store builds.** `mobile-v*` tags build the production profile on EAS and submit it with the
  EAS Submit profile `production`: TestFlight, and the Play internal track as a draft. Store
  credentials live in EAS: the App Store Connect API key and the Play service account.
  `ascAppId` goes in `eas.json` once the App Store Connect app exists.
- **Over-the-air updates.** A manual run with `action: update` publishes the exported and
  secret-scanned bundle itself (`--skip-bundler`) to the profile's channel. The fingerprint
  runtime policy keeps an update off binaries it does not fit.

### Infrastructure changes

- Terraform is applied by an operator, not by CI. The deployer identity cannot change IAM,
  networks or data services, and Terraform needs exactly those rights.
- CI checks formatting, validation and TFLint (Google ruleset) on every change.

### Pinning

- Actions are pinned by commit SHA. Each was checked to be at least two weeks old, the same
  cooldown as dependencies.
- Binaries are pinned by version and SHA-256 (Terraform, Trivy), or installed with `go install`
  at a fixed version, verified by the Go checksum database (Helm, kubeconform, kind, TFLint).

## Consequences

- **Nothing has deployed yet.** Every workflow that needs an account fails at its first step with
  the missing settings named. `deploy.yml` stays idle until `DEPLOY_ENABLED` is set. The owner
  steps are in `infra/terraform/README.md` and the phase report.
- **First CI runs.** `deploy-environment.yml`, the canary gate against live metrics and the kind
  rehearsal have not run anywhere yet. This sandbox cannot run nested containers or reach GCP.
  Their first runs are the remaining verification. The canary gate's logic and the compose
  rehearsal are tested here.
- **Release length.** A production release takes about 30 to 40 minutes: about 10 minutes of
  canary, plus builds when staging has not built that commit.
- **Preview deploys per pull request are not built.** Cloud Run tagged revisions are reachable
  only inside the VPC (ADR-059), so previews need a separate public route or host. That is
  recorded as an open question. Pull requests still build and test the website and console,
  including Lighthouse.
- **Migration discipline.** Breaking changes become two releases: expand, then contract once no
  revision uses the old shape.
