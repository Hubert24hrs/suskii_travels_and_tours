# Deploy, release and roll back

Use this runbook to ship a release, to watch one, and to roll back. The design is in ADR-060
(pipeline) and ADR-059 (platform). Bootstrapping a new environment is in
`infra/terraform/README.md`.

## How a release flows

1. **Merge to main.** CI runs. When it passes, `deploy.yml` deploys that commit to staging:
   images built, scanned, signed; the migrate job; the services; smoke tests.
2. **Tag.** Tag a commit of main that passed CI: `git tag -s v1.4.0 <sha> && git push origin v1.4.0`.
   `release.yml` checks the tag and CI, deploys to staging again (images already exist), then
   waits for approval.
3. **Approve.** A reviewer of the `production` environment approves the run in GitHub (Actions,
   the run, Review deployments). Approve only after looking at staging.
4. **Production.**
   - The migrate job runs first.
   - The API and website candidates take 10% of traffic for 10 minutes, with smoke tests every
     minute and a 5xx check on each candidate.
   - Then everything moves to the new revisions, and the worker and console follow.
   - Any failure puts every service back on its previous revision.

The run's summary lists every image digest it deployed.

## Before tagging

- **Migrations.** Read the migrations since the last tag. Each must keep the previous release
  working; the CI guard enforces it. A contract step (dropping a column the previous release no
  longer reads) goes in its own release, after the release that stopped using it.
- **Sign-off.** Staging works: sign in, search, a mock booking and payment, the console.
- **Changes to secrets or settings** that the release needs are applied first (Terraform,
  `gcloud secrets versions add`). Settings are not part of the image.

## Watching a release

- **The workflow run.** Look at its steps (Canary window, Promote candidates) and its summary.
- **Cloud Run.** Each service's Revisions tab shows which revision takes which share. During the
  canary the candidate carries the tag `candidate`.
- **Signals.** The "Suskii API" Grafana dashboard (`infra/observability`): error rate, latency,
  payment and booking outcomes. Sentry shows new issues tagged with the release (the commit SHA).

## Rolling back

### Automatic

- **No action needed.** When the canary, the promotion, the worker, the console or the smoke
  tests fail, the job moves every service back to the revision that served before the run, and
  the run fails with "Rolling ... back" warnings.
- **The database.** Migrations already applied stay. They are expand-only, so the previous
  release runs on them.

### To an earlier release

Run **Release** by hand (Actions, Release, Run workflow) with the earlier tag. Its images exist,
so the run only redeploys them, through the same approval and canary.

### Emergency (minutes count)

Move traffic back by hand, service by service, then investigate:

```bash
gcloud run revisions list --service suskii-production-api --region europe-west2   # find the last good one
gcloud run services update-traffic suskii-production-api --region europe-west2 \
  --to-revisions suskii-production-api-00041-xyz=100
```

Do the same for `-web`, `-worker` and `-admin` if their new revisions are suspect.

- **Revisions stay until deleted.** Cloud Run keeps old ones, so this works for any revision
  still listed.
- **Pinned traffic.** A later deploy moves traffic to the latest revision again
  (`--to-latest`); nothing stays pinned by accident.

### A migration that went wrong

Rolling back the code does not undo a migration.

- **Prefer a forward fix:** a new migration that repairs the schema, released normally.
- **Data damaged:** restore with point-in-time recovery to a new instance and switch over
  (`docs/runbooks/database-restore.md`). Never run `prisma migrate reset` against a deployed
  database.

## Operator commands (the ops job)

Scripts that change data run inside the VPC as the `ops` Cloud Run job, with the API's identity
and settings. Never run them from a laptop against production. Run each without `--yes` first to
see what it would do.

```bash
# First super admin of a new environment (refuses once one exists).
gcloud run jobs execute suskii-production-ops --region europe-west2 --wait \
  --args=scripts/staff-bootstrap.ts,--email,owner@example.com,--yes

# Incident sign-out (docs/runbooks/session-revocation.md).
gcloud run jobs execute suskii-production-ops --region europe-west2 --wait \
  --args=scripts/revoke-sessions.ts,--staff,--reason,incident-2026-11-02,--yes

# Re-encrypt fields after a key rotation (docs/runbooks/key-rotation.md).
gcloud run jobs execute suskii-production-ops --region europe-west2 --wait \
  --args=scripts/reencrypt-fields.ts
```

Each execution is in Cloud Audit Logs with the caller's identity, and the scripts audit what they
change in the application's audit log.

## Mobile releases

- **Store builds.** Tag `mobile-v1.4.0`. EAS builds the production profile and submits it to
  TestFlight and the Play internal track (as a draft). Promote to production in App Store Connect
  and Play Console after testing.
- **JavaScript-only fixes.** Run **Mobile release** by hand with `action: update` and the
  profile. Only binaries with the same native fingerprint receive it.
- **Retiring a broken app version.** Set `MOBILE_MIN_VERSION` (ADR-041).

## When the pipeline itself fails

- **"The staging environment is not set up".** A variable is missing in the GitHub environment
  (`infra/terraform/README.md`, step 7).
- **Trivy fails an image.** A fixable HIGH or CRITICAL vulnerability.
  - Update the base image digest (Dependabot proposes it) or the dependency.
  - Never skip the scan. An accepted risk goes in a `.trivyignore` entry with a reason and an
    expiry, reviewed like code.
- **"has no staging image for ..." in production.** The commit never reached staging. Deploy it
  to staging first (Deploy staging, Run workflow, with the SHA).
- **Signature verification fails.** Stop. The image was not produced by this repository's
  pipeline. Treat it as a security incident.
