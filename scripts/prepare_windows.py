#!/usr/bin/env python3
"""Pack web/index.html into the Windows app (windows/app/), the way prepare_android.py packs the phone app.

- Your Supabase details and supabase-js go in (app_pack.py), so it signs in and starts with no signal.
- The page is told it is the installed app (window.TALLY_STANDALONE: no Google button, which Google
  refuses inside an app's own window, and Back closes what's open) and the website-only pieces come out.
- The icon comes from web/icons/icon-512.png, so a new icon there is the Windows app's icon too.
"""
import os, shutil
import app_pack as P

WIN = os.path.join(P.ROOT, 'windows')
OUT_DIR = os.path.join(WIN, 'app')
shutil.rmtree(OUT_DIR, ignore_errors=True)
os.makedirs(OUT_DIR)

html = P.fill_supabase(P.read_page(), 'on this computer')
html = P.bundle_supabase_js(html, OUT_DIR)
html = P.installed(html, P.WINDOWS_FLAGS)
P.write(html, OUT_DIR)

os.makedirs(os.path.join(WIN, 'build'), exist_ok=True)
shutil.copyfile(os.path.join(P.ROOT, 'web', 'icons', 'icon-512.png'), os.path.join(WIN, 'build', 'icon.png'))
print('icon: web/icons/icon-512.png')
