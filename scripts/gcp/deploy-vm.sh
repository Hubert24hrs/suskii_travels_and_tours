#!/usr/bin/env bash
# Puts the backend on one Compute Engine VM (ADR-111), the budget shape: the API, the worker and
# the agent service (Ask Suskii's own) in containers beside PostgreSQL, Redis and Caddy, with
# HTTPS, keys in Secret Manager and a nightly dump of the database in a bucket. Run it signed in
# as the owner of the project, in Google Cloud Shell or on any Linux machine with gcloud and
# Node:
#
#   bash scripts/gcp/deploy-vm.sh <project id> [region] [zone]
#
# It can be stopped and run again: every step looks at what exists first. The first run takes
# about 25 minutes, most of it building the images. It creates billable resources.
#
# What it never does: print or store a secret (generated values go straight into Secret
# Manager), log in to the machine (a release reaches it through its metadata), or switch a real
# supplier, payment or message provider on.
#
# Settings, given in the environment and remembered for later runs:
#   ASSISTANT_MODEL=gemini|anthropic|mock   what answers for Ask Suskii, once the model's key is
#                                           in the secret LLM_API_KEY
#   ASSISTANT_ENABLED=true|false            false takes the assistant out of the picture
#   SITES=true|false                        the website and the admin console on the machine too
#   TURNSTILE_SITE_KEY=<key>                the public key of the website's Turnstile widget, once
#                                           its secret is in the secret TURNSTILE_SECRET_KEY
#   SAMPLE_CATALOGUE=true|false             a testing backend's sample packages, tours, buses and
#                                           rental cars, every one marked as a sample
#   MACHINE_TYPE=e2-medium|e2-small         the machine's size (a change restarts it)
# And for one run only:
#   SUSKII_TAG=<tag>                        release images that are built already
set -euo pipefail

PROJECT="${1:-}"
REGION="${2:-europe-west2}"
ZONE="${3:-$REGION-a}"
ENVIRONMENT="staging"
TERRAFORM_VERSION="1.16.5"
TERRAFORM_SHA256="2bc2fcfff033265c9e02ca0351f01794eb122f62a9b2a49a3294b9e49eaab5e4"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TF_DIR="$ROOT/infra/terraform/vm"
TOOLS="${XDG_CACHE_HOME:-$HOME/.cache}/suskii-deploy"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
stop() { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$PROJECT" ] || stop "give the project id: bash scripts/gcp/deploy-vm.sh <project id> [region] [zone]"
command -v gcloud >/dev/null || stop "gcloud is not installed. Run this in Google Cloud Shell: https://shell.cloud.google.com"
command -v node >/dev/null || stop "node is not installed. Run this in Google Cloud Shell."
[ -n "$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ] ||
  stop "no Google account is signed in. In Cloud Shell you are signed in already; elsewhere run: gcloud auth login"

STATE_BUCKET="$PROJECT-tfstate"
BUILD_BUCKET="$PROJECT-build-source"
SETTINGS_OBJECT="gs://$STATE_BUCKET/suskii/vm/settings.auto.tfvars.json"
SETTINGS_FILE="$TF_DIR/settings.auto.tfvars.json"

# --- 0. The project ---------------------------------------------------------------------------
say "Project $PROJECT, zone $ZONE"
gcloud config set project "$PROJECT" --quiet >/dev/null 2>&1
gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null ||
  stop "project $PROJECT was not found, or this account cannot open it."
if [ "$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null)" != "True" ]; then
  stop "billing is not switched on for $PROJECT. Link a billing account at https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT and run this again."
fi

say "Switching on the Google services this needs"
gcloud services enable \
  serviceusage.googleapis.com cloudresourcemanager.googleapis.com storage.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com iam.googleapis.com \
  compute.googleapis.com artifactregistry.googleapis.com servicemanagement.googleapis.com --quiet

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

# What earlier runs decided (the assistant's model). No secret is ever in it.
if gcloud storage objects describe "$SETTINGS_OBJECT" >/dev/null 2>&1; then
  gcloud storage cp "$SETTINGS_OBJECT" "$SETTINGS_FILE" --quiet >/dev/null 2>&1
else
  printf '{\n  "assistant_model": "mock"\n}\n' >"$SETTINGS_FILE"
fi
setting() { node -e 'const s=require(process.argv[1]);process.stdout.write(String(s[process.argv[2]]??""))' "$SETTINGS_FILE" "$1"; }
set_setting() { # set_setting <name> <json value>
  node -e 'const fs=require("fs");const [f,k,v]=process.argv.slice(1);const s=JSON.parse(fs.readFileSync(f,"utf8"));s[k]=JSON.parse(v);fs.writeFileSync(f,JSON.stringify(s,null,2)+"\n")' \
    "$SETTINGS_FILE" "$1" "$2"
  gcloud storage cp "$SETTINGS_FILE" "$SETTINGS_OBJECT" --quiet >/dev/null 2>&1
}
case "${ASSISTANT_MODEL:-}" in
  "") ;;
  gemini | anthropic | mock) set_setting assistant_model "\"$ASSISTANT_MODEL\"" ;;
  *) stop "ASSISTANT_MODEL must be gemini, anthropic or mock." ;;
esac
case "${ASSISTANT_ENABLED:-}" in
  "") ;;
  true | false) set_setting assistant_enabled "$ASSISTANT_ENABLED" ;;
  *) stop "ASSISTANT_ENABLED must be true or false." ;;
esac
case "${SITES:-}" in
  "") ;;
  true | false) set_setting sites "$SITES" ;;
  *) stop "SITES must be true or false." ;;
esac
case "${SAMPLE_CATALOGUE:-}" in
  "") ;;
  true | false) set_setting sample_catalogue "$SAMPLE_CATALOGUE" ;;
  *) stop "SAMPLE_CATALOGUE must be true or false." ;;
esac
case "${MACHINE_TYPE:-}" in
  "") ;;
  e2-medium | e2-small) set_setting machine_type "\"$MACHINE_TYPE\"" ;;
  *) stop "MACHINE_TYPE must be e2-medium or e2-small." ;;
esac
if [ -n "${TURNSTILE_SITE_KEY:-}" ]; then
  [[ "$TURNSTILE_SITE_KEY" =~ ^[A-Za-z0-9_-]+$ ]] || stop "TURNSTILE_SITE_KEY does not look like a Turnstile site key."
  set_setting turnstile_site_key "\"$TURNSTILE_SITE_KEY\""
fi

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
    -var "project_id=$PROJECT" -var "region=$REGION" -var "zone=$ZONE" -var "environment=$ENVIRONMENT" "$@"
}

say "Preparing Terraform"
terraform init -input=false -reconfigure \
  -backend-config="bucket=$STATE_BUCKET" -backend-config="prefix=suskii/vm" >/dev/null

# --- 3. The machine and what it needs ---------------------------------------------------------
say "Creating the network, the address, the buckets, the secrets' names and the machine"
apply

INSTANCE="$(terraform output -raw instance)"
API_URL="$(terraform output -raw api_url)"

# --- 4. Secrets -------------------------------------------------------------------------------
say "Giving the secrets their values (generated here, stored in Secret Manager, never shown)"
node "$ROOT/scripts/gcp/seed-secrets.mjs" --project "$PROJECT" --passwords \
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
    apply >/dev/null
  fi
  unset gemini_key
fi
# The agent service reads the secret whatever the model, so it must hold something.
has_value LLM_API_KEY || printf 'not-set' | gcloud secrets versions add LLM_API_KEY --data-file=- --quiet >/dev/null

# --- 5. Images, built by Cloud Build from this checkout ---------------------------------------
REGISTRY="$(terraform output -raw artifact_registry)"
TAG="${SUSKII_TAG:-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"
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

# The website and the console are built for the addresses they are served on, which are compiled
# into their pages: their tag names the commit and those addresses, so a changed address or
# Turnstile key builds new images instead of reusing the old ones.
SITES_ON="$(terraform output -raw sites)"
SITES_TAG=""
if [ "$SITES_ON" = "true" ]; then
  WEB_URL="$(terraform output -raw web_url)"
  ADMIN_URL="$(terraform output -raw admin_url)"
  SITE_KEY="$(terraform output -raw turnstile_site_key)"
  SITES_TAG="$TAG-$(printf '%s' "$API_URL|$WEB_URL|$ADMIN_URL|$SITE_KEY" | sha256sum | cut -c1-8)"
  if gcloud artifacts docker images describe "$REGISTRY/suskii-admin:$SITES_TAG" >/dev/null 2>&1; then
    say "The website's and the console's images for $SITES_TAG are built already"
  else
    say "Building the website and the console for $SITES_TAG (about 10 minutes)"
    gcloud builds submit "$ROOT" \
      --config="$ROOT/infra/gcp/cloudbuild.sites.yaml" \
      --service-account="projects/$PROJECT/serviceAccounts/$BUILDER" \
      --gcs-source-staging-dir="gs://$BUILD_BUCKET/source" \
      --substitutions="_REGISTRY=$REGISTRY,_TAG=$TAG,_SITES_TAG=$SITES_TAG,_API_URL=$API_URL,_WEB_URL=$WEB_URL,_ADMIN_URL=$ADMIN_URL,_TURNSTILE_SITE_KEY=$SITE_KEY,_ENVIRONMENT=$ENVIRONMENT" \
      --quiet
  fi
fi

# --- 6. The release: named in the machine's metadata, deployed by the machine ------------------
# The number makes this release its own, so the same images can be released again and the
# machine's report of an earlier release is never taken for this one's.
RELEASE="$TAG $(date -u +%s)${SITES_TAG:+ $SITES_TAG}"
say "Releasing $TAG on $INSTANCE"
gcloud compute instances add-metadata "$INSTANCE" --zone "$ZONE" \
  --metadata "suskii-release=$RELEASE" --quiet >/dev/null

read_status() {
  gcloud compute instances get-guest-attributes "$INSTANCE" --zone "$ZONE" \
    --query-path=suskii/status --format='value(value)' 2>/dev/null || true
}
serial() {
  gcloud compute instances get-serial-port-output "$INSTANCE" --zone "$ZONE" --port 1 2>/dev/null |
    grep -E 'suskii|release-database|rror' | tail -n "${1:-25}"
}
outcome=""
for _ in $(seq 1 120); do
  outcome="$(read_status)"
  case "$outcome" in
    "ok $RELEASE"* | "failed $RELEASE"*) break ;;
  esac
  sleep 10
done
echo "  $outcome"
case "$outcome" in
  "ok $RELEASE"*) ;;
  *)
    serial 40
    stop "the machine did not report the release as done. The lines above are from its console; the whole console: gcloud compute instances get-serial-port-output $INSTANCE --zone $ZONE"
    ;;
esac

# --- 7. Is it up? ------------------------------------------------------------------------------
say "Checking $API_URL (the name and the certificate can take a few minutes the first time)"
check() { # check <path> <tries>: the status code, trying every five seconds
  local code=000
  for _ in $(seq 1 "$2"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API_URL$1" || true)"
    [ "$code" = "200" ] && break
    sleep 5
  done
  printf '  %s  %s\n' "$code" "$1"
  [ "$code" = "200" ]
}
failed=0
check /health 60 || failed=1
check /v1/agent/status 3 || failed=1
# The smoke tests the release pipeline runs: public routes only.
sites=()
if [ "$SITES_ON" = "true" ]; then sites=(--web "$WEB_URL" --admin "$ADMIN_URL"); fi
node "$ROOT/scripts/smoke.mjs" --api "$API_URL" "${sites[@]}" --wait 300 || failed=1

cat <<EOF2

------------------------------------------------------------------------------------------------
The backend is on Google Cloud.

  API address          $API_URL
$(if [ "$SITES_ON" = "true" ]; then printf '  Website              %s\n  Admin console        %s\n' "$WEB_URL" "$ADMIN_URL"; fi)
  Project              $PROJECT ($ZONE)
  Machine              $INSTANCE, $(terraform output -raw address)
  Assistant's model    $(setting assistant_model)
  Sample catalogue     $(if [ "$(setting sample_catalogue)" = "true" ]; then echo on; else echo off; fi)
  Last release         $outcome

To run it again after new code is merged: git pull, then the same command.
To give Ask Suskii its Gemini key: add a version to the secret LLM_API_KEY
  (https://console.cloud.google.com/security/secret-manager/secret/LLM_API_KEY/versions?project=$PROJECT),
  then run:  ASSISTANT_MODEL=gemini bash scripts/gcp/deploy-vm.sh $PROJECT $REGION $ZONE
To take the assistant out of the picture (nothing else on the platform changes):
  ASSISTANT_ENABLED=false bash scripts/gcp/deploy-vm.sh $PROJECT $REGION $ZONE
To open the website's sign-up and guest forms: create a Turnstile widget for the website's
  name, add its secret as a version of the secret TURNSTILE_SECRET_KEY, then run:
  TURNSTILE_SITE_KEY=<its site key> bash scripts/gcp/deploy-vm.sh $PROJECT $REGION $ZONE
To show sample packages, tours, buses and rental cars on this testing backend (or to stop):
  SAMPLE_CATALOGUE=true bash scripts/gcp/deploy-vm.sh $PROJECT $REGION $ZONE
To make the first admin (after that person has signed up), from the machine's SSH button:
  sudo /opt/suskii/ops scripts/staff-bootstrap.ts --email THEIR@ADDRESS --yes
------------------------------------------------------------------------------------------------
EOF2
if [ "$failed" -ne 0 ]; then
  stop "one of the checks above did not answer 200 from here. The machine's own report is on the line 'Last release': if it says the address answers, this network cannot reach it (open $API_URL/health in a browser). Otherwise read the machine's console: gcloud compute instances get-serial-port-output $INSTANCE --zone $ZONE"
fi
