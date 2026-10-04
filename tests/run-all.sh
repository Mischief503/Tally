#!/usr/bin/env bash
# Every Tally check, from the repo root: bash tests/run-all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build.py
fail=0
run() { echo; echo "== $*"; "$@" 2>&1 | grep -v '^PASS' ; [ "${PIPESTATUS[0]}" -eq 0 ] || fail=1; }
for ed in artifact supabase; do
  for s in regress field confirm minpay; do run node tests/ui/$s.js build/tally-$ed.html $s-$ed; done
done
for s in hosted confirm-hosted dist nav pwa-check; do run node tests/ui/$s.js; done
run deno run -A tests/function/test.ts
if [ "$(id -u)" = 0 ]; then echo "== sql: skipped as root (initdb refuses root); runs in GitHub"; else run bash tests/sql/run.sh; fi
echo; [ $fail -eq 0 ] && echo "ALL PASSED" || echo "SOMETHING FAILED"
exit $fail
