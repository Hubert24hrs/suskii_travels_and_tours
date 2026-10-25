# Terraform: GCP platform and Cloudflare edge

One environment (staging or production) per apply: a GCP project with Cloud Run, Cloud SQL,
Memorystore, a documents bucket, Artifact Registry and Secret Manager. Cloudflare sits in front.
ADR-059 explains the topology; ADR-060 explains how the pipelines deploy onto it.

| Path                   | What                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `live/`                | The root module, applied once per environment                                |
| `modules/platform/`    | GCP: network, database, cache, bucket, registry, secrets, IAM, Cloud Run, LB |
| `modules/run-service/` | One Cloud Run service with the platform's defaults                           |
| `modules/edge/`        | Cloudflare: DNS, TLS, origin secret header, WAF and rate limit rules         |
| `environments/`        | `<environment>.tfvars.example` and `<environment>.gcs.tfbackend.example`     |

Operators apply Terraform from a workstation. CI checks formatting, validates and lints it, but
holds no rights to apply it. The GitHub deployer identity can only deploy new revisions.

## What the owner provides

- **Two GCP projects** with billing: staging and production.
- **Two Cloudflare zones**, one per environment (for example `suskii.com` and
  `suskii-staging.com`; ADR-059). Production on Pro or above for the managed WAF.
- **A Cloudflare API token per zone** with Edit on DNS, Zone Settings, Zone WAF (custom, managed
  and rate limiting rules), Transform Rules and Single Redirect, for that zone only.
- **Provider accounts and keys** for production (payments, flights, email, push and the rest).
  Staging runs on mocks.

## Bootstrap an environment

Run once per environment. The example uses staging; replace the project, region and file names
for production.

```bash
# 0. Tools: Terraform >= 1.11, gcloud, openssl.
export PROJECT=REPLACE-suskii-staging REGION=europe-west2
gcloud config set project "$PROJECT"

# 1. State bucket: private, versioned, in the environment's own project.
gcloud services enable storage.googleapis.com
gcloud storage buckets create "gs://$PROJECT-tfstate" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$PROJECT-tfstate" --versioning

# 2. Values: copy the examples (git-ignored copies) and fill in every REPLACE.
cp environments/staging.tfvars.example environments/staging.tfvars
cp environments/staging.gcs.tfbackend.example environments/staging.gcs.tfbackend

# 3. Credentials for this shell only: Cloudflare token and the origin secret. Keep the origin
#    secret in Secret Manager so every operator applies the same value.
export CLOUDFLARE_API_TOKEN=...   # the zone-scoped token
gcloud services enable secretmanager.googleapis.com
openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48 |
  gcloud secrets create terraform-origin-auth --replication-policy=user-managed \
    --locations="$REGION" --data-file=-
export TF_VAR_origin_auth_secret="$(gcloud secrets versions access latest --secret=terraform-origin-auth)"

# 4. First apply: foundations (deploy_services = false).
cd live
terraform init -backend-config=../environments/staging.gcs.tfbackend
terraform apply -var-file=../environments/staging.tfvars
```

The first apply takes 15 to 25 minutes, mostly for Cloud SQL and Memorystore. The origin
certificate turns active a few minutes after Cloudflare serves its validation records. Check it
with `gcloud certificate-manager certificates describe suskii-staging-origin`.

### 5. Secret values

Every secret the services read needs a version before the services exist, or the first revision
fails. Terraform has already written `DATABASE_URL`, `DATABASE_MIGRATION_URL`, `REDIS_URL` and
`REDIS_TLS_CA`. The app's database role does not exist until the first migrate job creates it, so
the API answers its readiness check only after the first Deploy. Add the rest
without them ever touching a file:

```bash
# Generate the API's keys and paste each value when prompted (nothing is written to disk).
pnpm --filter @suskii/api keys:generate
add() { read -rsp "$1: " value && printf '%s' "$value" | gcloud secrets versions add "$1" --data-file=- && echo; }
for name in JWT_PRIVATE_KEY JWT_PUBLIC_KEY FIELD_ENCRYPTION_KEY HMAC_SECRET \
            CARS_TICKET_SIGNING_KEY INTERNAL_API_TOKEN TURNSTILE_SECRET_KEY; do add "$name"; done

# Documents bucket: an HMAC key for the storage-only identity (its secret is shown once).
gcloud storage hmac create "$(terraform output -raw documents_service_account)"
add OBJECT_STORAGE_ACCESS_KEY_ID
add OBJECT_STORAGE_SECRET_ACCESS_KEY

# Every name in extra_secrets (production: provider keys).
add PAYSTACK_SECRET_KEY   # and so on
```

- **Staging Turnstile.** Staging may use Cloudflare's documented test secret
  `1x0000000000000000000000000000000AA` with the test site key `1x00000000000000000000AA`.
  Production needs a real widget.
- **Other keys.** `CARS_TICKET_SIGNING_KEY` is needed even with buses off, because the service
  references it. `FIELD_ENCRYPTION_KEY_ID` is not secret: set it in `api_env` when it is not `k1`.

### 6. Second apply: services

- Set `deploy_services = true` in the tfvars and apply again. The services start on Google's
  placeholder image.
- Then configure the GitHub environment (below) and run the **Deploy** workflow. It builds,
  scans, signs and pushes the images, runs the migration job and rolls out the services.
- `terraform output` prints what the GitHub environment needs.

### 7. GitHub environment

In the repository settings, create the environments `staging` and `production`:

- **Production protection.** Required reviewers on `production` (at least one person who did not
  push the tag), and deployments only from tags `v*`. Staging allows `main`.
- **Environment variables** (none are secret; the workflows authenticate through Workload Identity
  Federation):
  - `GCP_PROJECT_ID`, `GCP_REGION`;
  - `GCP_WORKLOAD_IDENTITY_PROVIDER` (output `workload_identity_provider`);
  - `GCP_DEPLOYER_SERVICE_ACCOUNT` (output `deployer_service_account`);
  - `ARTIFACT_REGISTRY` (output `artifact_registry`);
  - `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `PUBLIC_ADMIN_URL` (`https://` plus the hosts);
  - `PUBLIC_TURNSTILE_SITE_KEY`, and optionally `PUBLIC_SENTRY_DSN_WEB` and
    `PUBLIC_SENTRY_DSN_ADMIN`.

### 8. First super admin

1. The owner signs up on the website and verifies their email.
2. Check the account, then grant the role. The command refuses once any super admin exists:

   ```bash
   gcloud run jobs execute suskii-staging-ops --region "$REGION" --wait \
     --args=scripts/staff-bootstrap.ts,--email,owner@example.com
   gcloud run jobs execute suskii-staging-ops --region "$REGION" --wait \
     --args=scripts/staff-bootstrap.ts,--email,owner@example.com,--yes
   ```

3. The owner signs in again, enrols an authenticator (`/v1/me/mfa/totp`, prompted by the
   console) and grants every other staff role from the console.

### 9. Verify

- `pnpm smoke --api https://<api host> --web https://<web host> --admin https://<admin host>`
  passes against the environment.
- Fetching `https://<load balancer ip>/` directly, or any `run.app` URL, answers 403 or 404.
- Your own sign-in appears in the console's audit log under your address (a hash), not a
  Cloudflare or Google one.

## Day two

- **Database passwords.** Raise `database_password_version` and apply, then run the Deploy
  workflow straight away.
  - Terraform writes new passwords for both roles to their secrets. The migrator's changes in
    Cloud SQL at once; the app role's when the migrate job runs.
  - New instances read the new app password, so any that start between the apply and the migrate
    job cannot connect. Do it in a quiet hour.
- **A secret value.** Add a version with `gcloud secrets versions add`, then roll a new revision
  (redeploy) so instances read it. Disable the old version after.
- **Origin secret.** Add a version to `terraform-origin-auth`, export it and apply. Cloud Armor and
  the Cloudflare rule change within seconds of each other; do it in a quiet hour.
- **Visitor cipher suites.** With Advanced Certificate Manager on the zone, set `tls_ciphers` to
  the AEAD suites only: `ECDHE-ECDSA-AES128-GCM-SHA256`, `ECDHE-ECDSA-CHACHA20-POLY1305`,
  `ECDHE-RSA-AES128-GCM-SHA256`, `ECDHE-RSA-CHACHA20-POLY1305`, `ECDHE-ECDSA-AES256-GCM-SHA384`,
  `ECDHE-RSA-AES256-GCM-SHA384`. Cloudflare to the origin is already AEAD-only (the load
  balancer's `RESTRICTED` policy).
- **Provider lock file.** After the first `init`, commit `.terraform.lock.hcl`, generated for
  every platform the team uses:
  `terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64`.
- **Removing staging.** Turn off `deletion_protection` in the tfvars, apply, then destroy. The
  documents bucket is never force-destroyed: empty it first on purpose.

## Checks

| Where | What                                                                          |
| ----- | ----------------------------------------------------------------------------- |
| CI    | `terraform fmt -check`, `terraform validate` of `live/` and TFLint on modules |
| Local | `terraform plan` against an environment, with its credentials                 |
