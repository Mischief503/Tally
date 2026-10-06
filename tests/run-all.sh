#!/usr/bin/env bash
# Every Tally check, from the repo root: bash tests/run-all.sh
set -uo pipefail
cd "$(dirname "$0")/.."
python3 scripts/build.py
fail=0
# On GitHub, each failure also becomes an error note on the build, so it shows on the run page.
run() {
  echo; echo "== $*"
  local out code
  out=$("$@" 2>&1); code=$?
  echo "$out" | grep -v '^PASS'
  if [ $code -ne 0 ]; then
    fail=1
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      local name="${*: -1}"
      local lines
      lines=$(echo "$out" | grep -E '^FAIL|Error|error:' | head -n 8)
      [ -n "$lines" ] || lines=$(echo "$out" | tail -n 6)
      echo "$lines" | while IFS= read -r l; do echo "::error title=$name::${l:0:400}"; done
    fi
  fi
}
for ed in artifact supabase; do
  for s in regress field confirm minpay; do run node tests/ui/$s.js build/tally-$ed.html $s-$ed; done
done
for s in hosted confirm-hosted employees dist shop osm testpack nav pwa-check; do run node tests/ui/$s.js; done
run deno run -A tests/function/test.ts
if [ "$(id -u)" = 0 ]; then echo "== sql: skipped as root (initdb refuses root); runs in GitHub"; else run bash tests/sql/run.sh; run bash tests/sql/schema.sh; run bash tests/sql/employees.sh; fi
echo; [ $fail -eq 0 ] && echo "ALL PASSED" || echo "SOMETHING FAILED"
exit $fail
