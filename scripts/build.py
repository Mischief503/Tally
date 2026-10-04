#!/usr/bin/env python3
"""Build the two editions the tests use, from web/index.html (the one source).
build/tally-supabase.html  the hosted / Android edition
build/tally-artifact.html  the claude.ai artifact edition (same app, without the Supabase block)
build/site/                the website folder (index, manifest, offline helper, icons)"""
import os, shutil
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
B = os.path.join(ROOT, 'build')
shutil.rmtree(B, ignore_errors=True)
shutil.copytree(os.path.join(ROOT, 'web'), os.path.join(B, 'site'))
src = open(os.path.join(ROOT, 'web', 'index.html'), encoding='utf-8').read()
open(os.path.join(B, 'tally-supabase.html'), 'w', encoding='utf-8').write(src)
a = src.index('<!-- ===== Supabase back end'); b = src.index('</head>', a)
open(os.path.join(B, 'tally-artifact.html'), 'w', encoding='utf-8').write(src[:a] + src[b:])
print('built build/tally-supabase.html, build/tally-artifact.html, build/site/')
