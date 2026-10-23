#!/usr/bin/env python3
"""Writes supabase/sql/supabase-callcenter.sql from the "-- @cc <name>" blocks of the base files, or with
--check, says whether the file there is what it would write (tests/sql/callcenter.sh runs the check)."""
import re, sys, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = ['supabase-schema-v2.sql', 'supabase-employees.sql', 'supabase-payments.sql']
HEAD = """-- Tally: the call center (October 22, 2026). Run after supabase-schema-v2.sql, supabase-employees.sql and
-- supabase-payments.sql, in the SQL editor. Safe to run again. Nothing here removes or rewrites your jobs,
-- people or settings.
--
-- What it adds:
--   * the role 'callcenter' for people (company members and employee profiles)
--   * the call center reads the open quotes and leads, and the schedule as a copy without the money
--     (sched/<job id>, kept by the trigger sched_sync on every save of a job)
--   * it writes only open quotes: changing one, booking it (its last change) or marking it lost. A new
--     quote has no payment and no discount, and the job guard keeps a discount the office gave, and every
--     payment, as they were
-- The same blocks are in supabase-schema-v2.sql, supabase-employees.sql and supabase-payments.sql (between
-- the "-- @cc" lines), so running those files again keeps the call center. This file is written from them
-- by scripts/cc_sql.py; change them, then run it.
"""
def blocks():
    out = []
    for f in SRC:
        s = open(os.path.join(ROOT, 'supabase', 'sql', f)).read()
        for m in re.finditer(r'^-- @cc (?!end)(\S+)\n(.*?)^-- @cc end$', s, re.S | re.M):
            out.append((m.group(1), f, m.group(2)))
    return out
def text():
    return HEAD + ''.join('\n-- ---------- ' + n + ' (as in ' + f + ') ----------\n' + b for n, f, b in blocks())
if __name__ == '__main__':
    path = os.path.join(ROOT, 'supabase', 'sql', 'supabase-callcenter.sql')
    want = text()
    if '--check' in sys.argv:
        have = open(path).read() if os.path.exists(path) else ''
        names = [n for n, _, _ in blocks()]
        if have != want: print('supabase-callcenter.sql is not what scripts/cc_sql.py writes from the base files; run it'); sys.exit(1)
        print('supabase-callcenter.sql matches the base files (' + ', '.join(names) + ')')
    else:
        open(path, 'w').write(want); print('wrote', path, len(want), 'bytes')
