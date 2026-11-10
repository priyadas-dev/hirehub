# Assessment 3 — Track 5 Task 5D Implementation Notes

**Date:** 2026-11-09  
**Design followed:** [`ASSESSMENT_3_TRACK5_FEATURE_DATASET_REMEDIATION_DESIGN.md`](./ASSESSMENT_3_TRACK5_FEATURE_DATASET_REMEDIATION_DESIGN.md) (Option A)  
**Final package:** See [`ASSESSMENT_3_TRACK5_REPORT.md`](./ASSESSMENT_3_TRACK5_REPORT.md)

## What changed

1. **`job-classifier-dataset.ts` (Option A live)**  
   - `buildClassifierOrientedDescription` now emits: location opener + primary title-keyed duty + secondary title-keyed duty.  
   - Removed `Hands-on tools frequently used: ${skills_text}`.  
   - Does not inject `CLASSIFIER_CLASS_LEXICON` or gold `category` into feature text.  
   - Light design↔marketing cleanup: Brand Designer duty no longer uses campaign/growth wording.

2. **Pipeline alignment**  
   - `runJobClassifierPipeline` now uses `generateClassifierLabeledExamples` (remediated).  
   - `corpusDocsToLabeledExamples` kept as **raw legacy** with JSDoc gate — not official Track 5.  
   - `compareClassifiersOnGroupedSplit` already used remediated examples; now attaches `track5` dual-benchmark envelope.  
   - RAG `corpus-generate.ts` / `SKILLS_BY_CATEGORY` untouched.

3. **Eval reporting**  
   - `weightedF1` on every `ClassifierEvalReport`.  
   - Diagnostics: `skillsOnlyAccuracy`, `skillsLinePresentInTest`, `dutyOnlyAccuracy`, near-dup @ 0.9 and @ 0.5.  
   - `buildTrack5EvalEnvelope`: `syntheticBenchmark` + `independentBenchmark` (unavailable placeholder).  
   - `npm run rag:classify` / train script writes **versioned** `track5-remediated-*` only; supports `--nb-only`.

4. **Artifacts preserved**  
   - `classifier-eval.json`, `classifier-compare.json`, `original-description-eval.json` not overwritten.

## Verify run (honest)

Command: `node --import tsx scripts/rag/train-job-classifier.mjs --count=5000 --nb-only`

| Metric | Value |
|--------|------:|
| Accuracy | **0.0346 (3.46%)** |
| Macro F1 | **0.0220** |
| Weighted F1 | **0.0232** |
| skillsLinePresentInTest | **false** |
| skillsOnlyAccuracy | 0.0700 (non-informative; line absent) |
| descriptionOnly | 0.0961 |
| titleOnly | 0.1585 |
| dutyOnly | 0.0700 |
| Template-group overlap | 0 |
| Near-dup @0.9 / @0.5 | 0 / 0 |

Outputs:

- `scripts/rag/out/track5-remediated-nb-2026-11-09T06-53-39-788Z.json`
- `scripts/rag/out/track5-remediated-envelope-2026-11-09T06-53-39-788Z.json`

**Interpretation:** Removing the category-tied skills shortcut collapses the inflated ~95% synthetic score. Macro F1 **< 0.85**. No sabotage applied. **Task 5E** should run legitimate duty/prose enrichment experiments (still no skills laundry list, no noise/label attacks) aiming for natural accuracy in (70%, 90%) with Macro F1 ≥ 0.85 where possible, and report honestly if the task remains too hard/easy.

## Tests

`vitest` classifier suite (dataset, job-classifier, tfidf-lr, tune): **passed**.
