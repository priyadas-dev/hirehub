# Assessment 3 — Evaluation Report (Phase 8 / Track 4)

**Date:** 2026-11-05  
**Frozen eval set:** `scripts/rag/eval-sets/a3_v1.json` (frozenAt 2026-11-05)  
**Provider:** gte-small → `embedding_gte` (384)  
**Binding:** Phase 0 baseline + engineering rules Stages A–F  

**Honesty note:** Live corpus remains **5,000** rows (Stage A verified). Stages D–E (10k/20k seed+embed) are **implemented but not executed** — require `--confirm-seed-scale` / `--confirm-gte-bulk`. Stage F columns for 10k/20k stay empty until those runs.

---

## 1. A2 frozen baseline (Phase 0)

| Family | Metric | A2 value |
|---|---|---|
| Retrieval (legacy) | Category-hit@k overall | **~72.5%** |
| Retrieval (legacy) | matching / noisy / edge | **77.4% / 63.2% / 16.7%** |
| Classifier (not RAG) | NB accuracy / macro F1 | **~95.3% / ~0.937** |

A2 bank = `EVAL_QUERY_BANK` (56 cases) — category proxy only; no document-level Precision@k.

---

## 2. Stage A inventory (live)

| Field | Value |
|---|---|
| Corpus-only rows | **5000** |
| `embedding_gte` non-null | **5000** |
| Legacy `embedding` non-null | **1015** |
| Baseline keys `synthetic:v1:00000`–`04999` | **Intact** |
| Category balance | ~416–417 per class (12-way) |

Artifact: `scripts/rag/out/stage-A-inventory.json`

---

## 3. Stages B–C (offline)

| Stage | Result |
|---|---|
| B append sample (keys 05000–05099) | **PASS** — disjoint from baseline; no dup keys; balance OK |
| C leakage checklist + freeze `a3_v1` | **PASS** — eval set independent of generator; suspicion protocol documented |

---

## 4. Retrieval metrics — same frozen set `a3_v1` (k=5)

| Scale | Hit@5 | Precision@5* | MRR | nDCG@5 | Category-hit@5 (legacy) | Status |
|---|---:|---:|---:|---:|---:|---|
| **5k** | **0.550** | **0.550** | **0.550** | **0.550** | **0.625** | Measured |
| 10k | — | — | — | — | — | Pending Stage D confirm |
| 20k | — | — | — | — | — | Pending Stage E confirm |

\*Precision/Recall/nDCG currently use **category_proxy** grades (retrieved docs whose category ∈ `relevantCategories`). Not gold `corpus_key` labels unless filled later. Do not equate to A2 category-hit rates (different eval bank).

Suspicion protocol: hit-rate 0.55 **not** > 0.90 → no leakage override.

Artifact: `scripts/rag/out/a3-frozen-5k-*.json`

### Comparison narrative vs A2

| | A2 | A3 @ 5k (`a3_v1`) |
|---|---|---|
| Eval bank | 56 category-proxy queries (lexicon-heavy) | 20 independent paraphrases / noisy / no-hit / answer |
| Headline | Category-hit ~72.5% | Hit@5 0.55; category-hit 0.625 on labelled expectCategory subset |
| Harder set? | Easier lexical overlap with generator titles | More paraphrase + explicit no-hit cases → lower rates expected |
| Faithfulness harness | Absent | Heuristic present (see §5) |

**Do not claim A3 “beats” A2 on category-hit** — sets differ. A3 adds Precision@k / MRR / nDCG scaffolding and a harder frozen bank.

---

## 5. Answer metrics (separate family)

| Case | Faithfulness (heuristic) | Answer relevance (heuristic) |
|---|---:|---:|
| `a3-answer-faith-eng` | 1.00 | 0.11 |

Method: token-overlap faithfulness; query-token coverage for relevance. Not LLM-as-judge.

---

## 6. Agent task-success (Phases 6–7 tools)

| Metric | Value |
|---|---|
| Scenarios | 7 |
| Passed | 7 |
| **Task-success %** | **100%** (offline harness) |

Covers: fairness refuse, PII redact, apply intent, confirm-to-apply (0 inserts), idempotent confirm, recruiter non-owner deny, outreach draft-without-send.

Artifact: `scripts/rag/out/agent-scenarios-*.json`  
Command: `npm run rag:eval:agents`

---

## 7. How to complete 10k / 20k columns

```bash
# Stage D — append 5k→10k (explicit confirm)
npm run rag:scale -- --stage=D --confirm-seed-scale
npm run rag:embed -- --provider=gte --limit=5000 --confirm-gte-bulk
npm run rag:eval:frozen -- --provider=gte --scale-label=10k

# Stage E — append 10k→20k
npm run rag:scale -- --stage=E --confirm-seed-scale
npm run rag:embed -- --provider=gte --limit=10000 --confirm-gte-bulk
npm run rag:eval:frozen -- --provider=gte --scale-label=20k
```

Never run `rag:reset-embeddings` against production for score chasing.

---

## 8. Limitations

1. Live scale stopped at verified 5k pending seed/embed confirm.  
2. Category-proxy Precision@k ≠ document-graded IR labels.  
3. Answer metrics are heuristics.  
4. Agent success is offline unit harness — not live UI E2E.  
5. Recruiter agent still not wired into recruiter workspace UI (Phase 7 gap).
