#!/usr/bin/env bash
# Start-up script of the backend VM (ADR-111). Runs as root at every boot, and can run again at
# any time: each step looks at what is there first. It prepares the machine (data disk, swap,
# Docker), installs the deploy and backup scripts from the instance's metadata, and starts the
# watcher that deploys a release when the operator names one. No secret is in this file or in
# the metadata: the deploy script reads them from Secret Manager as the VM's own identity.
set -euo pipefail

MD=http://metadata.google.internal/computeMetadata/v1
md() { curl -sf -H 'Metadata-Flavor: Google' "$MD/$1"; }

# --- The data disk: the database, the queues and the certificate outlive the machine ------------
DEVICE=/dev/disk/by-id/google-suskii-data
if ! blkid "$DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -q -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DEVICE"
fi
mkdir -p /mnt/data
grep -q ' /mnt/data ' /etc/fstab || echo "$DEVICE /mnt/data ext4 discard,defaults,nofail 0 2" >>/etc/fstab
mountpoint -q /mnt/data || mount /mnt/data
mkdir -p /mnt/data/postgres /mnt/data/redis /mnt/data/caddy/data /mnt/data/caddy/config /mnt/data/backups

# Room to breathe while a release runs its database step beside the running containers.
if [ ! -f /mnt/data/swapfile ]; then
  fallocate -l 2G /mnt/data/swapfile
  chmod 600 /mnt/data/swapfile
  mkswap -q /mnt/data/swapfile
fi
swapon --show | grep -q /mnt/data/swapfile || swapon /mnt/data/swapfile

# --- Docker, from Docker's own repository ------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $VERSION_CODENAME stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
systemctl enable --now docker

# --- The scripts and their units ----------------------------------------------------------------
install -d -m 0755 /opt/suskii
md instance/attributes/suskii-deploy >/opt/suskii/deploy.sh
md instance/attributes/suskii-backup >/opt/suskii/backup.sh
chmod 0755 /opt/suskii/deploy.sh /opt/suskii/backup.sh

# The watcher: when the operator sets a new `suskii-release` on the instance, deploy it, with
# the deploy and backup scripts as the metadata has them now. One attempt per value: a failed
# release waits for the operator, it is not retried in a loop.
cat >/opt/suskii/watch.sh <<'WATCH'
#!/usr/bin/env bash
set -uo pipefail
MD=http://metadata.google.internal/computeMetadata/v1/instance/attributes
md() { curl -sf -H 'Metadata-Flavor: Google' "$MD/$1"; }
refresh() { # refresh <attribute> <file>: only a complete download replaces the script
  md "$1" >"$2.new" && [ -s "$2.new" ] && chmod 0755 "$2.new" && mv "$2.new" "$2"
}
tried=""
[ -f /run/suskii/deployed ] && tried="$(cat /run/suskii/deployed)"
while true; do
  release="$(md suskii-release || true)"
  if [ -n "$release" ] && [ "$release" != "$tried" ]; then
    tried="$release"
    refresh suskii-deploy /opt/suskii/deploy.sh
    refresh suskii-backup /opt/suskii/backup.sh
    /opt/suskii/deploy.sh "$release" || true
  fi
  sleep 10
done
WATCH
chmod 0755 /opt/suskii/watch.sh

cat >/etc/systemd/system/suskii-watch.service <<'UNIT'
[Unit]
Description=Suskii backend: deploy the release the instance metadata names
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
ExecStart=/opt/suskii/watch.sh
Restart=always
RestartSec=10
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
UNIT

cat >/etc/systemd/system/suskii-backup.service <<'UNIT'
[Unit]
Description=Suskii backend: nightly database backup to the backups bucket
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/suskii/backup.sh
StandardOutput=journal+console
StandardError=journal+console
UNIT

cat >/etc/systemd/system/suskii-backup.timer <<'UNIT'
[Unit]
Description=Suskii backend: nightly database backup

[Timer]
OnCalendar=*-*-* 02:15:00 UTC
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable suskii-watch.service suskii-backup.timer
systemctl restart suskii-watch.service
systemctl start suskii-backup.timer
echo "suskii: the machine is ready"
