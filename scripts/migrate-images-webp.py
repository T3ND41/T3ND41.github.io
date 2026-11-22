#!/usr/bin/env python3
"""One-shot migration: point every product image at the optimized WebP variants.

Handles the three markup patterns found in the repo plus the quote-page basket
renderer. WhatsApp photo links (href attributes and message text) are untouched,
and the industries.html field photo does not match any pattern on purpose.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SIZES_CARD = '(max-width: 640px) 46vw, (max-width: 1024px) 31vw, 250px'
SIZES_MAIN = '(min-width: 961px) 540px, (min-width: 641px) 88vw, 100vw'

# slug characters seen in assets/cat: P16, MIC-02, TPGS-35, EXP-PN800DP, EXP-IMPACT-GLOVES...
SLUG = r'[A-Za-z0-9][A-Za-z0-9._-]*'

# Pattern A — card/related <picture> with jpg fallback (261 occurrences).
pat_a = re.compile(
    r'<picture><source srcset="assets/cat/(' + SLUG + r')\.webp" type="image/webp">'
    r'<img src="assets/cat/\1\.jpg"([^>]*)></picture>')

def sub_a(m):
    slug, attrs = m.group(1), m.group(2)
    return (
        '<picture>'
        f'<source srcset="assets/cat/{slug}-400.webp 400w, assets/cat/{slug}-1200.webp 1200w" '
        f'sizes="{SIZES_CARD}" type="image/webp">'
        f'<img src="assets/cat/{slug}-400.webp"{attrs}>'
        '</picture>')

# Pattern B — detail main image, older 900px .webp variant (45 pages).
pat_b = re.compile(
    r'<img src="assets/cat/(' + SLUG + r')\.webp"([^>]*?)'
    r'width="900" height="900"( fetchpriority="high" decoding="[a-z]+")>')

def sub_b(m):
    slug, attrs, tail = m.group(1), m.group(2), m.group(3)
    return (
        f'<img src="assets/cat/{slug}-1200.webp" '
        f'srcset="assets/cat/{slug}-400.webp 400w, assets/cat/{slug}-1200.webp 1200w" '
        f'sizes="{SIZES_MAIN}"{attrs}'
        'width="1200" height="1200"' + tail + '>')

# Pattern C — detail main image on EXP pages, 1200px .jpg (35 pages).
pat_c = re.compile(
    r'<img src="assets/cat/(' + SLUG + r')\.jpg"([^>]*?)'
    r'width="1200" height="1200" fetchpriority="high"( decoding="[a-z]+")>')

def sub_c(m):
    slug, attrs, tail = m.group(1), m.group(2), m.group(3)
    return (
        f'<img src="assets/cat/{slug}-1200.webp" '
        f'srcset="assets/cat/{slug}-400.webp 400w, assets/cat/{slug}-1200.webp 1200w" '
        f'sizes="{SIZES_MAIN}"{attrs}'
        'width="1200" height="1200" fetchpriority="high"' + tail + '>')

# Pattern D — quote.html basket items (client-side template string).
pat_d = re.compile(r'<span class="bi-img"><img src="assets/cat/\' \+ p\.img \+ \'\.jpg"')

# Pattern E — the 45 older detail pages wrap the main image in a multi-line
# <picture> whose single-file <source> would otherwise override the img srcset.
pat_e = re.compile(
    r'<source srcset="assets/cat/(' + SLUG + r')\.webp" type="image/webp">')

def sub_e(m):
    slug = m.group(1)
    return (
        f'<source srcset="assets/cat/{slug}-400.webp 400w, assets/cat/{slug}-1200.webp 1200w" '
        f'sizes="{SIZES_MAIN}" type="image/webp">')

SUBS = [
    (pat_a, sub_a, 'card/related picture'),
    (pat_b, sub_b, 'detail main image (900px webp)'),
    (pat_c, sub_c, 'detail main image (1200px jpg)'),
    (pat_d, lambda m: '<span class="bi-img"><img src="assets/cat/\' + p.img + \'-400.webp"',
     'quote basket item'),
    (pat_e, sub_e, 'detail picture source'),
]

changed = 0
for f in sorted(ROOT.glob('*.html')):
    text = f.read_text(encoding='utf-8')
    original = text
    counts = []
    for pat, sub, label in SUBS:
        text, n = pat.subn(sub, text)
        if n:
            counts.append(f'{label}={n}')
    if text != original:
        f.write_text(text, encoding='utf-8')
        changed += 1
        print(f'{f.name}: ' + ', '.join(counts))

print(f'--- pages updated: {changed}')

# safety: these must never be touched by the migration
leftover_a = len(re.findall(r'<source srcset="assets/cat/' + SLUG + r'\.webp" type="image/webp">',
                            ' '.join(p.read_text(encoding='utf-8') for p in sorted(ROOT.glob('*.html')))))
print(f'old-style <source> tags remaining (should be 0): {leftover_a}')
