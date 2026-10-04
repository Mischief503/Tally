#!/usr/bin/env python3
"""Pack web/index.html into the Android app's assets.

- Puts your Supabase details in, when they are set as repository variables
  (Settings > Secrets and variables > Actions > Variables: TALLY_SUPABASE_URL, TALLY_SUPABASE_ANON_KEY).
  Without them the app runs on the phone alone, with sample data.
- Bundles supabase-js inside the app so Tally starts with no signal.
- Tells the page it is the installed app (Back button handling) and drops the website-only
  pieces (web manifest, offline helper) that the Android app doesn't need.
- Adds a one-line "ready" log the emulator check looks for.
"""
import os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'web', 'index.html')
OUT_DIR = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'assets')
SUPA = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'

html = open(SRC, encoding='utf-8').read()
os.makedirs(OUT_DIR, exist_ok=True)

url, key = os.environ.get('TALLY_SUPABASE_URL', '').strip(), os.environ.get('TALLY_SUPABASE_ANON_KEY', '').strip()
if url and key:
    if not re.match(r'^https://[a-z0-9-]+\.supabase\.co/?$', url):
        sys.exit('TALLY_SUPABASE_URL should look like https://abcdefgh.supabase.co (got %r)' % url)
    html = html.replace('PASTE_YOUR_PROJECT_URL', url.rstrip('/')).replace('PASTE_YOUR_ANON_PUBLIC_KEY', key)
    print('Supabase: connected to', url)
else:
    print('Supabase: not set, the app runs on the phone alone with sample data')

try:
    js = urllib.request.urlopen(SUPA, timeout=60).read()
    if len(js) < 50000:
        raise ValueError('supabase.js looks too small (%d bytes)' % len(js))
    open(os.path.join(OUT_DIR, 'supabase.js'), 'wb').write(js)
    html = html.replace('<script src="%s"></script>' % SUPA, '<script src="supabase.js"></script>')
    print('supabase-js: bundled (%d KB)' % (len(js) // 1024))
except Exception as e:
    print('supabase-js: could not bundle (%s); the app will load it online' % e)

def drop(pattern, label):
    global html
    new, n = re.subn(pattern, '', html, flags=re.S)
    if n != 1:
        sys.exit('could not find the %s in web/index.html' % label)
    html = new

drop(r'<link rel="manifest" href="manifest.webmanifest">\n', 'manifest link')
drop(r"<script>\nif\('serviceWorker' in navigator.*?</script>\n", 'offline helper registration')

head = html.index('<head>') + len('<head>')
html = html[:head] + '\n<script>window.TALLY_STANDALONE=true;window.TALLY_ANDROID=true;</script>' + html[head:]
html = html.replace('</body>', "<script>window.addEventListener('load',function(){setTimeout(function(){console.log('TALLY_READY nodes='+document.body.querySelectorAll('*').length)},2500)})</script>\n</body>", 1)

open(os.path.join(OUT_DIR, 'index.html'), 'w', encoding='utf-8').write(html)
print('wrote', os.path.relpath(os.path.join(OUT_DIR, 'index.html'), ROOT))
