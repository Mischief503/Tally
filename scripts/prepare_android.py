#!/usr/bin/env python3
"""Pack web/index.html into the Android app's assets.

- Puts your Supabase details in, when they are set as repository variables
  (Settings > Secrets and variables > Actions > Variables: TALLY_SUPABASE_URL, TALLY_SUPABASE_ANON_KEY).
  Without them the app runs on the phone alone, with sample data.
- Bundles supabase-js inside the app so MoveCrew starts with no signal.
- Tells the page it is the installed app (Back button handling) and drops the website-only
  pieces (web manifest, offline helper) that the Android app doesn't need.
- Adds a one-line "ready" log the emulator check looks for.
The steps are shared with the Windows app (app_pack.py).
"""
import os
import app_pack as P

OUT_DIR = os.path.join(P.ROOT, 'android', 'app', 'src', 'main', 'assets')
os.makedirs(OUT_DIR, exist_ok=True)

html = P.fill_supabase(P.read_page(), 'on the phone')
html = P.bundle_supabase_js(html, OUT_DIR)
html = P.installed(html, P.ANDROID_FLAGS)
P.write(html, OUT_DIR)
