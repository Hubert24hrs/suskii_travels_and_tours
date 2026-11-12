# Terraform: GCP platform and Cloudflare edge

One environment (staging or production) per apply: a GCP project with Cloud Run, Cloud SQL,
Memorystore, a documents bucket, Artifact Registry and Secret Manager. Cloudflare sits in front.
ADR-059 explains the topology; ADR-060 explains how the pipelines deploy onto it.

| Path                   | What                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `live/`                | The root module, applied once per environment                                |
| `backend/`             | The backend alone, before the domain and the edge exist (ADR-110)            |
| `vm/`                  | The backend on one Compute Engine machine, the budget shape (ADR-111)        |
| `modules/platform/`    | GCP: network, database, cache, bucket, registry, secrets, IAM, Cloud Run, LB |
| `modules/run-service/` | One Cloud Run service with the platform's defaults                           |
| `modules/edge/`        | Cloudflare: DNS, TLS, origin secret header, WAF, rate limit and cache rules  |
| `modules/monitoring/`  | Cloud Monitoring uptime checks from three regions and their alert policies   |
| `environments/`        | `<environment>.tfvars.example` and `<environment>.gcs.tfbackend.example`     |

Operators apply Terraform from a workstation. CI checks formatting, validates and lints it, but
holds no rights to apply it. The GitHub deployer identity can only deploy new revisions.

## The backend alone (`backend/`)

Before the domain and the Cloudflare zone exist, the backend can go live by itself: the API on
its own `run.app` address, the worker and the agent service reachable from the VPC only, with
the same database, cache, bucket, registry, identities and secrets as below, on the stand-ins
for every provider. The platform module does this with `edge = "none"` (ADR-110): no load
balancer, no certificates, no Cloud Armor, no website and no console.

The owner runs it from Google Cloud Shell with one command, which also gives the secrets their
values, builds the images with Cloud Build and rolls them out:

```bash
bash scripts/gcp/deploy-backend.sh <project id> [region]
```

`docs/owner/deploy-backend-on-google-cloud.md` is the owner's guide. The website and the
console need one site for their cookies, so they come with the domain: apply `live/` to the
same project then, which adds the edge and closes the API's public address. The rest of this
page is about `live/`.

`backend/.terraform.lock.hcl` pins the provider versions this root was validated with, for
Linux (Cloud Shell and CI). On another platform add its checksums first:
`terraform providers lock -platform=darwin_arm64`.

## The backend on one machine (`vm/`)

The budget shape (ADR-111), and the one the owner runs today. One Compute Engine VM in London
runs the release images of the API, the worker and the agent service in containers beside
PostgreSQL, Redis and Caddy (`infra/gcp/vm/compose.yml`, the release compose stack with real
keys). Roughly a fifth of the managed shape's monthly cost, for one machine instead of
several services: a restart takes the backend down for a minute, and the database is ours to
back up (a dump goes to a bucket every night).

```bash
bash scripts/gcp/deploy-vm.sh <project id> [region] [zone]
```

- Terraform creates the network, a fixed address, the machine with a data disk of its own, the
  image repository, the documents and backups buckets, the secrets' names and the identities.
  The API answers on `api.endpoints.<project>.cloud.goog`, Google's free name for the project,
  until `api_host` names the owner's own.
- The stack's files reach the machine as instance metadata, so changing one never replaces
  the machine. A release is named in `suskii-release`; a watcher on the machine deploys it and
  reports to the serial console and the guest attribute `suskii/status`. Nothing logs in.
- The machine reads its keys from Secret Manager as its own identity and gives each container
  only its own. The assistant's container has a ceiling on memory and processor time and is
  started last: a release stands whether or not it comes up.
- The website and the admin console run there too (`sites`, on by default), on
  `web.endpoints.<project>.cloud.goog` and `admin.endpoints.<project>.cloud.goog`. Their
  images are built for those addresses (`infra/gcp/cloudbuild.sites.yaml`).
- To look at the machine: `gcloud compute instances get-serial-port-output <instance> --zone
<zone>`, or SSH from the console's button (Identity-Aware Proxy only).

`backend/` and `live/` stay as they are, for when the budget allows a managed database and
the domain exists: the same images and secrets move over.

## What the owner provides

- **Two GCP projects** with billing: staging and production.
- **Two Cloudflare zones**, one per environment (for example `suskii.com` and
  `suskii-staging.com`; ADR-059). Production on Pro or above for the managed WAF.
- **A Cloudflare API token per zone** with Edit on DNS, Zone Settings, Zone WAF (custom, managed
  and rate limiting rules), Transform Rules, Single Redirect and Cache Rules, for that zone only.
- **Who is told when the site is down** (ADR-087): addresses for `uptime_alert_emails`, or the
  on-call tool's Cloud Monitoring channel ids for `uptime_notification_channels`.
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
  - `PUBLIC_TURNSTILE_SITE_KEY`, and optionally `PUBLIC_SENTRY_DSN_WEB`,
    `PUBLIC_SENTRY_DSN_ADMIN`, `PUBLIC_GOOGLE_CLIENT_ID` and `PUBLIC_APPLE_SERVICES_ID` (Google
    and Apple sign-in, ADR-067; the API's `GOOGLE_CLIENT_IDS` / `APPLE_CLIENT_IDS` must match).

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
- The three uptime checks (Monitoring, Uptime checks: website, api, status) pass from every
  region. If Cloudflare challenges the checkers (Security, Events shows them), the security level
  or a Bot Fight setting is too strict for them; never skip the WAF by user agent, which anyone
  can send.
- `curl -sI https://<api host>/v1/status` twice: the second answer carries `cf-cache-status: HIT`.

## The agent service

The assistant's own service (ADR-101) is not created by default. To add it to an environment
that already runs:

1. **Its secrets first.** A service cannot start on a secret without a value. Add
   `"AGENT_RUN_TOKEN"`, `"AGENT_TOOLS_TOKEN"` and `"LLM_API_KEY"` to `extra_secrets`, apply, then
   give each a value:

   ```bash
   pnpm --filter @suskii/api keys:generate   # prints AGENT_RUN_TOKEN and AGENT_TOOLS_TOKEN
   add AGENT_RUN_TOKEN
   add AGENT_TOOLS_TOKEN
   add LLM_API_KEY                           # the model provider's key
   ```

   Then set `deploy_agent = true` (and `agent_env`, `scaling.agent`) and apply again. Terraform
   adds the identity `suskii-<environment>-agent`, lets it read those three secrets and its own
   `AGENT_DATABASE_URL`, which Terraform writes itself, and creates the service on Google's
   placeholder image.

2. **Deploy.** Run the Deploy workflow. The migrate job now also reads the agent's URL and
   creates its database role, limited to the `agent` schema (ADR-103); the workflow then rolls
   the agent's image out. Its revision takes traffic once `/ready` answers, which needs that
   role.
3. **Point the API at it.** `terraform output agent_internal_url`, set that as `AGENT_URL` in
   `api_env`, apply.
4. **Check before switching on.** Run the agent evals against the model (Actions, Agent evals)
   and record the results in the console. `AGENT_ENABLED = "true"` in `api_env` is the owner's
   decision; until then the website and the app do not show the assistant.

What it can reach: the API's tool gateway (with `AGENT_TOOLS_TOKEN`), its own schema in the
database, and the model provider over HTTPS. What reaches it: traffic from this VPC only, and
of that only requests with `AGENT_RUN_TOKEN` start anything. It has no route through the load
balancer. To remove it: unset `AGENT_ENABLED` and `AGENT_URL`, apply, then set
`deploy_agent = false` and apply.

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
| CI    | The compose rehearsal deploys the agent service and checks its two doors      |
| Local | `terraform plan` against an environment, with its credentials                 |
