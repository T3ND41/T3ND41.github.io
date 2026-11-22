#!/usr/bin/env python3
"""Corrective pass: detail-page main images must not use grid-card sizing.

The first migration matched the 35 EXP-* <picture> blocks (they share the card
markup shape) and gave them card sizes + a 400px fallback src. Every picture
whose <img> carries width="1200" height="1200" fetchpriority="high" is a product
detail hero: it needs the 1200px src and the detail sizes string.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIZES_MAIN = '(min-width: 961px) 540px, (min-width: 641px) 88vw, 100vw'
SLUG = r'[A-Za-z0-9][A-Za-z0-9._-]*'

pat = re.compile(
    r'<picture><source srcset="assets/cat/(' + SLUG + r')-400\.webp 400w, assets/cat/\1-1200\.webp 1200w" '
    r'sizes="\(max-width: 640px\) 46vw, \(max-width: 1024px\) 31vw, 250px" type="image/webp">'
    r'<img src="assets/cat/\1-400\.webp"([^>]*width="1200" height="1200" fetchpriority="high"[^>]*)></picture>')

fixed = 0
for f in sorted(ROOT.glob('*.html')):
    text = f.read_text(encoding='utf-8')
    new, n = pat.subn(
        lambda m: (
            '<picture>'
            f'<source srcset="assets/cat/{m.group(1)}-400.webp 400w, assets/cat/{m.group(1)}-1200.webp 1200w" '
            f'sizes="{SIZES_MAIN}" type="image/webp">'
            f'<img src="assets/cat/{m.group(1)}-1200.webp"{m.group(2)}>'
            '</picture>'),
        text)
    if n:
        f.write_text(new, encoding='utf-8')
        fixed += n
        print(f'{f.name}: fixed {n} main image(s)')
print(f'--- corrected imgs: {fixed}')
