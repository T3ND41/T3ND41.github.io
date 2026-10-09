"""Make faithful, larger product photos from the supplied 2026 catalogue PDF.

Usage: python scripts/process-expanded-images.py /path/to/catalogue.pdf
The square canvas is 1200 px; source pixels are resampled, never invented.
"""
import io
import json
import sys
from pathlib import Path

import fitz
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'scripts/catalogue-expanded.json').read_text())
OUT = ROOT / 'assets/cat'
PDF = fitz.open(sys.argv[1])


def source_image(source):
    page = PDF[source['page'] - 1]
    if 'crop' in source:
        # The catalogue's first section is a single 1655 x 2340 pixel page image.
        item = page.get_images(full=True)[0]
        raw = PDF.extract_image(item[0])['image']
        im = Image.open(io.BytesIO(raw)).convert('RGB')
        x1, y1, x2, y2 = source['crop']
        return im.crop(tuple(round(v * scale) for v, scale in
                             zip((x1, y1, x2, y2),
                                 (im.width / 849, im.height / 1200,
                                  im.width / 849, im.height / 1200))))

    item = page.get_images(full=True)[source['index']]
    pix = fitz.Pixmap(PDF, item[0])
    if item[1]:
        mask = fitz.Pixmap(PDF, item[1])
        pix = fitz.Pixmap(pix, mask)
    return Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGBA')


for product in DATA:
    im = source_image(product['source'])
    original_size = im.size
    scale = 1050 / max(im.size)
    im = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    if min(original_size) < 800:
        # A measured sharpening pass compensates for the catalogue's downsampling.
        im = im.filter(ImageFilter.UnsharpMask(radius=1.3, percent=85, threshold=3))
    canvas = Image.new('RGB', (1200, 1200), '#fbfcfa')
    canvas.paste(im, ((1200 - im.width) // 2, (1200 - im.height) // 2),
                 im if im.mode == 'RGBA' else None)
    stem = OUT / product['img']
    canvas.save(stem.with_suffix('.webp'), 'WEBP', quality=86, method=6)
    canvas.save(stem.with_suffix('.jpg'), 'JPEG', quality=86, optimize=True, progressive=True)
    print(product['img'], im.size)
