#!/usr/bin/env bash
# Installs the e2e APK on the booted emulator and runs the Maestro critical path (ADR-024), the
# Cars bus journey, the offline trip, an in-house tour (route restored), a message to support,
# a combined trip paid once (ADR-099), then Google sign-up and sign-in again (mock provider).
# The app and the Custom Tab reach the stack on the host through `adb reverse` (localhost is a
# secure context for the web pages); the route is removed before the offline flow.
# Usage: run-android.sh <app-release.apk> <report-dir>
set -euo pipefail

apk="$1"
report="$2"
flows="$(dirname "$0")/maestro"
maestro="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
mkdir -p "$report"
# shellcheck source=apps/mobile/e2e/device.sh
. "$(dirname "$0")/device.sh"

prepare_device
adb install -r "$apk"
adb reverse tcp:4000 tcp:4000
adb reverse tcp:3000 tcp:3000

run_flow critical-path
run_flow cars-bus
if [ "$status" -eq 0 ]; then adb reverse --remove-all; fi
run_flow offline-trip
if [ "$status" -eq 0 ]; then
  adb reverse tcp:4000 tcp:4000
  adb reverse tcp:3000 tcp:3000
fi
run_flow inhouse-tour
run_flow support
# The stack's database is new on every run, so the account's address can stay the same.
run_flow trip-builder -e TRIP_EMAIL=maestro.trip@example.com \
  -e "PASSPORT_EXPIRY=$(date -u -d '+3000 days' +%F)"
run_flow sign-in
finish
