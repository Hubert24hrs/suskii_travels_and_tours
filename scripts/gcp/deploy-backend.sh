#!/usr/bin/env bash
# Puts the backend on Google Cloud in one run (ADR-110): the API, the worker and the agent
# service (Ask Suskii's own) on Cloud Run, with Cloud SQL, Memorystore, a documents bucket,
# Artifact Registry and Secret Manager. Meant for Google Cloud Shell, signed in as the owner of
# the project (it also runs on any Linux machine with gcloud signed in and Node installed):
#
#   git clone https://github.com/Hubert24hrs/suskii_travels_and_tours.git
#   cd suskii_travels_and_tours
#   bash scripts/gcp/deploy-backend.sh <project id> [region]
#
# It can be stopped and run again: every step looks at what exists first. The first run takes
# about 40 minutes, most of it Google creating the database. It creates billable resources.
#
# What it never does: print or store a secret (generated values go straight into Secret
# Manager), deploy the website or the console (they need the domain and the edge, `live/`), or
# switch a real supplier, payment or message provider on (this environment runs on the
# stand-ins until the owner connects the real ones).
set -euo pipefail

PROJECT="${1:-}"
REGION="${2:-europe-west2}"
ENVIRONMENT="staging"
PREFIX="suskii-$ENVIRONMENT"
TERRAFORM_VERSION="1.16.5"
TERRAFORM_SHA256="2bc2fcfff033265c9e02ca0351f01794eb122f62a9b2a49a3294b9e49eaab5e4"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="$ROOT/infra/terraform/backend"
TOOLS="${XDG_CACHE_HOME:-$HOME/.cache}/suskii-deploy"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
stop() { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$PROJECT" ] || stop "give the project id: bash scripts/gcp/deploy-backend.sh <project id> [region]"
command -v gcloud >/dev/null || stop "gcloud is not installed. Run this in Google Cloud Shell: https://shell.cloud.google.com"
command -v node >/dev/null || stop "node is not installed. Run this in Google Cloud Shell."
[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ] ||
  stop "no Google account is signed in. In Cloud Shell you are signed in already; elsewhere run: gcloud auth login"

STATE_BUCKET="$PROJECT-tfstate"
BUILD_BUCKET="$PROJECT-build-source"
SETTINGS_OBJECT="gs://$STATE_BUCKET/suskii/backend/settings.auto.tfvars.json"
SETTINGS_FILE="$TF_DIR/settings.auto.tfvars.json"

# --- 0. The project ---------------------------------------------------------------------------
say "Project $PROJECT, region $REGION"
gcloud config set project "$PROJECT" --quiet >/dev/null
gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null ||
  stop "project $PROJECT was not found, or this account cannot open it."
if [ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null)" != "True" ]; then
  stop "billing is not switched on for $PROJECT. Link a billing account at https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT and run this again."
fi

say "Switching on the Google services this needs"
gcloud services enable \
  serviceusage.googleapis.com cloudresourcemanager.googleapis.com storage.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com iam.googleapis.com --quiet

# --- 1. Terraform, pinned and checked ---------------------------------------------------------
TERRAFORM="$TOOLS/terraform-$TERRAFORM_VERSION/terraform"
if [ ! -x "$TERRAFORM" ]; then
  say "Fetching Terraform $TERRAFORM_VERSION"
  mkdir -p "$(dirname "$TERRAFORM")"
  archive="$(mktemp)"
  curl -sSfL -o "$archive" \
    "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip"
  echo "${TERRAFORM_SHA256}  $archive" | sha256sum --check --strict >/dev/null ||
    stop "the Terraform download does not match its checksum."
  unzip -oq "$archive" terraform -d "$(dirname "$TERRAFORM")" && rm -f "$archive"
fi

# --- 2. Where the state and this deployment's own settings are kept ----------------------------
if ! gcloud storage buckets describe "gs://$STATE_BUCKET" >/dev/null 2>&1; then
  say "Creating the bucket that keeps Terraform's state"
  gcloud storage buckets create "gs://$STATE_BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention --quiet
  gcloud storage buckets update "gs://$STATE_BUCKET" --versioning --quiet
fi

# What earlier runs decided (which stage was reached, the assistant's address and model). No
# secret is ever in it.
if gcloud storage objects describe "$SETTINGS_OBJECT" >/dev/null 2>&1; then
  gcloud storage cp "$SETTINGS_OBJECT" "$SETTINGS_FILE" --quiet >/dev/null
else
  printf '{\n  "deploy_services": false,\n  "agent_url": "",\n  "assistant_model": "mock"\n}\n' >"$SETTINGS_FILE"
fi
setting() { node -e 'const s=require(process.argv[1]);process.stdout.write(String(s[process.argv[2]]??""))' "$SETTINGS_FILE" "$1"; }
set_setting() { # set_setting <name> <json value>
  node -e 'const fs=require("fs");const [f,k,v]=process.argv.slice(1);const s=JSON.parse(fs.readFileSync(f,"utf8"));s[k]=JSON.parse(v);fs.writeFileSync(f,JSON.stringify(s,null,2)+"\n")' \
    "$SETTINGS_FILE" "$1" "$2"
  gcloud storage cp "$SETTINGS_FILE" "$SETTINGS_OBJECT" --quiet >/dev/null
}

# Cloud Shell hands Terraform the owner's identity by itself. Anywhere else Terraform is given
# the signed-in account's own short-lived token, fresh for every call, so one sign-in is enough.
if gcloud auth application-default print-access-token >/dev/null 2>&1; then
  terraform() { "$TERRAFORM" -chdir="$TF_DIR" "$@"; }
else
  terraform() {
    GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)" "$TERRAFORM" -chdir="$TF_DIR" "$@"
  }
fi
apply() {
  terraform apply -input=false -auto-approve \
    -var "project_id=$PROJECT" -var "region=$REGION" -var "environment=$ENVIRONMENT" "$@"
}

say "Preparing Terraform"
terraform init -input=false -reconfigure \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="prefix=suskii/backend" >/dev/null

# --- 3. Foundations: network, database, cache, bucket, registry, identities, secret names ------
if [ "$(setting deploy_services)" != "true" ]; then
  say "Creating the foundations (the database takes 10 to 20 minutes)"
  apply
fi

# --- 4. Secrets -------------------------------------------------------------------------------
say "Giving the secrets their values (generated here, stored in Secret Manager, never shown)"
node "$ROOT/scripts/gcp/seed-secrets.mjs" --project "$PROJECT" \
  --documents-account "$(terraform output -raw documents_service_account)"

has_value() {
  [ -n "$(gcloud secrets versions list "$1" --filter=state=ENABLED --limit=1 --format='value(name)' 2>/dev/null)" ]
}
# The model key of Ask Suskii. With a key the assistant answers with Gemini; without one it
# answers with the built-in stand-in, which calls no provider, so everything else can be tried.
if [ "$(setting assistant_model)" = "mock" ] && [ -t 0 ]; then
  printf '\nAsk Suskii answers with Google Gemini. Paste the Gemini API key now (it is not shown),\nor press Enter to add it later: '
  read -rs gemini_key || gemini_key=""
  printf '\n'
  if [ -n "$gemini_key" ]; then
    printf '%s' "$gemini_key" | gcloud secrets versions add LLM_API_KEY --data-file=- --quiet >/dev/null
    set_setting assistant_model '"gemini"'
    echo "  set   LLM_API_KEY (Gemini)"
  fi
  unset gemini_key
fi
# The agent service reads the secret whatever the model, so it must hold something.
has_value LLM_API_KEY || printf 'not-set' | gcloud secrets versions add LLM_API_KEY --data-file=- --quiet >/dev/null

# --- 5. The services, on Google's placeholder image -------------------------------------------
if [ "$(setting deploy_services)" != "true" ]; then
  set_setting deploy_services true
fi
say "Creating the services"
apply

# The API and the agent service name each other: the agent's address is known only now.
agent_url="$(terraform output -raw agent_internal_url 2>/dev/null || true)"
if [ -n "$agent_url" ] && [ "$(setting agent_url)" != "$agent_url" ]; then
  set_setting agent_url "\"$agent_url\""
  say "Telling the API where the assistant's service is"
  apply
fi

# --- 6. Images, built by Cloud Build from this checkout ---------------------------------------
REGISTRY="$(terraform output -raw artifact_registry)"
TAG="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
BUILDER="suskii-build@$PROJECT.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$BUILDER" >/dev/null 2>&1; then
  say "Creating the identity that builds the images"
  gcloud iam service-accounts create suskii-build --display-name="Suskii image builds" --quiet
fi
if ! gcloud storage buckets describe "gs://$BUILD_BUCKET" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUILD_BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention --quiet
fi
# It may read the source it is handed, write images to this repository and write its logs.
gcloud storage buckets add-iam-policy-binding "gs://$BUILD_BUCKET" \
  --member="serviceAccount:$BUILDER" --role=roles/storage.objectViewer --quiet >/dev/null
gcloud artifacts repositories add-iam-policy-binding suskii --location="$REGION" \
  --member="serviceAccount:$BUILDER" --role=roles/artifactregistry.writer --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$BUILDER" --role=roles/logging.logWriter --condition=None --quiet >/dev/null

if gcloud artifacts docker images describe "$REGISTRY/suskii-agent:$TAG" >/dev/null 2>&1; then
  say "Images for $TAG are built already"
else
  say "Building the images for $TAG (about 15 minutes)"
  gcloud builds submit "$ROOT" \
    --config="$ROOT/infra/gcp/cloudbuild.backend.yaml" \
    --service-account="projects/$PROJECT/serviceAccounts/$BUILDER" \
    --gcs-source-staging-dir="gs://$BUILD_BUCKET/source" \
    --substitutions="_REGISTRY=$REGISTRY,_TAG=$TAG" --quiet
fi

# --- 7. The database step, then the new revisions ---------------------------------------------
say "Running the database step (migrations, reference data, the app's own database role)"
gcloud run jobs update "$PREFIX-migrate" --image "$REGISTRY/suskii-api-migrate:$TAG" --region "$REGION" --quiet >/dev/null
gcloud run jobs execute "$PREFIX-migrate" --region "$REGION" --wait --quiet
gcloud run jobs update "$PREFIX-ops" --image "$REGISTRY/suskii-api-migrate:$TAG" --region "$REGION" --quiet >/dev/null

say "Rolling out the API, the worker and the assistant's service"
for service in api worker agent; do
  gcloud run deploy "$PREFIX-$service" --image "$REGISTRY/suskii-$service:$TAG" --region "$REGION" --quiet
  gcloud run services update-traffic "$PREFIX-$service" --region "$REGION" --to-latest --quiet >/dev/null
done

# --- 8. Is it up? ------------------------------------------------------------------------------
API_URL="$(terraform output -raw api_url)"
say "Checking $API_URL"
check() { # check <path>: the status code, after up to two minutes of trying
  local code=000
  for _ in $(seq 1 24); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_URL$1" || true)"
    [ "$code" = "200" ] && break
    sleep 5
  done
  printf '  %s  %s\n' "$code" "$1"
  [ "$code" = "200" ]
}
failed=0
check /health || failed=1
check /ready || failed=1
check /v1/status || failed=1
check /v1/agent/status || failed=1

cat <<EOF

------------------------------------------------------------------------------------------------
The backend is on Google Cloud.

  API address          $API_URL
  Project              $PROJECT ($REGION)
  Assistant's model    $(setting assistant_model)
  Outbound addresses   $(terraform output -json egress_ips | tr -d '[]"' | tr ',' ' ')

Send these four lines back so the app can be pointed at this backend:

  GCP_PROJECT_ID=$PROJECT
  GCP_REGION=$REGION
  API_URL=$API_URL
  GCP_DEPLOYER_SERVICE_ACCOUNT=$(terraform output -raw deployer_service_account)

To run it again after new code is merged: git pull, then the same command.
To add the Gemini key later: run the same command and paste the key when it asks.
To take the assistant out of the picture at once (nothing else on the platform changes):
  $TERRAFORM -chdir=$TF_DIR apply -var project_id=$PROJECT -var region=$REGION \\
    -var environment=$ENVIRONMENT -var assistant_enabled=false
------------------------------------------------------------------------------------------------
EOF
if [ "$failed" -ne 0 ]; then
  stop "one of the checks above did not answer 200. Look at the service's logs: https://console.cloud.google.com/run?project=$PROJECT"
fi
