# HANEKOM PHOTOS — FIRST BATCH HANDOVER PACKAGE
**Batch 1 (pilot): PN 800(DP) | PN 42(03) | C10**
From: GLM (technical operator) — To: Miora (creative director)
Status: Phase 1 audit complete, READ-ONLY. No site files modified. No images generated.
Date: 2026-11 audit session. Repo: T3ND41/T3ND41.github.io @ e47b634 (main, clean).

---

## ITEM 1 — Batch scope
- 3 products: KARAM PN 800(DP) Tripod w/ Double Pulley; KARAM PN 42(03) Padded Work-Positioning Full Body Harness; KARAM C10 FFP3 Mask.
- Target: 5 views each (front / back / left / right / top). Catalog 1:1 1200x1200 white #FFFFFF + 400 thumbnail. Wearable harness on mannequin where the view requires it.
- Rule in force: current batch must be APPROVED before batch 2 starts.

## ITEM 2 — Product identity records (from products.js + product pages, verified live)
| Field | PN 800(DP) | PN 42(03) | C10 |
|---|---|---|---|
| Live page | /karam-tripod-with-double-pulley-pn-800-dp | /padded-work-positioning-full-body-harness-pn-42-03 | /karam-ffp3-mask-c10 |
| Name on page | KARAM Tripod with Double Pulley | Padded Work-Positioning Full Body Harness | KARAM FFP3 Mask |
| Brand / cat | KARAM / confined-space | KARAM / height | KARAM / respiratory |
| Catalog spec | Model PN 800(DP); 7 ft or 10 ft | EN 361 + EN 358, 2.04 kg | FFP3 class, fit testing |
| Catalog desc | Confined-space tripod with double pulley, 7 ft and 10 ft; winch/retrieval compatibility to confirm | Padded harness combining fall-arrest and work-positioning for maintenance and access | FFP3 disposable respirator, higher-level particulate filtration |

## ITEM 3 — Verification status (Phase 2)
- PROVENANCE VERIFIED: all three current site images traced to the supplied 2026 supplier catalogue PDF (EXP = explicit page/crop record; legacy = same PDF, lower render). Originals preserved unmodified in repo (commit 7b5abb6; e47b634 touched 0 jpgs).
- PHYSICAL TRUTH: **UNVERIFIED externally.** The supplier PDF is NOT in the repo and must be re-supplied by Hanekom before final QC. Do not invent colours, stitching, straps, buckles, labels or logos beyond what references show.
- Third-party web candidates (below) are UNVERIFIED — Miora must confirm model equivalence before any use.

## ITEM 4 — Reference inventory (accessible paths only; no local-only claims)
Current site assets (publicly reachable):
- PN 800(DP): https://hanekom.co.zm/assets/cat/EXP-PN800DP.jpg (source), -1200.webp / -400.webp variants. Defect: faint, product small in frame, sd 31.0, 93.7% white.
- PN 42(03): https://hanekom.co.zm/assets/cat/PN4203.jpg + variants. Defect: 658x474 source upscaled x1.82 — soft.
- C10: https://hanekom.co.zm/assets/cat/C10.jpg + variants. Defect: GHOST IMAGE — 98.3% near-white, mean 253.6. Unusable.
Supplier PDF: pages 4-25 carry these products (PN 800(DP)=p23; PN 42(03)=p20; C10=legacy section). **Not in repo — request from Hanekom.**
Third-party candidates (OSS re-hosts, UNVERIFIED, model check required):
- PN 800(DP): 1867px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/620634631787.jpg ; 1000px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/c7c72048e340.jpg ; 1050px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/ecc164d2a0cb.jpg
- PN 42(03): 1520px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/7fe87461ab92.jpg ; 1280px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/9888a59acf05.jpg ; 1280px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/c0efec24f446.jpg ; 894px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/a3f4b1a67c25.jpg
- C10 FFP3: 2000px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/42b872380b43.jpg ; 1600px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/339d46f004d2.webp ; 1000px https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/318eaf260a65.jpg
(Searched live on audit day; links re-hosted, stable at capture time.)

## ITEM 5 — Known defects to correct (what "better" means per product)
- PN 800(DP): larger product-in-frame (~80% fill), legible legs/pulley/head assembly, correct 2-pulley head.
- PN 42(03): sharper than 1.8x upscale; must show dorsal + sternal + positioning points, padding, leg straps; mannequin front/back views.
- C10: currently invisible; needs a real reference before any render. If no reference arrives, product stays REQUIRES BETTER REFERENCE IMAGES.

## ITEM 6 — Shot list (per product)
PN 800(DP): 1 front full tripod standing; 2 head assembly top-down (double pulley visible); 3 left profile; 4 right profile; 5 top-down footprint of legs.
PN 42(03): 1 front worn on mannequin; 2 back on mannequin (dorsal); 3 left profile; 4 right profile; 5 flat-lay top-down of harness.
C10: 1 front of mask; 2 back/inner (headband + foam); 3 left; 4 right; 5 top-down.

## ITEM 7 — Mannequin requirements
- Adjustable adult dress-form or articulated mannequin, torso only acceptable; neutral matte grey or fabric finish, no brand markings.
- Harness donned per KARAM instructions: shoulder straps vertical, chest/leg straps tensioned flat, no twist; dorsal D visible from back view.
- Mannequin must not obscure attachment hardware in profile views.

## ITEM 8 — Generation prompts (complete, per view)
Global suffix (append to every prompt): "professional PPE catalogue photography, seamless pure white background hex FFFFFF, even soft studio lighting, no shadows on background, product fills about 80 percent of frame, centered, 1:1 square 1200x1200, photorealistic, sharp focus, no props, no people, no text overlays, no watermark."
Global negative: "no invented logos, no added brand text, no altered colors, no extra straps or buckles, no stitching patterns not in reference, no model number changes, no reflections showing other objects, no props, no mannequin head brand marks."

PN 800(DP):
- Front: "KARAM PN 800(DP) confined-space rescue tripod, three aluminium legs with feet planted evenly, standing upright, head assembly with double pulley centered at top, welded aluminium grain finish exactly as in reference photos."
- Back: "KARAM PN 800(DP) tripod photographed from directly behind, three legs converging at the head, double pulley and attachment eye visible, same finish as reference."
- Left: "KARAM PN 800(DP) tripod left side profile, one leg forward two legs back silhouette accurate to reference, double pulley side profile."
- Right: "KARAM PN 800(DP) tripod right side profile, mirror of left, double pulley side profile."
- Top: "KARAM PN 800(DP) tripod shot from above, triangular leg spread, double pulley head centered."

PN 42(03):
- Front: "KARAM PN 42(03) padded work-positioning full body harness worn on a neutral unbranded mannequin, front view, padded shoulder straps, chest strap, sternal D-ring and work-positioning side D-rings visible, webbing colour and stitching exactly as reference."
- Back: "same harness on mannequin, back view, padded dorsal plate with dorsal D-ring centred between shoulder blades, cross-back webbing as reference."
- Left: "harness left profile on mannequin, lateral D-ring and leg strap routing visible, no twisted webbing."
- Right: "harness right profile on mannequin, lateral D-ring and leg strap routing visible."
- Top/flat: "same harness laid flat top-down, straps arranged without overlap, all five adjustment buckles and both D-rings visible."

C10:
- Front: "KARAM C10 FFP3 disposable cup respirator, single cup shape, front view, head straps as in reference, valve presence only if reference shows it, white shell colour as reference."
- Back: "KARAM C10 FFP3 respirator rear view, inner foam seal and dual headbands visible as reference."
- Left: "KARAM C10 FFP3 respirator left profile showing cup depth."
- Right: "KARAM C10 FFP3 respirator right profile."
- Top: "KARAM C10 FFP3 respirator top-down, crown of cup and strap attachment points."

## ITEM 9 — Technical delivery spec
- Catalog: 1:1, 1200x1200 master (WebP, <200KB) + 400x400 thumb (<40KB), background #FFFFFF.
- Gallery extras: natural aspect, longest edge <=1600px full / <=600px preview, WebP.
- Never overwrite originals: new files arrive as SKU_view-angle_status_version.ext (e.g. PN800DP_front-approach_APPROVED_v1.webp). Site integration is a separate, human-approved step.

## ITEM 10 — Naming convention
`SKU_view-angle_status_version.ext` — status in {DRAFT, REVIEW, APPROVED, REJECTED}; angle in {front, back, left, right, top}; versions v1, v2...

## ITEM 11 — Acceptance criteria / QC gate
Per image: APPROVED / APPROVED WITH MINOR CORRECTIONS / REQUIRES REGENERATION / REQUIRES BETTER REFERENCE IMAGES.
Fidelity first: correct model features, no invented hardware/labels/colours; photography quality second. C10 without verified reference must NOT be generated.

## ITEM 12 — Handback route
Miora returns files + per-image status verdicts via the bridge queue when deployed (currently NOT reachable from outside this sandbox — deployment decision pending) or via any agreed file drop; GLM records assets and queues nothing to the site without Hanekom's human approval.
