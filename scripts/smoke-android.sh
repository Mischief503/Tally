#!/usr/bin/env bash
# Runs inside the Android emulator job: install the APK, open Tally, and prove the app loaded.
set -uo pipefail
APK=android/app/build/outputs/apk/release/app-release.apk
mkdir -p smoke
adb install -r "$APK" || { echo "Install failed"; exit 1; }
adb logcat -c
adb shell am start -W -n com.tally.movers/.MainActivity
ok=0
for i in $(seq 1 45); do
  sleep 2
  adb logcat -d -s TallyWeb:* > smoke/logcat.txt
  if grep -q "TALLY_READY nodes=[1-9]" smoke/logcat.txt; then ok=1; break; fi
done
adb exec-out screencap -p > smoke/screenshot.png || true
adb logcat -d '*:E' > smoke/errors.txt || true
echo "---- Tally page log ----"; cat smoke/logcat.txt
PID=$(adb shell pidof com.tally.movers | tr -d '\r')
[ -n "$PID" ] || { echo "Tally closed after opening."; tail -n 80 smoke/errors.txt; exit 1; }
[ $ok = 1 ] || { echo "Tally opened but the page never finished loading."; exit 1; }
if grep -E "ERROR .*Uncaught" smoke/logcat.txt; then echo "The page reported an error."; exit 1; fi
echo "Tally opened and loaded on Android (process $PID)."
