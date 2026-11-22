# Hanekom Photo Audit — Phase 1 (Read-Only Catalogue Audit)

**Status:** COMPLETE · **Scope:** READ-ONLY — zero modifications to any site file; this `audit/` folder contains only new files.
**Repo state audited:** `main` @ `e47b634` (clean tree). **Auditor:** GLM (technical operator), under Miora's direction.
**Machine record:** `audit-data.json` (all 80 products with provenance, dimensions, sizes, quality flags).

---

## 1. Catalogue inventory

- **80 products / 80 dedicated product pages** (99 HTML files = 80 product + 16 static + 3 location pages).
- 16 categories: height 10 · SRL 10 · lanyards 8 · hand 6 · body 6 · hivis 5 · workwear 4 · eye 4 · foot 4 · gumboots 4 · confined-space 4 · rescue 4 · respiratory 3 · head 3 · hearing 3 · anchorage 2.
- 22 brands; **KARAM = 49 SKUs**. Data lives in `assets/js/products.js` (45 hand-written + 35 EXP additions) and `scripts/catalogue-expanded.json` (EXP build records with PDF page + crop coordinates).

## 2. Available reference photos

- Every SKU has **exactly one view** (front/catalog shot) in 4 variants: `.jpg` original + `.webp` + `-400.webp` + `-1200.webp`. Integrity: 80/80 complete, 0 orphan SKUs, 0 duplicate content hashes.
- **35 EXP SKUs:** native 1200x1200 with provable provenance (supplier 2026 catalogue PDF, pages 4–25, crop coords in JSON).
- **45 legacy SKUs:** sources are **657x475 or 406x294 PDF-page crops, upscaled x1.82–x2.96** — permanent sharpness ceiling.
- Git provenance clean: originals added in `7b5abb6`; image-pipeline commit `e47b634` touched **0 JPGs** → originals never overwritten.
- Third-party web candidates for the pilot trio: UNVERIFIED URLs listed in the handover package; Miora must confirm model equivalence before use.

## 3. Missing / insufficient references

- **All 80 products: 0 of 5 required views exist** (no back / left / right / top anywhere on the site).
- Quality scan (luminance stddev + near-white share on all 80 hero images):
  - **CRITICAL (7):** `C10` FFP3 mask (ghost image, 98.3% near-white — unusable), `C01` dust mask (ghost), `EXP-PN900` davit arm, `EXP-PN241`, `EXP-PN242`, `EXP-PN245`, `C06` glasses. See `critical7-contact.png`.
  - **REVIEW (13):** `EXP-PN174`, `EXP-TYVEK`, `C08`, `EXP-PN800DP`, `C02`, `EXP-PN403`, `P09`, `EXP-WAYNE`, `EXP-PN2002SW`, `C05`, `EXP-PIGSKIN`, `EXP-PN3001C`, `EXP-PN654`.
  - OK: 60.
- Two zero-byte artifacts (`EXP-PIGSKIN.webp`, `EXP-PN42SP.webp` base variants) — not referenced by any page, no live breakage; cleanup candidate.
- **The supplier 2026 catalogue PDF is NOT in the repo.** It is required for final fidelity QC and is currently the only path to un-block `C10`.

## 4. Recommended first batch (pilot) — all confirmed in catalogue

| SKU | Product | Why it pilots |
|---|---|---|
| PN 800(DP) | KARAM Tripod with Double Pulley | rigid structure; faint hero (sd 31) — screenshot: `live-tripod-page.png` |
| PN 42(03) | Padded Work-Positioning Full Body Harness | wearable → mannequin pilot; 658x474 source upscaled x1.82 — screenshot: `live-pn4203-harness-page.png` |
| C10 | KARAM FFP3 Mask | ghost image; generation locked until a verified reference arrives — screenshot: `live-c10-page.png` |

## 5. First-batch Miora handover package

Full 12-item package: **[`first-batch-handover.md`](first-batch-handover.md)** — identity records, verification status, accessible reference URLs, defects-to-correct, shot lists, mannequin requirements, 15 complete per-view generation prompts with global fidelity negatives, delivery spec (1:1 1200 WebP <200KB + 400 <40KB, background #FFFFFF), naming convention `SKU_view-angle_status_version.ext`, QC verdict scale (APPROVED / APPROVED WITH MINOR CORRECTIONS / REQUIRES REGENERATION / REQUIRES BETTER REFERENCE IMAGES), handback route.

## 6. Production order — remaining 77 SKUs (batches of 2–3)

Severity first, then category coherence. Wearable batches (marked M) are mannequin-dependent (~30 SKUs). No batch starts before the previous one is APPROVED.

| Batch | SKUs |
|---|---|
| 1 (pilot) | PN 800(DP) · PN 42(03) · C10 |
| 2 | PN 241 · PN 242 · PN 245 (lanyard criticals) |
| 3 | C01 · C06 · C05 (resp/eye criticals) |
| 4 | PN 900 · DA 01 · SA 17 (confined) |
| 5 | PN 403 · PN 654 · PN 408 N (rescue) |
| 6 | PN 174 · PN 3001 C · PN2002(SW) |
| 7 | EXP-TYVEK · EXP-SHOE-COVERS · C02 (body) |
| 8 | EXP-WAYNE · EXP-STIMELA-STEEL · P09 |
| 9 (M) | PN 56 · PN 24 · MAGNA 2 |
| 10 (M) | MAGNA 3 · PN 10(S) · PN 21(WB) |
| 11 (M) | PN 42(03)(W) · PN 44(OR) · PN 42(SP)(03) |
| 12 | TPGS 3.5 · TPGS 06 · TPGS 10 |
| 13 | TPGS 15 · MIC 02 · TPGS SE |
| 14 | TPGS 25-30 · TPGS 20R-30R · SLBL 30R |
| 15 | PN 329(30) · PN 361(30) · TL 01(N) |
| 16 | TL 02(N) · P10 · C03 |
| 17 | C04 · EXP-IMPACT-GLOVES · EXP-PVC-GLOVES |
| 18 | EXP-PIGSKIN · P11 · C07 |
| 19 | C08 · C09 · EXP-SAFECO-CAP |
| 20 | P13 · EXP-CORDED-PLUGS · EXP-THUNDER-T2H |
| 21 (M) | P01 · P02 · P03 |
| 22 (M) | P04 · P08 · P12 |
| 23 (M) | P05 · P06 · P07 |
| 24 (M) | EXP-VULKAN · EXP-JAVLIN-HIVIZ · C11 |
| 25 (M) | P14 · P15 · P16 |
| 26 (M) | P17 · P18 · P19 |
| 27 | PN 2003 · PN 661 |

## Access limitations (stated honestly)

- The audit covered the repo clone and the live site only. No writes to the site outside this `audit/` folder.
- Miora cannot reach the build sandbox; this public folder is the handover channel.
- The supplier PDF must be supplied by Hanekom. `C10` stays REQUIRES BETTER REFERENCE IMAGES until then.
- Nothing enters the site pipeline without Hanekom's human approval.

## File index

| File | Contents |
|---|---|
| `first-batch-handover.md` | 12-item pilot handover package (prompts, specs, QC gates) |
| `audit-data.json` | machine-readable record of all 80 products (provenance, dims, sizes, quality flags) |
| `critical7-contact.png` | contact sheet of the 7 critical-quality hero images |
| `live-tripod-page.png` | live PN 800(DP) page capture |
| `live-pn4203-harness-page.png` | live PN 42(03) page capture |
| `live-c10-page.png` | live C10 page capture (ghost hero visible) |
