package com.hanekom.images;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

/**
 * BatchConvert — converts every existing product image in a folder, in place.
 *
 * <p>Walks the source folder, and for every jpg / jpeg / png / webp that is not
 * itself a generated variant writes {@code <slug>-1200.webp} and {@code <slug>-400.webp}
 * next to the original. Originals are never modified or deleted.</p>
 *
 * <p>Usage (from the repository root):</p>
 * <pre>
 *   tools/image-optimizer/run.sh                      # converts assets/cat (the catalogue)
 *   tools/image-optimizer/run.sh assets/img           # converts any other folder
 *   tools/image-optimizer/run.sh --report-only        # dry run: list what would be converted
 * </pre>
 */
public final class BatchConvert {

    private BatchConvert() { }

    public static void main(String[] args) throws IOException {
        boolean reportOnly = false;
        Path dir = Paths.get("assets/cat");
        for (String a : args) {
            if ("--report-only".equals(a)) {
                reportOnly = true;
            } else {
                dir = Paths.get(a);
            }
        }
        if (!Files.isDirectory(dir)) {
            System.err.println("Not a directory: " + dir.toAbsolutePath());
            System.exit(2);
        }

        /* Group by slug: when a folder contains both e.g. P16.jpg and P16.webp the jpg
           is the canonical source (the old .webp was itself a derived render), so only
           one variant pair is produced per slug. */
        java.util.Map<String, Path> sources = new java.util.TreeMap<>();
        final Path base = dir;
        try (Stream<Path> files = Files.list(dir)) {
            files.filter(Files::isRegularFile)
                    .map(Path::getFileName)
                    .map(Path::toString)
                    .filter(ProductImageProcessor::isSourceImage)
                    .filter(n -> !ProductImageProcessor.isGeneratedVariant(n))
                    .forEach(n -> {
                        String slug = ProductImageProcessor.slugOf(n);
                        boolean isWebp = n.toLowerCase().endsWith(".webp");
                        Path chosen = sources.get(slug);
                        if (chosen == null) {
                            sources.put(slug, base.resolve(n));
                        } else if (!isWebp) {
                            /* prefer jpg/jpeg/png over an already-derived webp */
                            String current = chosen.getFileName().toString();
                            if (current.toLowerCase().endsWith(".webp")) {
                                sources.put(slug, base.resolve(n));
                            }
                        }
                    });
        }

        System.out.println("Folder: " + dir.toAbsolutePath());
        System.out.println("Source images found: " + sources.size());
        if (reportOnly) {
            for (Path p : sources.values()) {
                System.out.println("  would convert: " + p.getFileName());
            }
            return;
        }

        int done = 0;
        int failures = 0;
        long largeTotal = 0;
        long cardTotal = 0;
        long startedAt = System.currentTimeMillis();

        for (Path source : sources.values()) {
            String slug = ProductImageProcessor.slugOf(source.getFileName().toString());
            try {
                ProductImageProcessor.Result r = ProductImageProcessor.process(source, dir);
                done++;
                largeTotal += r.largeBytes;
                cardTotal += r.cardBytes;
                System.out.printf(Locale.ROOT, "%-28s %s%6d KB  %-24s %5d KB%n",
                        slug,
                        "  -1200: ", r.largeBytes / 1024,
                        "-400:", r.cardBytes / 1024);
            } catch (Exception e) {
                failures++;
                System.err.println("FAILED " + source.getFileName() + ": " + e.getMessage());
            }
        }

        long seconds = Math.max(1, (System.currentTimeMillis() - startedAt) / 1000);
        System.out.println("---------------------------------------------------------------");
        System.out.printf(Locale.ROOT, "Converted: %d  Failed: %d  in %ds%n", done, failures, seconds);
        System.out.printf(Locale.ROOT, "1200px total: %d KB (avg %d KB, budget 200 KB)%n",
                largeTotal / 1024, done > 0 ? largeTotal / 1024 / done : 0);
        System.out.printf(Locale.ROOT, "400px  total: %d KB (avg %d KB, budget 40 KB)%n",
                cardTotal / 1024, done > 0 ? cardTotal / 1024 / done : 0);
        if (failures > 0) {
            System.exit(1);
        }
    }
}
