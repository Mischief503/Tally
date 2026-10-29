#!/usr/bin/env python3
"""Make the Tally website: the app your customers open on their phones (and anyone can use in a browser).

- Copies web/ (the app, its web manifest, the offline helper and the icons) into _site/.
- Puts your Supabase details in: the repository variables TALLY_SUPABASE_URL and TALLY_SUPABASE_ANON_KEY when set
  (Settings > Secrets and variables > Actions > Variables), else the project recorded in supabase/project.json.
  Only the anon public key ever goes in; the secret service key is refused.
The Website workflow (.github/workflows/website.yml) publishes _site/ with GitHub Pages.
"""
import json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '_site')

url, key = os.environ.get('TALLY_SUPABASE_URL', '').strip(), os.environ.get('TALLY_SUPABASE_ANON_KEY', '').strip()
if not (url and key):
    try:
        pj = json.load(open(os.path.join(ROOT, 'supabase', 'project.json'), encoding='utf-8'))
        url, key = pj.get('url', '').strip(), pj.get('anonKey', '').strip()
    except Exception:
        pass
if key and ('service_role' in key or key.startswith('sb_secret_')):
    sys.exit('That is the secret service key. Only the anon public key goes on the website.')
if not (url and key):
    sys.exit('No Supabase project: set TALLY_SUPABASE_URL and TALLY_SUPABASE_ANON_KEY, or fill in supabase/project.json.')
if not re.match(r'^https://[a-z0-9-]+\.supabase\.co/?$', url):
    sys.exit('TALLY_SUPABASE_URL should look like https://abcdefgh.supabase.co (got %r)' % url)

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'web'), OUT)
p = os.path.join(OUT, 'index.html')
html = open(p, encoding='utf-8').read()
if html.count('PASTE_YOUR_PROJECT_URL') != 1 or html.count('PASTE_YOUR_ANON_PUBLIC_KEY') != 1:
    sys.exit('could not find the two Supabase lines in web/index.html')
html = html.replace('PASTE_YOUR_PROJECT_URL', url.rstrip('/')).replace('PASTE_YOUR_ANON_PUBLIC_KEY', key)
open(p, 'w', encoding='utf-8').write(html)
open(os.path.join(OUT, '.nojekyll'), 'w').close()   # GitHub Pages serves the files as they are
print('Supabase:', url)
print('wrote _site/ (%d files)' % sum(len(f) for _, _, f in os.walk(OUT)))
