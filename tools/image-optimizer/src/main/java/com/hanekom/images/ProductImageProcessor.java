package com.hanekom.images;

import net.coobird.thumbnailator.Thumbnails;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.FileImageOutputStream;
import javax.imageio.stream.ImageOutputStream;
import java.awt.image.BufferedImage;
import java.awt.Color;
import java.awt.Graphics2D;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.Iterator;
import java.util.List;

/**
 * ProductImageProcessor — Hanekom Innovations catalogue image pipeline.
 *
 * <p>What it does to every supplier photo:</p>
 * <ol>
 *   <li><b>Cleans the background to pure #FFFFFF.</b> A border flood-fill turns every
 *       near-white / off-white / off-gray pixel that is connected to the image edge into
 *       pure white (supplier photos and the old catalogue renders both sit on slightly
 *       tinted paper). Product pixels, printed branding and natural drop shadows are
 *       never touched; a one-pixel feather pass removes gray JPEG halos left at the
 *       cut-out edge.</li>
 *   <li><b>Centres the product inside a 1:1 square with a 5% white margin.</b>
 *       The whole product is fitted into the central 1080 x 1080 box of the canvas —
 *       the image is scaled to fit, never cropped, so tall items (KARAM tripods,
 *       harnesses, conti suits) and wide items (boots, gloves, respirators) all stay
 *       completely visible.</li>
 *   <li><b>Exports two WebP variants</b> next to the source image:
 *       <ul>
 *         <li>{@code <slug>-1200.webp} — 1200 x 1200, quality 0.82, budget &lt; 200 KB
 *             (product detail pages and zoom views)</li>
 *         <li>{@code <slug>-400.webp} — 400 x 400, quality 0.80, budget &lt; 40 KB
 *             (catalogue grid cards, "Frequently ordered lines", category tiles)</li>
 *       </ul>
 *       If a file misses its byte budget the encoder quality is stepped down until it
 *       fits (floor 0.70).</li>
 * </ol>
 *
 * <p><b>Reusable API:</b> there is no admin/upload flow on the static site today, but
 * when one exists the entry point is {@link #process(Path, Path)} — pass the uploaded
 * original and the output folder, and the two WebP variants come back as written
 * files. The original is never modified or deleted (the WhatsApp deep links keep
 * referencing the {@code .jpg} originals).</p>
 */
public final class ProductImageProcessor {

    /** Output canvas edge in pixels (1:1 square). */
    public static final int CANVAS = 1200;
    /** Grid-card variant edge in pixels. */
    public static final int CARD = 400;
    /** White margin around the product, as a fraction of the canvas edge. */
    public static final double MARGIN = 0.05; /* 5% -> content box is 1080 x 1080 */

    /** Byte budget for the 1200 px variant. */
    public static final long BUDGET_1200 = 200L * 1024;
    /** Byte budget for the 400 px variant. */
    public static final long BUDGET_400 = 40L * 1024;

    private static final int CONTENT_BOX = (int) Math.round(CANVAS * (1 - 2 * MARGIN));

    /* --- background detection thresholds ---------------------------------- */
    /** A pixel whose dimmest channel is at least this bright counts as background. */
    private static final int BG_MIN = 216;
    /** Background pixels must be near-neutral (paper/white sweep, not product colour). */
    private static final int BG_SPREAD = 20;
    /** Feather pass thresholds (slightly looser, applied only next to cleaned pixels). */
    private static final int FEATHER_MIN = 176;
    private static final int FEATHER_SPREAD = 30;

    /** Result of processing one source image. */
    public static final class Result {
        public final Path large;
        public final Path card;
        public final long largeBytes;
        public final long cardBytes;
        public final double largeQuality;
        public final double cardQuality;

        Result(Path large, Path card, long largeBytes, long cardBytes,
               double largeQuality, double cardQuality) {
            this.large = large;
            this.card = card;
            this.largeBytes = largeBytes;
            this.cardBytes = cardBytes;
            this.largeQuality = largeQuality;
            this.cardQuality = cardQuality;
        }
    }

    private ProductImageProcessor() { }

    /* ====================================================================== */
    /* Reusable entry point                                                   */
    /* ====================================================================== */

    /**
     * Processes one product image.
     *
     * @param source   the original supplier photo (jpg, jpeg, png or webp)
     * @param outputDir where to write {@code <slug>-1200.webp} and {@code <slug>-400.webp}
     * @return the two written files with their final sizes and encoder qualities
     * @throws IOException on read/write failure, or if no WebP writer is registered
     */
    public static Result process(Path source, Path outputDir) throws IOException {
        BufferedImage src = ImageIO.read(source.toFile());
        if (src == null) {
            throw new IOException("Unsupported image format: " + source);
        }
        return process(src, slugOf(source.getFileName().toString()), outputDir);
    }

    /**
     * Processes an already-decoded image (for upload flows that hold the bitmap in
     * memory). Same contract as {@link #process(Path, Path)}.
     */
    public static Result process(BufferedImage source, String slug, Path outputDir) throws IOException {
        Files.createDirectories(outputDir);

        BufferedImage flat = flattenOnWhite(source);
        whitenBackground(flat);
        int[] box = contentBox(flat);

        BufferedImage square = composeSquare(flat, box);
        Path large = writeBudgeted(square, outputDir.resolve(slug + "-1200.webp"),
                0.82, BUDGET_1200, CANVAS);
        BufferedImage cardImg = Thumbnails.of(square).size(CARD, CARD)
                .imageType(BufferedImage.TYPE_INT_RGB).asBufferedImage();
        Path card = writeBudgeted(cardImg, outputDir.resolve(slug + "-400.webp"),
                0.80, BUDGET_400, CARD);
        return new Result(large, card, Files.size(large), Files.size(card),
                lastLargeQuality, lastCardQuality);
    }

    private static double lastLargeQuality;
    private static double lastCardQuality;

    /* ====================================================================== */
    /* Step 1 — flatten transparency onto white                               */
    /* ====================================================================== */

    private static BufferedImage flattenOnWhite(BufferedImage src) {
        if (src.getType() == BufferedImage.TYPE_INT_RGB) {
            return src; /* opaque already */
        }
        BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(),
                BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, out.getWidth(), out.getHeight());
        g.drawImage(src, 0, 0, null);
        g.dispose();
        return out;
    }

    /* ====================================================================== */
    /* Step 2 — clean the paper background to pure #FFFFFF                    */
    /* ====================================================================== */

    private static boolean backgroundLike(int r, int g, int b) {
        int mn = Math.min(r, Math.min(g, b));
        int mx = Math.max(r, Math.max(g, b));
        return mn >= BG_MIN && (mx - mn) <= BG_SPREAD;
    }

    /**
     * Flood-fills every near-white pixel connected to the image border to pure white.
     * Only the connected background is cleaned — a white garment on the model, pale
     * product labels or interior gaps are never touched because they are not connected
     * to the frame. Natural drop shadows stop the fill and are kept for realism.
     */
    static void whitenBackground(BufferedImage img) {
        final int w = img.getWidth();
        final int h = img.getHeight();
        final int[] px = img.getRGB(0, 0, w, h, null, 0, w);

        boolean[] bg = new boolean[w * h];
        Deque<Integer> queue = new ArrayDeque<>();
        for (int x = 0; x < w; x++) {
            enqueueIfBackground(x, px, bg, queue, w * h);
            enqueueIfBackground((h - 1) * w + x, px, bg, queue, w * h);
        }
        for (int y = 0; y < h; y++) {
            enqueueIfBackground(y * w, px, bg, queue, w * h);
            enqueueIfBackground(y * w + w - 1, px, bg, queue, w * h);
        }
        while (!queue.isEmpty()) {
            int idx = queue.poll();
            int x = idx % w;
            int y = idx / w;
            if (x > 0) enqueueIfBackground(idx - 1, px, bg, queue, w * h);
            if (x < w - 1) enqueueIfBackground(idx + 1, px, bg, queue, w * h);
            if (y > 0) enqueueIfBackground(idx - w, px, bg, queue, w * h);
            if (y < h - 1) enqueueIfBackground(idx + w, px, bg, queue, w * h);
        }

        /* paint the cleaned background pure white */
        for (int i = 0; i < px.length; i++) {
            if (bg[i]) {
                px[i] = 0x00FFFFFF;
            }
        }

        /* one feather pass: soften the gray JPEG halo that hugs the cut-out edge */
        int[] out = px.clone();
        int[] neighbours = {-1, 1, -w, w};
        for (int i = 0; i < px.length; i++) {
            if (bg[i]) {
                continue;
            }
            int x = i % w;
            if ((x == 0) || (x == w - 1) || (i < w) || (i >= px.length - w)) {
                continue;
            }
            boolean touchesBackground = false;
            for (int n : neighbours) {
                if (bg[i + n]) {
                    touchesBackground = true;
                    break;
                }
            }
            if (!touchesBackground) {
                continue;
            }
            int rgb = px[i];
            int r = (rgb >> 16) & 255;
            int g = (rgb >> 8) & 255;
            int b = rgb & 255;
            int mn = Math.min(r, Math.min(g, b));
            int mx = Math.max(r, Math.max(g, b));
            if (mn >= FEATHER_MIN && (mx - mn) <= FEATHER_SPREAD) {
                out[i] = ((blend(r) & 255) << 16) | ((blend(g) & 255) << 8) | (blend(b) & 255);
            }
        }
        img.setRGB(0, 0, w, h, out, 0, w);
    }

    private static int blend(int channel) {
        return channel + Math.round(0.70f * (255 - channel));
    }

    private static void enqueueIfBackground(int idx, int[] px, boolean[] bg,
                                            Deque<Integer> queue, int limit) {
        if (idx < 0 || idx >= limit || bg[idx]) {
            return;
        }
        int rgb = px[idx];
        if (backgroundLike((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)) {
            bg[idx] = true;
            queue.add(idx);
        }
    }

    /* ====================================================================== */
    /* Step 3 — content bounding box (for centring only; never used to crop)  */
    /* ====================================================================== */

    private static int[] contentBox(BufferedImage img) {
        final int w = img.getWidth();
        final int h = img.getHeight();
        final int[] px = img.getRGB(0, 0, w, h, null, 0, w);
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int rgb = px[y * w + x];
                int r = (rgb >> 16) & 255;
                int g = (rgb >> 8) & 255;
                int b = rgb & 255;
                int mn = Math.min(r, Math.min(g, b));
                int mx = Math.max(r, Math.max(g, b));
                boolean content = mn < 234 || (mx - mn) > BG_SPREAD;
                if (content) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) { /* fully blank image — treat everything as content */
            return new int[]{0, 0, w - 1, h - 1};
        }
        return new int[]{minX, minY, maxX, maxY};
    }

    /* ====================================================================== */
    /* Step 4 — 1:1 square canvas, 5% margin, no cropping                     */
    /* ====================================================================== */

    private static BufferedImage composeSquare(BufferedImage flat, int[] box) throws IOException {
        int cw = box[2] - box[0] + 1;
        int ch = box[3] - box[1] + 1;
        BufferedImage content = flat.getSubimage(box[0], box[1], cw, ch);

        double scale = Math.min((double) CONTENT_BOX / cw, (double) CONTENT_BOX / ch);
        int dw = Math.max(1, (int) Math.round(cw * scale));
        int dh = Math.max(1, (int) Math.round(ch * scale));

        /* fit-to-box scaling, aspect preserved: taller than wide or wider than tall
           both land entirely inside the 1080 x 1080 content box — nothing is cropped */
        BufferedImage scaled = Thumbnails.of(content).size(dw, dh)
                .imageType(BufferedImage.TYPE_INT_RGB).asBufferedImage();

        BufferedImage canvas = new BufferedImage(CANVAS, CANVAS, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = canvas.createGraphics();
        g.setColor(Color.WHITE);
        g.fillRect(0, 0, CANVAS, CANVAS);
        g.drawImage(scaled, (CANVAS - scaled.getWidth()) / 2, (CANVAS - scaled.getHeight()) / 2, null);
        g.dispose();
        return canvas;
    }

    /* ====================================================================== */
    /* Step 5 — WebP export with byte budgets                                 */
    /* ====================================================================== */

    private static Path writeBudgeted(BufferedImage img, Path target, double quality,
                                      long budget, int edge) throws IOException {
        double q = quality;
        Path out = target;
        while (true) {
            writeWebP(img, out, q, edge);
            long bytes = Files.size(out);
            if (bytes <= budget || q <= 0.70) {
                lastQualityFor(edge, q);
                if (bytes > budget) {
                    System.err.println("WARNING: " + out.getFileName() + " is "
                            + (bytes / 1024) + " KB, over the " + (budget / 1024)
                            + " KB budget at the quality floor.");
                }
                return out;
            }
            q = Math.max(0.70, q - 0.04);
        }
    }

    private static void lastQualityFor(int edge, double q) {
        if (edge == CANVAS) {
            lastLargeQuality = q;
        } else {
            lastCardQuality = q;
        }
    }

    private static void writeWebP(BufferedImage img, Path target, double quality, int edge)
            throws IOException {
        Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("webp");
        if (!writers.hasNext()) {
            throw new IOException("No WebP writer registered. Add org.sejda.imageio:webp-imageio "
                    + "(the TwelveMonkeys imageio-webp plugin is read-only) to the classpath.");
        }
        ImageWriter writer = writers.next();
        FileImageOutputStream output = null;
        try {
            /* sejda webp-imageio: explicit lossy quality; falls back to library defaults */
            ImageWriteParam param;
            try {
                Class<?> wpClass = Class.forName("com.luciad.imageio.webp.WebPWriteParam");
                param = (ImageWriteParam) wpClass.getConstructor(java.util.Locale.class)
                        .newInstance(writer.getLocale());
                param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                try {
                    param.setCompressionType("Lossy");
                } catch (Exception ignored) {
                    /* the writer's default compression type is lossy already */
                }
                param.setCompressionQuality((float) quality);
            } catch (ReflectiveOperationException | LinkageError notAvailable) {
                param = writer.getDefaultWriteParam(); /* default quality fallback */
            }
            output = new FileImageOutputStream(target.toFile());
            writer.setOutput((ImageOutputStream) output);
            writer.write(null, new IIOImage(img, null, null), param);
        } finally {
            if (output != null) {
                output.close();
            }
            writer.dispose();
        }
    }

    /* ====================================================================== */
    /* Helpers                                                                */
    /* ====================================================================== */

    /** {@code P16.jpg -> P16}, {@code EXP-VULKAN.webp -> EXP-VULKAN}. */
    public static String slugOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot < 0 ? fileName : fileName.substring(0, dot);
    }

    /** True for the two variant files this pipeline generates ({@code -1200.webp}, {@code -400.webp}). */
    public static boolean isGeneratedVariant(String fileName) {
        String n = fileName.toLowerCase();
        return n.endsWith("-1200.webp") || n.endsWith("-400.webp");
    }

    /** Source extensions the processor accepts. */
    public static boolean isSourceImage(String fileName) {
        String n = fileName.toLowerCase();
        return n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png") || n.endsWith(".webp");
    }

    /** Small shared type used by the batch report. */
    public static List<String> describe(Result r) {
        List<String> lines = new ArrayList<>();
        lines.add(r.large.getFileName() + "  " + (r.largeBytes / 1024) + " KB  q=" + r.largeQuality);
        lines.add(r.card.getFileName() + "  " + (r.cardBytes / 1024) + " KB  q=" + r.cardQuality);
        return lines;
    }
}
