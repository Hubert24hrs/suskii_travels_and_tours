#!/usr/bin/env bash
# Phone check (ADR-100): installs the published test APK on the booted emulator and runs it
# against the online test server (ADR-066), as a tester's phone does. Nothing is routed to this
# machine: the app has to read the published address at launch and reach the server over the
# internet. Then a guest books and pays for a flight (the critical path) and an account builds a
# combined trip and pays for it once (ADR-099). Mock suppliers and payments only.
# Usage: run-hosted.sh <suskii-travels-test.apk> <server-url> <report-dir>
set -euo pipefail

apk="$1"
server="$2"
report="$3"
flows="$(dirname "$0")/maestro"
maestro="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
mkdir -p "$report"
# shellcheck source=apps/mobile/e2e/device.sh
. "$(dirname "$0")/device.sh"

prepare_device
# The APK is built for phone CPUs (arm64); the emulator image translates them.
adb shell getprop ro.product.cpu.abilist
adb install -r "$apk"

run_flow hosted-server -e "SERVER_URL=$server"
run_flow critical-path
# The server keeps its data for hours and may already have seen this check: a new account.
run_flow trip-builder -e "TRIP_EMAIL=maestro.trip.$(date -u +%s)@example.com" \
  -e "PASSPORT_EXPIRY=$(date -u -d '+3000 days' +%F)"
finish
