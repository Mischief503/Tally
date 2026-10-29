#!/usr/bin/env bash
# Runs inside the Android emulator job: install the APK, open MoveCrew, and prove the app loaded.
# Every way it can fail also leaves a GitHub note (::error), because the run's log can't be read from everywhere.
set -uo pipefail
APK=android/app/build/outputs/apk/release/app-release.apk
mkdir -p smoke
fail() { echo "$1"; echo "::error title=Emulator check::$1 $(tr '\n' ' ' < "${2:-/dev/null}" | tail -c 900)"; exit 1; }
adb install -r "$APK" > smoke/install.txt 2>&1 || fail "Install failed." smoke/install.txt
adb logcat -c
adb shell am start -W -n com.tally.movers/.MainActivity
ok=0; t0=$(date +%s)
for i in $(seq 1 75); do
  sleep 2
  adb logcat -d -s TallyWeb:* > smoke/logcat.txt
  if grep -q "TALLY_READY nodes=[1-9]" smoke/logcat.txt; then ok=1; break; fi
done
secs=$(( $(date +%s) - t0 ))
adb exec-out screencap -p > smoke/screenshot.png || true
adb logcat -d '*:E' > smoke/errors.txt || true
echo "---- MoveCrew page log ----"; cat smoke/logcat.txt
PID=$(adb shell pidof com.tally.movers | tr -d '\r')
[ -n "$PID" ] || { tail -n 40 smoke/errors.txt > smoke/tail.txt; fail "MoveCrew closed after opening." smoke/tail.txt; }
[ $ok = 1 ] || { tail -n 20 smoke/logcat.txt > smoke/tail.txt; fail "MoveCrew opened but the page didn't finish loading in ${secs}s." smoke/tail.txt; }
if grep -E "ERROR .*Uncaught" smoke/logcat.txt > smoke/uncaught.txt; then fail "The page reported an error." smoke/uncaught.txt; fi
echo "::notice title=Emulator check::MoveCrew loaded in ${secs}s."
echo "MoveCrew opened and loaded on Android (process $PID, ${secs}s)."
