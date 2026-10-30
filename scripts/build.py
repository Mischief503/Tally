#!/usr/bin/env python3
"""Build the two editions the tests use, from web/index.html (the one source).
build/tally-supabase.html  the hosted / Android edition
build/tally-artifact.html  the claude.ai artifact edition (same app, without the Supabase block)
build/tally-windows.html   the hosted edition as the Windows app packs it (app_pack.py), for its tests
build/site/                the website folder (index, manifest, offline helper, icons)"""
import os, shutil
import app_pack
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, 'build')
shutil.rmtree(B, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'web'), os.path.join(B, 'site'))
src = open(os.path.join(ROOT, 'web', 'index.html'), encoding='utf-8').read()
open(os.path.join(B, 'tally-supabase.html'), 'w', encoding='utf-8').write(src)
a = src.index('<!-- ===== Supabase back end'); b = src.index('</head>', a)
art = src[:a] + src[b:]
# the artifact can't reach outside services; this tells the app not to try
art = art.replace('<head>', '<head>\n<script>window.TALLY_ARTIFACT=true;</script>', 1)
open(os.path.join(B, 'tally-artifact.html'), 'w', encoding='utf-8').write(art)
open(os.path.join(B, 'tally-windows.html'), 'w', encoding='utf-8').write(app_pack.installed(src, app_pack.WINDOWS_FLAGS))
print('built build/tally-supabase.html, build/tally-artifact.html, build/tally-windows.html, build/site/')
