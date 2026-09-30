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
# A freshly booted emulator is busy for a while; its launcher can stop responding and the
# system dialog then covers the app. Test devices hide error dialogs (crashes still reach
# logcat, printed below on failure) and get a moment to settle.
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
adb shell settings put global hide_error_dialogs 1
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell input keyevent KEYCODE_HOME || true
sleep 20
# Chrome without first-run screens: debuggable emulator images read this command-line file.
adb shell "echo '_ --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
adb shell am set-debug-app --persistent com.android.chrome || true
adb install -r "$apk"
adb reverse tcp:4000 tcp:4000
adb reverse tcp:3000 tcp:3000

# On failure: JavaScript errors, crashes and what is on screen, printed into the CI log.
diagnose() {
  echo "::group::App logs (React Native, crashes)"
  adb logcat -d -v brief ReactNativeJS:V ReactNative:W AndroidRuntime:E '*:F' '*:S' | tail -n 200 || true
  echo "::endgroup::"
  echo "::group::Screen (text and test ids)"
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/ui.xml 2>/dev/null \
    | grep -oE '(text|resource-id|content-desc)="[^"]+"' | head -n 120 || true
  echo "::endgroup::"
}

status=0
"$maestro" test "$flows/critical-path.yaml" --format junit --output "$report/critical-path.xml" \
  --debug-output "$report/critical-path" || status=$?
if [ "$status" -eq 0 ]; then
  adb reverse --remove-all
  "$maestro" test "$flows/offline-trip.yaml" --format junit --output "$report/offline-trip.xml" \
    --debug-output "$report/offline-trip" || status=$?
fi
if [ "$status" -ne 0 ]; then diagnose; fi
adb logcat -d > "$report/logcat.txt" || true
exit "$status"
