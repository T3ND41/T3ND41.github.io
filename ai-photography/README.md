# Hanekom AI Photography Studio

Shared working standard for Miora (creative direction) and GLM (technical operator and independent reviewer).

## Source of truth

The supplied product photograph is authoritative. Generated imagery is illustrative until a human verifies it against authoritative product references. A beautiful image that misrepresents the product is a failed result.

## Roles

- **Miora** — reference analysis, shot lists, composition and prompts, visual review recommendations, corrections.
- **GLM** — SKU records, reference retrieval, generation/editing operations, asset registration, technical checks, independent review.
- Neither agent may claim the other reviewed or approved an image without a recorded result under `reviews/`.

## Non-negotiables

- Preserve exact shape, proportions, colours, logos, labels, stitching, reflective strips, straps, buckles, filters, valves, soles and every safety component.
- Never invent a safety feature. Never fabricate a rear, underside or internal view from a single front reference.
- If a detail cannot be verified, request another reference or flag it for manual review.
- Never overwrite supplier originals in `assets/cat/` or `assets/img/`.
- Do not deploy or replace live website imagery without explicit human approval.

## Folder layout

- `tasks/` — one file per photography task.
- `references/` — links to originals; originals stay in the website repository.
- `generated/` — candidates only, never approvals.
- `reviews/` — recorded GLM verdicts with exact visual discrepancies.
- `approved/` — approved masters and website variants.

## Task statuses

`PENDING` → `CLAIMED` → `IN_PROGRESS` → `AWAITING_REVIEW` → `REVISION_REQUIRED` → `APPROVED`, or `FAILED`.

No task may be marked `APPROVED` without a recorded review verdict.

## Review outcomes

`APPROVED` · `REVISION REQUIRED` · `REJECTED`. Revision requests must identify the exact visual discrepancies.

## Output specification — reuse the existing pipeline, do not rebuild

- Catalogue master: **1200 x 1200**, 1:1, WebP, under 200 KB.
- Catalogue thumbnail: **400 x 400**, 1:1, WebP, under 40 KB.
- Solid `#FFFFFF` background, product centred, approximately 5% breathing room, fitted without cropping or distortion.
- Tall and wide products remain completely visible. File-size goals never override fidelity.
- Produce variants with `tools/image-optimizer/run.sh assets/cat` from the repository root. Originals are untouched by that pipeline.
- Gallery is a separate track: natural aspect ratio, full image at 1600 px longest side, thumbnail at 600 px, WebP. Never force square, and never remove real people, equipment or environment.

## File naming

`SKU_view-angle_status_version.ext` — example: `PN800DP_front-approved_v01.webp`.

## Collaboration honesty

Writing a file does not notify the other agent. A human must trigger the review. Only record a task as sent, received, reviewed or approved when the result is actually recorded here.
