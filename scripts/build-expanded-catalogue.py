"""Add the supplied priceless catalogue's 35 entries to the static site.

Run after process-expanded-images.py. The current product list is evaluated
through Node to preserve its existing slugs, then price-free cards are rendered.
"""
import html
import json
import re
import subprocess
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW = json.loads((ROOT / 'scripts/catalogue-expanded.json').read_text())
JS = ROOT / 'assets/js/products.js'
PRODUCTS = JS.read_text()
START = '/* Expanded 2026 priceless catalogue additions */'
END = '/* End expanded catalogue additions */'

PUBLIC_FIELDS = ('code', 'name', 'cat', 'brand', 'desc', 'tag', 'spec', 'img', 'imgNote')
additions = [{k: p[k] for k in PUBLIC_FIELDS if k in p} for p in NEW]
categories = [
    {'id': 'confined', 'name': 'Confined-Space Access', 'blurb': 'Tripods, davit arms and entry systems for planned confined-space work.'},
    {'id': 'rescue', 'name': 'Rescue & Evacuation', 'blurb': 'Recovery stretchers, evacuation devices and rescue kits.'},
    {'id': 'anchorage', 'name': 'Anchorage & Fall Arrest', 'blurb': 'Temporary lifelines and guided fall-arrest equipment.'},
]
block = (START + '\nwindow.HANEKOM_CATEGORIES.push(...' + json.dumps(categories, ensure_ascii=False) + ');\n'
         + 'window.HANEKOM_PRODUCTS.push(...' + json.dumps(additions, ensure_ascii=False) + ');\n' + END + '\n\n')
if START in PRODUCTS:
    PRODUCTS = re.sub(re.escape(START) + r'.*?' + re.escape(END) + r'\n\n', '', PRODUCTS, flags=re.S)
PRODUCTS = PRODUCTS.replace('window.hanekomSlug = function', block + 'window.hanekomSlug = function', 1)
JS.write_text(PRODUCTS)

node = '''const vm=require('vm'),fs=require('fs'); const window={};
vm.runInNewContext(fs.readFileSync('assets/js/products.js','utf8'),{window});
process.stdout.write(JSON.stringify({products:window.HANEKOM_PRODUCTS,categories:window.HANEKOM_CATEGORIES}));'''
data = json.loads(subprocess.check_output(['node', '-e', node], cwd=ROOT))
products, cats = data['products'], {c['id']: c['name'] for c in data['categories']}
assert len(products) == 80 and len({p['code'] for p in products}) == 80
assert len({p['url'] for p in products}) == 80

def e(s): return html.escape(str(s), quote=True)

def card(p):
    name, code, im, url = (e(p[k]) for k in ('name', 'code', 'img', 'url'))
    search = e(' '.join(str(p.get(k, '')) for k in ('code', 'name', 'variant', 'brand', 'desc', 'tag')).lower())
    wa = 'https://wa.me/260954263566?text=' + urllib.parse.quote(
        f"Hello Hanekom, please quote me on: {p['code']} — {p['name']}. Quantity needed: . Product page: https://www.hanekom.co.zm/{p['url']}")
    note = '<span class="ph-note" title="' + e(p['imgNote']) + '">representative image</span>' if p.get('imgNote') else ''
    variant = '<p class="var">' + e(p['variant']) + '</p>' if p.get('variant') else ''
    return (f'<article class="product" data-cat="{e(p["cat"])}" data-code="{code}" data-search="{search}">'
            f'<div class="ph"><a class="ph-link" href="{url}" aria-label="{name} details"></a>{note}'
            f'<picture><source srcset="assets/cat/{im}.webp" type="image/webp">'
            f'<img src="assets/cat/{im}.jpg" alt="{name}" loading="lazy" decoding="async" width="400" height="400"></picture></div>'
            f'<div class="pb"><span class="tag">{e(p["tag"])}</span><h3><a href="{url}">{name}</a></h3>'
            f'{variant}<p class="desc">{e(p["desc"])}</p><p class="spec">{e(p["spec"])}</p>'
            f'<div class="foot"><span style="display:flex;gap:.4rem"><a class="btn btn-sm btn-ghost card-wa" href="{e(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp about {code}">WhatsApp</a>'
            f'<button type="button" class="add-btn" data-add="{code}">Add to quotation</button></span></div></div></article>')

catalogue = ROOT / 'products.html'
s = catalogue.read_text()
s = s.replace('PPE Catalogue &amp; Prices Zambia', 'PPE Product Catalogue Zambia')
s = s.replace('45 priced PPE lines in ZMW:', '80 PPE product lines:')
s = s.replace('Forty-five priced lines', 'Eighty product lines')
s = s.replace('45 products', '80 products')
s = re.sub(r'(<div class="product-grid" id="product-grid" data-prerendered="true">).*?(</div>\s*<div class="empty" id="empty")',
           lambda m: m.group(1) + ''.join(map(card, products)) + m.group(2), s, count=1, flags=re.S)
s = re.sub(r'\s*<div class="sec-head">\s*<span class="eyebrow">Complete price index</span>.*?</div>\s*<div class="table-wrap".*?</table>\s*</div>', '', s, count=1, flags=re.S)
# The old ItemList recorded 45 fixed prices and stock statuses. Rebuild it without offers.
itemlist = {'@context': 'https://schema.org', '@type': 'ItemList',
            'name': 'Hanekom Innovations 2026 PPE catalogue', 'numberOfItems': len(products),
            'itemListElement': [{'@type': 'ListItem', 'position': i, 'url': 'https://www.hanekom.co.zm/' + p['url'], 'name': p['name']}
                                for i, p in enumerate(products, 1)]}
s = re.sub(r'<script type="application/ld\+json">\{"@context":"https://schema.org","@type":"ItemList".*?</script>',
           '<script type="application/ld+json">' + json.dumps(itemlist, ensure_ascii=False, separators=(',', ':')) + '</script>', s, count=1)
catalogue.write_text(s)

home = ROOT / 'index.html'; s = home.read_text()
s = s.replace('See 45 PPE lines with prices', 'Explore 80 PPE products')
s = s.replace('<span class="k">45</span>', '<span class="k">80</span>')
s = s.replace('View all 45 products', 'View all 80 products')
feature_start, feature_end = '<!-- expanded-catalogue-feature -->', '<!-- /expanded-catalogue-feature -->'
if feature_start in s:
    s = re.sub(re.escape(feature_start) + r'.*?' + re.escape(feature_end), '', s, flags=re.S)
feature_codes = ['Hi-Viz Vulkan 2-Tone', 'KARAM impact gloves', 'PN 800(DP)', 'PN 403']
feature_cards = ''.join(card(next(p for p in products if p['code'] == code)) for code in feature_codes)
feature = (f'''{feature_start}
<section><div class="wrap"><div class="sec-head"><span class="eyebrow">Expanded 2026 catalogue</span>
<h2>More equipment for the job</h2><p class="lead">Explore additional workwear, hand protection, confined-space access and rescue equipment.</p></div>
<div class="product-grid">{feature_cards}</div><div class="btn-row"><a class="btn btn-primary" href="products.html">Browse all 80 products</a></div>
</div></section>
{feature_end}''')
featured_end = s.index('</section>', s.index('id="featured"')) + len('</section>')
s = s[:featured_end] + '\n' + feature + s[featured_end:]
home.write_text(s)
quote = ROOT / 'quote.html'; quote.write_text(quote.read_text().replace('browse all 45 products', 'browse all 80 products'))

template = (ROOT / 'full-body-harness-with-double-lanyard-steel-scaffold-hooks-pn-10-s-pn-361.html').read_text()
head_body = template[template.index('<body>'):template.index('<main id="main">')]
foot = template[template.index('</main>'):]

for p in additions:
    p['url'] = next(x['url'] for x in products if x['code'] == p['code'])
    url = 'https://www.hanekom.co.zm/' + p['url']
    image = 'https://www.hanekom.co.zm/assets/cat/' + p['img'] + '.jpg'
    catname = cats[p['cat']]
    title = p['name'] + ' | Hanekom Innovations Zambia'
    desc = p['desc'] + ' Request a tailored quote from Hanekom Innovations in Zambia.'
    ld = {'@context': 'https://schema.org', '@type': 'Product', '@id': url + '#product',
          'name': p['name'], 'description': p['desc'], 'image': image,
          'category': catname, 'brand': {'@type': 'Brand', 'name': p['brand']}}
    if not p['code'][0].islower() and p['code'] not in ('Pigskin gloves','PVC gloves'):
        ld['sku'] = p['code']
    note = f'<p class="hint">{e(p["imgNote"])}</p>' if p.get('imgNote') else ''
    wa = 'https://wa.me/260954263566?text=' + urllib.parse.quote(
        f"Hello Hanekom, please quote me on {p['name']} ({p['code']}). Quantity: . Product page: {url}")
    page = f'''<!DOCTYPE html>
<html lang="en-ZM"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc)}">
<link rel="canonical" href="{e(url)}"><meta name="theme-color" content="#5FA83C">
<meta property="og:type" content="product"><meta property="og:site_name" content="Hanekom Innovations Limited">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{e(url)}"><meta property="og:image" content="{e(image)}">
<meta name="twitter:card" content="summary_large_image"><link rel="icon" href="assets/img/favicon.png" sizes="any">
<link rel="stylesheet" href="assets/css/style.min.css?v=20261008-brand-glass">
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False, separators=(',', ':'))}</script>
<script>window.__navTab="products.html"</script></head>
{head_body}<main id="main">
<div class="page-head"><div class="wrap"><p class="crumbs"><a href="index.html">Home</a> &rsaquo; <a href="products.html">Products</a> &rsaquo; <a href="products.html#cat={e(p['cat'])}">{e(catname)}</a></p></div></div>
<section class="tight"><div class="wrap"><div class="split pdp">
<div class="pdp-media"><picture><source srcset="assets/cat/{e(p['img'])}.webp" type="image/webp"><img src="assets/cat/{e(p['img'])}.jpg" alt="{e(p['name'])}" width="1200" height="1200" fetchpriority="high" decoding="async"></picture>{note}</div>
<div class="pdp-info"><span class="eyebrow">{e(p['tag'])}</span><h1>{e(p['name'])}</h1>
<p class="lead">{e(p['desc'])}</p>
<div class="btn-row"><button type="button" class="btn btn-primary" data-add="{e(p['code'])}">Add to quote</button>
<a class="btn btn-wa" href="{e(wa)}" target="_blank" rel="noopener">Ask on WhatsApp</a></div>
<dl class="pdp-spec"><div><dt>Brand</dt><dd>{e(p['brand'])}</dd></div>
<div><dt>Category</dt><dd><a href="products.html#cat={e(p['cat'])}">{e(catname)}</a></dd></div>
<div><dt>Specification</dt><dd>{e(p['spec'])}</dd></div></dl>
<div class="note green"><p>Tell us the quantity and application. Our team will confirm the exact model, suitability, availability and current price on a written quotation.</p></div>
</div></div></div></section>
<section class="cta-band"><div class="wrap center"><h2>Need {e(p['name'])} for your team?</h2>
<p>Send us the quantity and the site requirements for a tailored quotation.</p>
<div class="btn-row" style="justify-content:center"><a class="btn btn-amber" href="quote.html">Go to my quote list</a>
<a class="btn btn-ghost" href="products.html#cat={e(p['cat'])}">Explore {e(catname)}</a></div></div></section>
{foot}'''
    (ROOT / p['url']).write_text(page)

sitemap = ROOT / 'sitemap.xml'
if sitemap.exists():
    sm = sitemap.read_text()
    for p in additions:
        loc = 'https://www.hanekom.co.zm/' + p['url']
        if loc not in sm:
            sm = sm.replace('</urlset>', f'<url><loc>{e(loc)}</loc></url>\n</urlset>')
    sitemap.write_text(sm)

print('Built', len(additions), 'new detail pages and', len(products), 'price-free catalogue cards')
