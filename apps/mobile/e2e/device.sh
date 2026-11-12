#!/usr/bin/env bash
# Shared by run-android.sh and run-hosted.sh: gets a booted emulator ready for the test build and
# runs Maestro flows one after the other, stopping at the first that fails.
# Callers set `flows` (the folder of flow files), `report` (where results go) and `maestro`.

# A freshly booted emulator is busy for a while; its launcher can stop responding and the
# system dialog then covers the app. Test devices hide error dialogs (crashes still reach
# logcat, printed on failure) and get a moment to settle. Chrome skips its first-run screens:
# debuggable emulator images read this command-line file.
prepare_device() {
  adb wait-for-device
  adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
  adb shell settings put global hide_error_dialogs 1
  adb shell input keyevent KEYCODE_WAKEUP || true
  adb shell input keyevent KEYCODE_HOME || true
  sleep 20
  adb shell "echo '_ --disable-fre --no-default-browser-check --no-first-run' > /data/local/tmp/chrome-command-line"
  adb shell am set-debug-app --persistent com.android.chrome || true
}

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

# run_flow <name> [maestro options, such as -e KEY=value]: skipped once a flow has failed.
run_flow() {
  local name="$1"
  shift
  if [ "$status" -ne 0 ]; then return 0; fi
  "$maestro" test "$@" "$flows/$name.yaml" --format junit --output "$report/$name.xml" \
    --debug-output "$report/$name" || status=$?
}

# Prints the diagnosis after a failure, keeps the device log and ends with the flows' status.
finish() {
  if [ "$status" -ne 0 ]; then diagnose; fi
  adb logcat -d > "$report/logcat.txt" || true
  exit "$status"
}
