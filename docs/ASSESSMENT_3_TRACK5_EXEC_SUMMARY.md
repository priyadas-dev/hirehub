# Assessment 3 Track 5 — Executive Summary

**One line:** HireHub met Track 5’s **Macro F1 ≥ 0.85** on a clean **synthetic** job-category classifier — and after P5 diversification, jointly hit the preferred **(70%, 90%)** accuracy band — without claiming real-world JD mastery.

| Item | Result |
|------|--------|
| Model | Multinomial Naive Bayes (existing; Option A features) |
| Default variant | **`v2-div-b`** (P5 joint winner) |
| Synthetic accuracy | **0.864** (∈ preferred band) |
| Synthetic Macro F1 | **0.861** (≥ 0.85 **met**) |
| Prior checkpoint `enriched_v2` | Acc **0.912** / Macro F1 **0.889** (F1 met; acc ≥90% / still easy) |
| Independent OOD (`track5_ood_v1`, n=215, frozen **`v2-div-b`**) | Acc **0.247** / Macro F1 **0.218** — separate headline |
| Prior OOD freeze (`enriched_v2`) | Acc **0.233** / Macro F1 **0.210** (preserved) |
| Soft micro (n=12 hand-written) | Acc **0.25** / Macro F1 **0.18** |
| Skills shortcut restored? | **No** |
| Sabotage / RAG / env / DB changes? | **No** |

**Story:** Leak removed → collapse → enrichment recovered F1 → P4 showed synthetic ≠ OOD → P5 diversified duties to hit band + F1 together.

**Primary evidence:** `scripts/rag/out/track5-p5-v2-div-b-2026-11-09T10-32-12-902Z.json`  
**OOD evidence (default):** `scripts/rag/out/track5-ood-v2-div-b-2026-11-09T10-48-33-119Z.json`  
**OOD evidence (prior freeze):** `scripts/rag/out/track5-ood-enriched_v2-2026-11-09T10-25-31-355Z.json`  
**Reproduce:** `npm run rag:classify:track5-p5` · `npm run rag:classify:track5-ood`  
**Full report:** [`ASSESSMENT_3_TRACK5_REPORT.md`](./ASSESSMENT_3_TRACK5_REPORT.md)
