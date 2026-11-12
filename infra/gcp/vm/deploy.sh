#!/usr/bin/env bash
# Deploys one release on the backend VM (ADR-111). Started by the watcher when the operator
# sets `suskii-release` on the instance: "<image tag> <a number, so the same tag can be deployed
# again> [<tag of the website's and the console's images>]".
#
# In order: the stack's files from the instance metadata, the keys from Secret Manager into
# memory-only env files, the images, a dump of the database, the database step, then the new
# containers. The platform first, the assistant after it: an assistant that does not come up
# never fails the release.
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
STEP=start
trap 'status "failed $RELEASE at $STEP"' ERR

STEP=files
install -d -m 0700 /run/suskii
md instance/attributes/suskii-compose >/opt/suskii/compose.yml
md instance/attributes/suskii-settings >/opt/suskii/settings.json
setting() { python3 -c 'import json, sys; print(json.load(open("/opt/suskii/settings.json"))[sys.argv[1]])' "$1"; }
# The website and the console run here when the settings say so and their images are named.
SITES=false
if [ "$(setting sites)" = "True" ] && [ -n "${SITES_TAG:-}" ]; then SITES=true; fi
md instance/attributes/suskii-caddyfile >/opt/suskii/Caddyfile.new
if [ "$SITES" = true ]; then
  md instance/attributes/suskii-caddyfile-sites >>/opt/suskii/Caddyfile.new
fi
CADDY_CHANGED=false
cmp -s /opt/suskii/Caddyfile.new /opt/suskii/Caddyfile || CADDY_CHANGED=true
mv /opt/suskii/Caddyfile.new /opt/suskii/Caddyfile
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
write(
    "api.env",
    {
        "DATABASE_URL": f"postgresql://suskii_app:{app}@{database}",
        "REDIS_URL": redis_url,
        **{name: secret(name) for name in api_keys},
    },
)
write("worker.env", {"REDIS_URL": redis_url, "INTERNAL_API_TOKEN": secret("INTERNAL_API_TOKEN")})

# The assistant's own file: its two tokens, its model key and its own database role.
model = settings["assistant_model"]
assistant = {
    "AGENT_RUN_TOKEN": secret("AGENT_RUN_TOKEN"),
    "AGENT_TOOLS_TOKEN": secret("AGENT_TOOLS_TOKEN"),
    "LLM_API_KEY": secret("LLM_API_KEY"),
    "AGENT_DATABASE_URL": f"postgresql://suskii_agent:{agent}@{database}",
    "AGENT_MODEL_PROVIDER": model,
}
if model == "mock":
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
        "SUSKII_DOCUMENTS_BUCKET": settings["documents_bucket"],
        "SUSKII_ASSISTANT_ENABLED": "true" if settings["assistant_enabled"] else "false",
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

# Operator commands, for a person logged in to the machine: sudo /opt/suskii/ops <script> [...]
cat >/opt/suskii/ops <<'OPS'
#!/usr/bin/env bash
exec docker compose --env-file /opt/suskii/compose.env -f /opt/suskii/compose.yml \
  --profile ops run --rm ops "$@"
OPS
chmod 0755 /opt/suskii/ops

STEP=images
if [ "$SITES" = true ]; then
  compose --profile release --profile sites pull --quiet
else
  compose --profile release pull --quiet
fi

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

# The platform. Caddy asks for its certificates on its own, in the background, and takes a
# changed list of names without dropping a connection.
STEP=platform
compose up -d --wait --wait-timeout 300 api worker
compose exec -T api node -e \
  "fetch('http://127.0.0.1:8080/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
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
ASSISTANT=up
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

STEP=tidy
docker image prune -af --filter until=48h >/dev/null 2>&1 || true
echo "$RELEASE" >/run/suskii/deployed
MEMORY="$(free -m | awk '/^Mem:/ { print $3 " of " $2 " MB in use" }')"
status "ok $RELEASE; assistant: $ASSISTANT; https://$HOST: $DOOR$SITES_DOOR; memory: $MEMORY"
