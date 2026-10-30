#!/usr/bin/env python3
"""What the installed apps share when they pack web/index.html (prepare_android.py, prepare_windows.py).

- Your Supabase details go in when they are set as repository variables
  (Settings > Secrets and variables > Actions > Variables: TALLY_SUPABASE_URL, TALLY_SUPABASE_ANON_KEY),
  else the project in supabase/project.json. Only the anon public key: a secret key stops the build.
  Without either, the app runs on its own with sample data.
- supabase-js is packed inside the app, so MoveCrew starts with no signal.
- The page is told it is the installed app, and the website-only pieces (web manifest, offline helper)
  come out.
- A one-line "ready" log goes in, which the build's check looks for.
"""
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'web', 'index.html')
SUPA = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'
# what each installed app tells the page (TALLY_STANDALONE: no Google button, Back closes what's open)
ANDROID_FLAGS = 'window.TALLY_STANDALONE=true;window.TALLY_ANDROID=true;'
WINDOWS_FLAGS = 'window.TALLY_STANDALONE=true;window.TALLY_WINDOWS=true;'


def read_page():
    return open(SRC, encoding='utf-8').read()


def supabase_details():
    url, key = os.environ.get('TALLY_SUPABASE_URL', '').strip(), os.environ.get('TALLY_SUPABASE_ANON_KEY', '').strip()
    if not (url and key):
        # no repo variables set: use the project recorded in supabase/project.json (public anon key only)
        try:
            pj = json.load(open(os.path.join(ROOT, 'supabase', 'project.json'), encoding='utf-8'))
            url, key = pj.get('url', '').strip(), pj.get('anonKey', '').strip()
        except Exception:
            pass
    if key and ('service_role' in key or key.startswith('sb_secret_')):
        sys.exit('That is the secret service key. Only the anon public key goes in the app.')
    if url and key and not re.match(r'^https://[a-z0-9-]+\.supabase\.co/?$', url):
        sys.exit('TALLY_SUPABASE_URL should look like https://abcdefgh.supabase.co (got %r)' % url)
    return url, key


def fill_supabase(html, where):
    url, key = supabase_details()
    if url and key:
        html = html.replace('PASTE_YOUR_PROJECT_URL', url.rstrip('/')).replace('PASTE_YOUR_ANON_PUBLIC_KEY', key)
        print('Supabase: connected to', url)
    else:
        print('Supabase: not set, the app runs %s alone with sample data' % where)
    return html


def bundle_supabase_js(html, out_dir):
    # TALLY_SUPABASE_JS: a copy on disk to pack instead (for building where the CDN can't be reached)
    try:
        local = os.environ.get('TALLY_SUPABASE_JS', '').strip()
        js = open(local, 'rb').read() if local else urllib.request.urlopen(SUPA, timeout=60).read()
        if len(js) < 50000:
            raise ValueError('supabase.js looks too small (%d bytes)' % len(js))
        open(os.path.join(out_dir, 'supabase.js'), 'wb').write(js)
        html = html.replace('<script src="%s"></script>' % SUPA, '<script src="supabase.js"></script>')
        print('supabase-js: bundled (%d KB)' % (len(js) // 1024))
    except Exception as e:
        print('supabase-js: could not bundle (%s); the app will load it online' % e)
    return html


def drop(html, pattern, label):
    new, n = re.subn(pattern, '', html, flags=re.S)
    if n != 1:
        sys.exit('could not find the %s in web/index.html' % label)
    return new


def drop_website_parts(html):
    html = drop(html, r'<link rel="manifest" href="manifest.webmanifest">\n', 'manifest link')
    return drop(html, r"<script>\nif\('serviceWorker' in navigator.*?</script>\n", 'offline helper registration')


def mark_installed(html, flags):
    head = html.index('<head>') + len('<head>')
    return html[:head] + '\n<script>' + flags + '</script>' + html[head:]


def ready_log(html):
    return html.replace('</body>', "<script>window.addEventListener('load',function(){setTimeout(function(){console.log('TALLY_READY nodes='+document.body.querySelectorAll('*').length)},2500)})</script>\n</body>", 1)


def installed(html, flags):
    # the page as an installed app has it, before the Supabase details and supabase-js go in
    return ready_log(mark_installed(drop_website_parts(html), flags))


def write(html, out_dir):
    path = os.path.join(out_dir, 'index.html')
    open(path, 'w', encoding='utf-8').write(html)
    print('wrote', os.path.relpath(path, ROOT))
