# Assessment 3 — Track 5 Task 5E Experiment Notes

**Date:** 2026-11-09  
**Protocol:** Option A features (no skills laundry list), Multinomial NB, `stratifiedGroupTrainTestSplit`, seed **42**, n=5000  
**Script:** `scripts/rag/track5-enrichment-experiments.mjs`  
**Final package:** See [`ASSESSMENT_3_TRACK5_REPORT.md`](./ASSESSMENT_3_TRACK5_REPORT.md)

## Why

Task 5D removed category-tied skills shortcuts (correct). Verify-run collapsed to **~3.46% accuracy / Macro F1 ~0.022** because template-group holdout needs **cross-title occupational vocabulary** to transfer. Task 5E enriches **title-keyed** duty prose only — never restoring skills leakage, never sabotaging labels.

## Variants

| Variant | What changed |
|---------|----------------|
| `post5d` | Frozen 5D baseline (location + short primary/secondary duties) |
| `enriched_v1` | Richer primary+secondary duties with shared occupational stems across related titles |
| `enriched_v2` | v1 + tertiary title-keyed sentences; sharper design vs marketing wording |
| `enriched_v3` | v2 + mild secondary-sentence diversity via `corpus_key` hash (still title-keyed) |

**Invariant on all runs:** no `Hands-on tools frequently used`, no `skills_text` / `SKILLS_BY_CATEGORY` / `CLASSIFIER_CLASS_LEXICON[category]` in features, no gold category used to pick prose.

## Experiment table (syntheticBenchmark)

| Variant | Accuracy | Macro F1 | Weighted F1 | skillsLinePresent | Notes |
|---------|----------:|---------:|------------:|:-----------------:|-------|
| post5d (5D baseline) | 0.0346 | 0.0220 | 0.0232 | false | Confirms 5D collapse |
| enriched_v1 | **0.8246** | 0.7966 | 0.7879 | false | Acc in preferred (70%,90%); F1 **below** 0.85 |
| enriched_v2 | 0.9123 | **0.8889** | 0.8831 | false | F1 ≥ 0.85; acc **≥ 90%** (still easy) |
| enriched_v3 | 0.9654 | **0.9667** | 0.9649 | false | Highest F1; acc clearly ≥ 90% |

Artifacts (new only; priors preserved):

- `scripts/rag/out/track5-enriched-post5d-2026-11-09T07-09-37-775Z.json`
- `scripts/rag/out/track5-enriched-enriched_v1-2026-11-09T07-09-37-775Z.json`
- `scripts/rag/out/track5-enriched-enriched_v2-2026-11-09T07-09-37-775Z.json`
- `scripts/rag/out/track5-enriched-enriched_v3-2026-11-09T07-09-37-775Z.json`
- `scripts/rag/out/track5-enriched-summary-2026-11-09T07-09-37-775Z.json`

Prior 5D / A2 files **not** overwritten (`classifier-eval.json`, `classifier-compare.json`, `original-description-eval.json`, `track5-remediated-*`).

## Independent / OOD

### Micro (5E matrix — unchanged)

Scored `ORIGINAL_JOB_DESCRIPTIONS` (n=12 hand-written) with each trained NB — **not** a real employer dataset.

| Variant | Indep. accuracy | Indep. macro F1 |
|---------|----------------:|----------------:|
| post5d | 0.083 | 0.056 |
| enriched_v1 | 0.250 | 0.167 |
| enriched_v2 | 0.250 | 0.181 |
| enriched_v3 | 0.333 | 0.250 |

### P4 — `track5_ood_v1` (licensed public original JDs)

| Field | Value |
|-------|--------|
| Dataset | `datasets/track5_ood_v1` (Apache-2.0; HF `its-zion-18/Jobs-tabular-dataset` original) |
| Protocol | Freeze default enrichment (`v2-div-b`); score OOD **once**; no OOD tuning |
| n | **215** |
| Accuracy (`v2-div-b`) | **0.2465** |
| Macro F1 (`v2-div-b`) | **0.2184** |
| Weighted F1 (`v2-div-b`) | **0.2390** |
| Prior freeze (`enriched_v2`) | acc 0.2326 / Macro F1 0.2104 (preserved) |
| Reproduce | `npm run rag:classify:track5-ood` |
| Artifact | `scripts/rag/out/track5-ood-v2-div-b-2026-11-09T10-48-33-119Z.json` |

HireHub live `jobs` export was attempted (n=15, no category column) and documented as insufficient in `datasets/track5_ood_v1/PROVENANCE.md`.

**Limitation:** OOD Macro F1 ~0.21 is **not** real-world HireHub-production proof, but it is a proper separate headline showing synthetic ≠ independent.

## Winner

| Role | Variant | Rationale |
|------|---------|-----------|
| **Raw metric winner (max Macro F1)** | `enriched_v3` | Macro F1 **0.967** |
| **5E recommended checkpoint** | `enriched_v2` | Macro F1 **0.889 ≥ 0.85** (acc ≥90% / still easy) |
| **P5 joint default** | `v2-div-b` | Macro F1 **0.861** and acc **0.864** ∈ (70%, 90%) — see [`ASSESSMENT_3_TRACK5_TASK5P5_DIVERSIFY_NOTES.md`](./ASSESSMENT_3_TRACK5_TASK5P5_DIVERSIFY_NOTES.md) |

`DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT` is now **`v2-div-b`** (P5). `enriched_v2` remains a preserved F1≥0.85 checkpoint.

### Gate check

- **Macro F1 ≥ 0.85 (synthetic):** **Yes** for `enriched_v2`, `enriched_v3`, `v2-div-a`, `v2-div-b`.  
- **Prefer accuracy in (70%, 90%):** `enriched_v1`, `v2-div-a`, `v2-div-b` (v1 F1 below gate).  
- **Joint band + F1 ≥ 0.85:** **Yes** after P5 — `v2-div-a` and `v2-div-b`.  
- **Accuracy ≥ 90% honesty (5E):** `enriched_v2` / `enriched_v3` still documented as easy checkpoints — not sabotaged.

## Honesty statement

Enrichment recovered Macro F1 ≥ 0.85 on the **synthetic** template-group benchmark without restoring the skills shortcut. That synthetic bar can be treated as **met** for Assessment 3 Track 5 evidence **with the caveat** that accuracy remains ≥ 90% for the recommended/default variants, so the synthetic task is still easier than a true unseen natural-JD setting. P4 independentBenchmark on `track5_ood_v1` (n=215) yields Macro F1 **~0.21** under the same frozen `enriched_v2` model — report separately; do not blend.

## Code touchpoints

- `src/lib/ai/job-classifier-enrichment.ts` — variant maps + builder  
- `src/lib/ai/job-classifier-dataset.ts` — variant wiring  
- `src/lib/ai/job-classifier.ts` / `job-classifier-compare.ts` — `enrichmentVariant` passthrough  
- `scripts/rag/track5-enrichment-experiments.mjs` — matrix runner  

## Tests

Classifier vitest packages re-run after enrichment: **passed** (dataset / job-classifier / tfidf-lr).

## P3 follow-up (2026-11-09) — design↔marketing wording cleanup

Removed marketing tokens from **design** enrichment lines (and reciprocal design tokens from **marketing** “not X” phrases) so negation wording cannot leak cross-class tokens into features.

Re-verify (`enriched_v2`, seed 42, n=5000), Option A intact:

| Metric | Pre-P3 (5E) | Post-P3 |
|--------|------------:|--------:|
| Accuracy | 0.9123 | **0.9123** |
| Macro F1 | 0.8889 | **0.8889** |
| Weighted F1 | 0.8831 | **0.8831** |
| meetsTrack5MacroF1 | yes | **yes** |
| skillsLinePresent | false | **false** |

New artifact (priors preserved):  
`scripts/rag/out/track5-enriched-enriched_v2-p3-2026-11-09T10-17-42-396Z.json`

---

*End of Task 5E (+ P3 wording note).*
