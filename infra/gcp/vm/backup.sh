#!/usr/bin/env bash
# Nightly backup of the backend VM's database (ADR-111): one compressed dump, uploaded to the
# project's backups bucket as the VM's own identity, which may add objects there and nothing
# else. The bucket deletes a dump after 30 days. Fields the API encrypts stay encrypted in the
# dump: their key is in Secret Manager, never in this file or in the bucket.
set -euo pipefail

MD=http://metadata.google.internal/computeMetadata/v1
md() { curl -sf -H 'Metadata-Flavor: Google' "$MD/$1"; }
note() {
  echo "suskii-backup: $*"
  curl -sf -X PUT --data "$*" -H 'Metadata-Flavor: Google' \
    "$MD/instance/guest-attributes/suskii/backup" >/dev/null || true
}
trap 'note "failed $(date -u +%FT%TZ)"' ERR

BUCKET="$(python3 -c 'import json; print(json.load(open("/opt/suskii/settings.json"))["backups_bucket"])')"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/mnt/data/backups/suskii-$STAMP.dump"

docker exec suskii-postgres-1 pg_dump -U suskii -d suskii -Fc >"$FILE"
TOKEN="$(md instance/service-accounts/default/token | python3 -c 'import json, sys; print(json.load(sys.stdin)["access_token"])')"
curl -sf -X POST -T "$FILE" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/octet-stream' \
  "https://storage.googleapis.com/upload/storage/v1/b/$BUCKET/o?uploadType=media&name=postgres/suskii-$STAMP.dump" \
  >/dev/null
rm -f "$FILE"
note "ok postgres/suskii-$STAMP.dump"
