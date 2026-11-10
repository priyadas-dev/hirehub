# Assessment 3 — Track 5 P5 Diversification Notes

**Date:** 2026-11-09  
**Protocol:** Option A (no skills laundry list), Multinomial NB, template-group split, seed **42**, n=5000  
**Script:** `npm run rag:classify:track5-p5`  
**Goal (aspirational):** Macro F1 **≥ 0.85** **and** accuracy ∈ **(70%, 90%)**

## Why

`enriched_v2` met Track 5 Macro F1 but stayed **≥ 90%** accuracy (synthetic still easy).  
`enriched_v1` sat in the preferred accuracy band but Macro F1 **0.797 < 0.85**.  
P5 tries legitimate duty diversification (less repeated class stems / more phrasing variety) — **no sabotage**.

## Variants

| Variant | Construction |
|---------|----------------|
| `enriched_v1` | Reference: rich primary+secondary |
| `enriched_v2` | Reference: v1 + full tertiary |
| `v2-div-a` | v1 primary + diversified secondary alternates + **thin** tertiary |
| `v2-div-b` | paraphrased primary pool + diversified secondary; **no** tertiary |

## Results (`syntheticBenchmark`)

| Variant | Accuracy | Macro F1 | Band (70–90%) | meetsTrack5MacroF1 | Joint |
|---------|----------:|---------:|:-------------:|:------------------:|:-----:|
| enriched_v1 | 0.8246 | 0.7966 | yes | no | no |
| enriched_v2 | 0.9123 | 0.8889 | no (≥90%) | yes | no |
| **v2-div-a** | **0.8592** | **0.8527** | **yes** | **yes** | **yes** |
| **v2-div-b** | **0.8642** | **0.8612** | **yes** | **yes** | **yes** |

Artifacts:

- `scripts/rag/out/track5-p5-enriched_v1-2026-11-09T10-32-12-902Z.json`
- `scripts/rag/out/track5-p5-enriched_v2-2026-11-09T10-32-12-902Z.json`
- `scripts/rag/out/track5-p5-v2-div-a-2026-11-09T10-32-12-902Z.json`
- `scripts/rag/out/track5-p5-v2-div-b-2026-11-09T10-32-12-902Z.json`
- `scripts/rag/out/track5-p5-summary-2026-11-09T10-32-12-902Z.json`

## Decision

- **Joint winners:** `v2-div-a`, `v2-div-b`  
- **New default:** `v2-div-b` (`DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT`) — higher Macro F1 inside the preferred band  
- Prior `enriched_v2` evidence **preserved** (still a valid F1≥0.85 checkpoint with honest ≥90% accuracy note)  
- Option A unchanged; skills line absent on all runs  
- P4 OOD under frozen **`v2-div-b`**: n=215, acc **0.2465**, Macro F1 **0.2184** (`track5-ood-v2-div-b-2026-11-09T10-48-33-119Z.json`). Prior `enriched_v2` OOD freeze preserved (~0.21 Macro F1).

## Honesty

Diversification worked **without** noise, label flips, or restoring skills leakage. Prefer band + F1 ≥ 0.85 is now met on syntheticBenchmark for both div variants. Synthetic scores are still not real-world claims — see P4 `independentBenchmark`.
