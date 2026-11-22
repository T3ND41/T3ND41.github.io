# Hanekom Product Image Optimizer

Automated image pipeline for the 80-product catalogue on hanekom.co.zm.

## What it does

1. **Cleans supplier backgrounds to pure `#FFFFFF`** — a border flood-fill turns every
   near-white/off-gray pixel connected to the image edge into pure white (fixes the old
   `#fbfcfa` tint and any supplier paper). Products, branding and natural drop shadows
   are untouched; a feather pass removes gray JPEG halos at the cut-out edge.
2. **Centres the product in a 1:1 square with a 5% white margin** — the whole product is
   fitted into the central 1080x1080 box of a 1200x1200 canvas. The image is scaled to
   fit and **never cropped**, so tall items (KARAM tripod, harnesses, conti suits) and
   wide items (boots, gloves, respirators) all stay completely visible.
3. **Exports two WebP variants next to the original** (originals are never modified —
   WhatsApp deep links keep using the `.jpg` files):

   | File | Size | Quality | Byte budget | Used by |
   |---|---|---|---|---|
   | `<slug>-1200.webp` | 1200 x 1200 | 0.82 | < 200 KB | product pages, zoom views |
   | `<slug>-400.webp` | 400 x 400 | 0.80 | < 40 KB | grid cards, Frequently ordered lines, Expanded 2026 catalogue |

   If a file misses its budget the encoder quality steps down (floor 0.70) until it fits.

## Running it

The repo is plain HTML/CSS/JS, so this is a plain-Java project — the jars are vendored
in `lib/` and no Maven/Gradle install is needed (any JDK 11+ works; Temurin 21 tested):

```bash
tools/image-optimizer/run.sh                # convert everything in assets/cat
tools/image-optimizer/run.sh assets/img     # convert a different folder
tools/image-optimizer/run.sh --report-only  # dry run
```

Maven users can instead run `mvn -q compile exec:java -Dexec.args="assets/cat"`.

## Java libraries

- `net.coobird:thumbnailator:0.4.20` — high-quality multi-step rescaling
- `com.twelvemonkeys.imageio:imageio-webp:3.11.0` — WebP **reader** (TwelveMonkeys ships
  read-only WebP support) plus its core/metadata/common jars
- `org.sejda.imageio:webp-imageio:0.1.6` — the WebP **writer** (native libwebp bundled)

## Reusable method for a future upload flow

There is no admin/upload flow on the static site yet. When one exists, this is the hook:

```java
ProductImageProcessor.Result r =
    ProductImageProcessor.process(Path.of("/uploads/IMG_1234.jpg"), Path.of("assets/cat"));
// -> writes IMG_1234-1200.webp and IMG_1234-400.webp into assets/cat
```

`process(BufferedImage, slug, outputDir)` is also available if the upload arrives as a
decoded bitmap. The batch runner (`BatchConvert`) simply calls the same method in a loop.
