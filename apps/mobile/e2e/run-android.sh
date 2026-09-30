#!/usr/bin/env bash
# Installs the e2e APK on the booted emulator and runs the Maestro critical path (ADR-024).
# The app and the Custom Tab reach the stack on the host through `adb reverse` (localhost is a
# secure context for the web pages); the route is removed before the offline flow.
# Usage: run-android.sh <app-release.apk> <report-dir>
set -euo pipefail

apk="$1"
report="$2"
flows="$(dirname "$0")/maestro"
maestro="${MAESTRO_BIN:-$HOME/.maestro/bin/maestro}"
mkdir -p "$report"

adb wait-for-device
# Chrome without first-run screens: debuggable emulator images read this command-line file.
adb shell "echo '_ --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
adb shell am set-debug-app --persistent com.android.chrome || true
adb install -r "$apk"
adb reverse tcp:4000 tcp:4000
adb reverse tcp:3000 tcp:3000

status=0
"$maestro" test "$flows/critical-path.yaml" --format junit --output "$report/critical-path.xml" \
  --debug-output "$report/critical-path" || status=$?
if [ "$status" -eq 0 ]; then
  adb reverse --remove-all
  "$maestro" test "$flows/offline-trip.yaml" --format junit --output "$report/offline-trip.xml" \
    --debug-output "$report/offline-trip" || status=$?
fi
adb logcat -d > "$report/logcat.txt" || true
exit "$status"
