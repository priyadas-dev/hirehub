# Assessment 3 — Phase 8 Implementation Plan

**Approved:** user requested start Phase 8  
**Scope:** RAG Stages A→F harness, frozen labelled eval set, retrieval + answer metrics, agent task-success eval, A2 vs A3 report  
**Non-goals:** Phase 9 classifier report polish, Phase 10 Sentry, wipe/reset embeddings, `.env` edits, migration apply

## Reuse
- `corpus-generate` / `seed-job-corpus` / `embed-job-corpus` (omit embeddings on upsert; gte pending-only)
- `corpus-retrieve` + `corpus-rerank` (hybrid)
- Phase 0 baseline A2 metrics + eval protocol
- Phase 6–7 agents for scenario harness

## New
| Path | Role |
|---|---|
| `src/lib/ai/rag-metrics.ts` | Hit@k, Precision@k, Recall@k, MRR, nDCG@k, faithfulness / answer-relevance heuristics |
| `src/lib/ai/corpus-quality.ts` | Dup / diversity / leakage sample checks (Stage B–C) |
| `src/lib/ai/agents/agent-scenarios.ts` | Offline Phase 6–7 task scenarios + success % |
| `scripts/rag/eval-sets/a3_v1.json` | Frozen independent eval set (before Stage D) |
| `scripts/rag/scale-corpus-stages.mjs` | Stages A–F CLI (dry-run default; live seed/embed need confirm flags) |
| `scripts/rag/eval-frozen-set.mjs` | Run frozen set → retrieval + answer metric JSON |
| `scripts/rag/eval-agent-scenarios.mjs` | Agent task-success report |
| `docs/assessment-3-evaluation-report.md` | Side-by-side A2 vs A3 |
| `src/test/phase8-rag.test.ts` | Metrics + leakage + agent scenario unit tests |

## Live DB policy
- Stage A inventory: read-only OK  
- Stages D–E seed/embed: **require** `--confirm-seed-scale` / `--confirm-gte-bulk` — not run silently  
- Never delete baseline `synthetic:v1:00000`–`04999`; append only  

## Acceptance mapping
1. Harness + frozen set + Stage F table structure  
2. Offline metrics + agent % green in unit tests  
3. Live ≥20k only after confirmed seed/embed (report status honestly)
