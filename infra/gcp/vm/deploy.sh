#!/usr/bin/env bash
# Deploys one release on the backend VM (ADR-111). Started by the watcher when the operator
# sets `suskii-release` on the instance: "<image tag> <a number, so the same tag can be deployed
# again> [<tag of the website's and the console's images>]".
#
# In order: the stack's files from the instance metadata, the keys from Secret Manager into
# memory-only env files, room on the system disk, the images, a dump of the database, the
# database step, then the new containers. The platform first, the assistant after it: an
# assistant that does not come up never fails the release.
# The outcome is written where the operator can read it without a login: the serial console and
# the instance's guest attribute `suskii/status`, which names the whole release so that the
# report of an earlier one is never taken for this one's. No secret is printed.
set -euo pipefail

RELEASE="${1:?usage: deploy.sh \"<image tag> [number] [sites tag]\"}"
read -r TAG _ SITES_TAG <<<"$RELEASE"
MD=http://metadata.google.internal/computeMetadata/v1
md() { curl -sf -H 'Metadata-Flavor: Google' "$MD/$1"; }
status() {
  echo "suskii-deploy: $*"
  curl -sf -X PUT --data "$*" -H 'Metadata-Flavor: Google' \
    "$MD/instance/guest-attributes/suskii/status" >/dev/null || true
}
# What is left on the system disk, where Docker keeps the images ("24G").
free_disk() { df -BG --output=avail / 2>/dev/null | tail -n 1 | tr -d ' ' || true; }
STEP=start
# Any way out but the end is a failure, reported with its step and the room left on the system
# disk. An EXIT trap, not an ERR trap: a function (compose, md) does not inherit an ERR trap, so
# a failure inside one ended the release without a word and the operator waited for nothing.
report_failure() {
  local code=$?
  if [ "$code" -ne 0 ]; then status "failed $RELEASE at $STEP; disk: $(free_disk) free"; fi
}
trap report_failure EXIT

STEP=files
install -d -m 0700 /run/suskii
md instance/attributes/suskii-compose >/opt/suskii/compose.yml
md instance/attributes/suskii-settings >/opt/suskii/settings.json
setting() { python3 -c 'import json, sys; print(json.load(open("/opt/suskii/settings.json")).get(sys.argv[1], ""))' "$1"; }
REGISTRY="$(setting registry)"
# The website and the console run here when the settings say so and their images are named.
SITES=false
if [ "$(setting sites)" = "True" ] && [ -n "${SITES_TAG:-}" ]; then SITES=true; fi
# A testing backend's mailbox (ADR-113): the API's email lands in it and stops there.
MAILBOX=false
if [ "$(setting mailbox)" = "True" ]; then MAILBOX=true; fi
# Only root reads the Caddyfile: with the mailbox it holds the hash of the mailbox's password.
# It is finished, compared and put in place after the keys.
(umask 077 && md instance/attributes/suskii-caddyfile >/opt/suskii/Caddyfile.new)
if [ "$SITES" = true ]; then
  md instance/attributes/suskii-caddyfile-sites >>/opt/suskii/Caddyfile.new
fi
status "deploying $RELEASE"

# The keys: read as the VM's own identity, written to files only root can read, in memory.
STEP=keys
SUSKII_TAG="$TAG" SUSKII_SITES_TAG="${SITES_TAG:-none}" python3 - <<'PY'
import base64, json, os, subprocess, urllib.request

MD = "http://metadata.google.internal/computeMetadata/v1"
settings = json.load(open("/opt/suskii/settings.json"))
project = settings["project_id"]


def get(url, headers):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as answer:
        return answer.read()


token = json.loads(get(f"{MD}/instance/service-accounts/default/token", {"Metadata-Flavor": "Google"}))["access_token"]


def secret(name):
    url = f"https://secretmanager.googleapis.com/v1/projects/{project}/secrets/{name}/versions/latest:access"
    payload = json.loads(get(url, {"Authorization": f"Bearer {token}"}))["payload"]["data"]
    return base64.b64decode(payload).decode().strip()


def write(name, values, mode=0o600):
    path = f"/run/suskii/{name}" if mode == 0o600 else f"/opt/suskii/{name}"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(descriptor, "w") as out:
        for key, value in values.items():
            out.write(f"{key}={value}\n")


owner, app, agent, redis = (
    secret(name)
    for name in ("POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD", "POSTGRES_AGENT_PASSWORD", "REDIS_PASSWORD")
)
database = "postgres:5432/suskii?sslmode=disable"
redis_url = f"redis://:{redis}@redis:6379"

write("postgres.env", {"POSTGRES_PASSWORD": owner})
write("redis.env", {"REDIS_PASSWORD": redis})
write(
    "migrate.env",
    {
        "DATABASE_URL": f"postgresql://suskii:{owner}@{database}",
        "DATABASE_APP_URL": f"postgresql://suskii_app:{app}@{database}",
        "DATABASE_AGENT_URL": f"postgresql://suskii_agent:{agent}@{database}",
    },
)
api_keys = (
    "JWT_PRIVATE_KEY JWT_PUBLIC_KEY FIELD_ENCRYPTION_KEY HMAC_SECRET CARS_TICKET_SIGNING_KEY "
    "INTERNAL_API_TOKEN AGENT_RUN_TOKEN AGENT_TOOLS_TOKEN TURNSTILE_SECRET_KEY "
    "OBJECT_STORAGE_ACCESS_KEY_ID OBJECT_STORAGE_SECRET_ACCESS_KEY"
).split()
api = {
    "DATABASE_URL": f"postgresql://suskii_app:{app}@{database}",
    "REDIS_URL": redis_url,
    **{name: secret(name) for name in api_keys},
}
# Flights and hotels from Duffel (ADR-116): its token only while one of them comes from Duffel,
# and only a test token, because payments here are the stand-in: a live token would book real
# tickets that nobody paid for. The token itself is never printed.
if "duffel" in (settings.get("flight_suppliers"), settings.get("hotel_suppliers")):
    duffel = secret("DUFFEL_API_TOKEN")
    if not duffel.startswith("duffel_test_"):
        raise SystemExit("suskii-deploy: DUFFEL_API_TOKEN must be a Duffel test token (duffel_test_...)")
    api["DUFFEL_API_TOKEN"] = duffel
write("api.env", api)
write("worker.env", {"REDIS_URL": redis_url, "INTERNAL_API_TOKEN": secret("INTERNAL_API_TOKEN")})

# The mailbox's password, for the next step to hash (ADR-113): a file only root reads, in
# memory, deleted as soon as the hash exists.
mailbox = bool(settings.get("mailbox"))
if mailbox:
    descriptor = os.open("/run/suskii/mailbox.password", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as out:
        out.write(secret("MAILBOX_PASSWORD"))

# The assistant's own file: its two tokens, its own database role and what answers. With
# vertex it calls Gemini on Vertex AI as this machine, with a short-lived token from the metadata
# server and no key at all (ADR-112); a model key is read only for a provider that needs one.
model = settings["assistant_model"]
assistant = {
    "AGENT_RUN_TOKEN": secret("AGENT_RUN_TOKEN"),
    "AGENT_TOOLS_TOKEN": secret("AGENT_TOOLS_TOKEN"),
    "AGENT_DATABASE_URL": f"postgresql://suskii_agent:{agent}@{database}",
    "AGENT_MODEL_PROVIDER": model,
}
if model == "vertex":
    assistant["AGENT_VERTEX_PROJECT"] = project
    assistant["AGENT_VERTEX_LOCATION"] = settings.get("assistant_location") or "europe-west2"
elif model in ("gemini", "anthropic"):
    assistant["LLM_API_KEY"] = secret("LLM_API_KEY")
else:
    assistant["ALLOW_MOCK_PROVIDERS"] = "true"
write("agent.env", assistant)

# Names only, no secret: what the compose file fills in.
write(
    "compose.env",
    {
        "SUSKII_REGISTRY": settings["registry"],
        "SUSKII_TAG": os.environ["SUSKII_TAG"],
        "SUSKII_SITES_TAG": os.environ["SUSKII_SITES_TAG"],
        "SUSKII_ENVIRONMENT": settings["environment"],
        "SUSKII_API_HOST": settings["api_host"],
        "SUSKII_WEB_HOST": settings["web_host"],
        "SUSKII_ADMIN_HOST": settings["admin_host"],
        # The parent the API sets its session cookies on (ADR-115); empty without the sites.
        "SUSKII_COOKIE_DOMAIN": settings.get("cookie_domain") or "",
        "SUSKII_DOCUMENTS_BUCKET": settings["documents_bucket"],
        "SUSKII_ASSISTANT_ENABLED": "true" if settings["assistant_enabled"] else "false",
        "SUSKII_SAMPLE_CATALOGUE": "true" if settings.get("sample_catalogue") else "false",
        "SUSKII_FLIGHT_SUPPLIERS": settings.get("flight_suppliers") or "mock",
        "SUSKII_HOTEL_SUPPLIERS": settings.get("hotel_suppliers") or "mock",
        "SUSKII_EMAIL_PROVIDER": "smtp" if mailbox else "mock",
        "SUSKII_MAIL_HOST": settings.get("mail_host") or "mail.suskii.example",
    },
    mode=0o644,
)

# Docker reads the images as the VM's identity: a token that lasts an hour, never a key.
subprocess.run(
    ["docker", "login", "-u", "oauth2accesstoken", "--password-stdin", "https://" + settings["registry"].split("/")[0]],
    input=token.encode(),
    check=True,
    stdout=subprocess.DEVNULL,
)
PY

compose() { docker compose --env-file /opt/suskii/compose.env -f /opt/suskii/compose.yml "$@"; }

# keep_images <release>...: removes this registry's images that none of the named releases uses
# (each "<tag> <number> [<sites tag>]"), then layers no image refers to. An image a container
# uses is never removed, because `docker image rm` refuses it. The system disk (30 GB) holds
# about two releases: keeping two days of them filled it after a busy day of releases, and the
# next release could not unpack its images. Best effort: it never fails a release by itself.
keep_images() {
  local keep=" " release tag sites
  for release in "$@"; do
    read -r tag _ sites <<<"$release" || true
    keep+="${tag:-} ${sites:-} "
  done
  docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | while IFS= read -r image; do
    case "$image" in "$REGISTRY"/*) ;; *) continue ;; esac
    case "$keep" in *" ${image##*:} "*) continue ;; esac
    docker image rm "$image" >/dev/null 2>&1 || true
  done || true
  docker image prune -f >/dev/null 2>&1 || true
}

# Operator commands, for a person logged in to the machine: sudo /opt/suskii/ops <script> [...]
cat >/opt/suskii/ops <<'OPS'
#!/usr/bin/env bash
exec docker compose --env-file /opt/suskii/compose.env -f /opt/suskii/compose.yml \
  --profile ops run --rm ops "$@"
OPS
chmod 0755 /opt/suskii/ops

# The mailbox's page (ADR-113) answers only with its password, which Caddy checks against a
# bcrypt hash. The hash is made again only when the password in Secret Manager changes, so a
# release does not reload Caddy for nothing; the password goes in on standard input only.
STEP=mailbox-key
if [ "$MAILBOX" = true ]; then
  FINGERPRINT="$(sha256sum </run/suskii/mailbox.password | cut -c1-64)"
  if [ "$(cut -d' ' -f1 /opt/suskii/mailbox-auth 2>/dev/null || true)" != "$FINGERPRINT" ]; then
    CADDY_IMAGE="$(compose config --images | grep -m1 '^caddy:')"
    HASH="$( (cat /run/suskii/mailbox.password && echo) |
      docker run --rm -i --network none "$CADDY_IMAGE" caddy hash-password)"
    (umask 077 && printf '%s %s\n' "$FINGERPRINT" "$HASH" >/opt/suskii/mailbox-auth)
  fi
  md instance/attributes/suskii-caddyfile-mailbox |
    python3 -c 'import sys; sys.stdout.write(sys.stdin.read().replace("@MAILBOX_PASSWORD_HASH@", sys.argv[1]))' \
      "$(cut -d' ' -f2 /opt/suskii/mailbox-auth)" >>/opt/suskii/Caddyfile.new
fi
rm -f /run/suskii/mailbox.password
CADDY_CHANGED=false
cmp -s /opt/suskii/Caddyfile.new /opt/suskii/Caddyfile || CADDY_CHANGED=true
# Written in place, never renamed over: Caddy's container mounts this one file, and a file put
# there by a rename would leave it reading the old one at the next reload.
touch /opt/suskii/Caddyfile && chmod 0600 /opt/suskii/Caddyfile
cat /opt/suskii/Caddyfile.new >/opt/suskii/Caddyfile
rm -f /opt/suskii/Caddyfile.new

# Room for this release before anything is pulled: the images of the release that is running
# and of this one stay; earlier releases' go, and so do the half-pulled images of one that
# failed.
STEP=room
RUNNING=""
if [ -f /run/suskii/deployed ]; then RUNNING="$(cat /run/suskii/deployed)"; fi
keep_images "$RELEASE" "$RUNNING"

STEP=images
PROFILES=(--profile release)
if [ "$SITES" = true ]; then PROFILES+=(--profile sites); fi
if [ "$MAILBOX" = true ]; then PROFILES+=(--profile mailbox); fi
compose "${PROFILES[@]}" pull --quiet

STEP=data
compose up -d --wait --wait-timeout 180 postgres redis

# A dump before the database step, so a release that changes the schema can be undone. The
# first release has nothing to keep yet. No dump, no migration: a failure here stops the
# release with the running containers untouched.
STEP=backup
if [ "$(docker exec suskii-postgres-1 psql -U suskii -d suskii -Atc \
  "select to_regclass('public._prisma_migrations') is not null" 2>/dev/null)" = "t" ]; then
  /opt/suskii/backup.sh
fi

STEP=database
compose --profile release run --rm migrate

# The mailbox before the API, which sends to it (ADR-113). Switched off, it goes, and so does
# the mail it kept.
STEP=mailbox
if [ "$MAILBOX" = true ]; then
  install -d -o 1000 -g 1000 -m 0700 /mnt/data/mailbox
  compose --profile mailbox up -d --wait --wait-timeout 120 mailbox
else
  compose --profile mailbox rm -fs mailbox >/dev/null 2>&1 || true
  rm -rf /mnt/data/mailbox /opt/suskii/mailbox-auth
fi

# The platform. Caddy asks for its certificates on its own, in the background, and takes a
# changed list of names without dropping a connection.
STEP=platform
compose up -d --wait --wait-timeout 300 api worker
compose exec -T api node -e \
  "fetch('http://127.0.0.1:8080/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# A testing backend's sample catalogue: packages, tours, add-ons, visa products, a Prime plan,
# buses and rental cars, every row marked as a sample. It runs with the API's keys (the sample
# drivers' fields are encrypted like real ones) and outside production mode, which the seed
# refuses; Terraform refuses the setting in an environment named production. The seed adds only
# what is missing, so the nightly run keeps two weeks of departures ahead. Reported, never a
# reason to fail a release.
STEP=sample-catalogue
SAMPLE=""
if [ "$(setting sample_catalogue)" = "True" ]; then
  cat >/opt/suskii/sample-catalogue <<'SEED'
#!/usr/bin/env bash
exec docker compose --env-file /opt/suskii/compose.env -f /opt/suskii/compose.yml \
  --profile ops run --rm -T -e NODE_ENV=development ops prisma/seed-demo.ts
SEED
  chmod 0755 /opt/suskii/sample-catalogue
  cat >/etc/systemd/system/suskii-sample.service <<'UNIT'
[Unit]
Description=Suskii backend: keep the sample catalogue's departures ahead of today
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/suskii/sample-catalogue
StandardOutput=journal+console
StandardError=journal+console
UNIT
  cat >/etc/systemd/system/suskii-sample.timer <<'UNIT'
[Unit]
Description=Suskii backend: nightly refresh of the sample catalogue

[Timer]
OnCalendar=*-*-* 03:15:00 UTC
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now suskii-sample.timer >/dev/null 2>&1 || true
  SAMPLE="; sample catalogue: ensured"
  /opt/suskii/sample-catalogue || SAMPLE="; sample catalogue: failed"
else
  systemctl disable --now suskii-sample.timer >/dev/null 2>&1 || true
  rm -f /opt/suskii/sample-catalogue /etc/systemd/system/suskii-sample.service \
    /etc/systemd/system/suskii-sample.timer
fi

if [ "$SITES" = true ]; then
  STEP=sites
  compose --profile sites up -d --wait --wait-timeout 300 web admin
fi
STEP=front-door-start
compose up -d caddy
if [ "$CADDY_CHANGED" = true ]; then
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ||
    compose restart caddy
fi

# The assistant, last and on its own: the release stands whether or not it comes up.
STEP=assistant
ASSISTANT="up, model $(setting assistant_model)"
compose up -d --wait --wait-timeout 180 agent || ASSISTANT="not healthy"

# The front door as the world sees it: the name, the certificate and Caddy, asked from here.
# The first certificate can take a few minutes, so this is reported, never a reason to fail.
STEP=front-door
door() { # door <address>: whether it answers 200 within three minutes
  for _ in $(seq 1 36); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$1" || true)" = "200" ]; then
      echo "answers"
      return
    fi
    sleep 5
  done
  echo "not answering yet"
}
HOST="$(setting api_host)"
DOOR="$(door "https://$HOST/health")"
SITES_DOOR=""
if [ "$SITES" = true ]; then
  SITES_DOOR="; website: $(door "https://$(setting web_host)/robots.txt"); console: $(door "https://$(setting admin_host)/sign-in")"
fi
# The mailbox must refuse whoever has no password: 401 is right. A page that answers without it
# is stopped at once and reported.
MAIL_DOOR=""
if [ "$MAILBOX" = true ]; then
  CODE=""
  for _ in $(seq 1 36); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$(setting mail_host)/" || true)"
    if [ "$CODE" = "401" ] || [ "$CODE" = "200" ]; then break; fi
    sleep 5
  done
  case "$CODE" in
    401) MAIL_DOOR="; mailbox: locked" ;;
    200)
      compose --profile mailbox stop mailbox >/dev/null 2>&1 || true
      MAIL_DOOR="; mailbox: stopped, it answered without its password"
      ;;
    *) MAIL_DOOR="; mailbox: not answering yet" ;;
  esac
fi

# Only this release's images stay (the sample catalogue's nightly run needs its `ops` image,
# which no container keeps in use). A rollback pulls its images again.
STEP=tidy
keep_images "$RELEASE"
echo "$RELEASE" >/run/suskii/deployed
MEMORY="$(free -m | awk '/^Mem:/ { print $3 " of " $2 " MB in use" }')"
status "ok $RELEASE; assistant: $ASSISTANT; https://$HOST: $DOOR$SITES_DOOR$MAIL_DOOR$SAMPLE; memory: $MEMORY; disk: $(free_disk) free"
