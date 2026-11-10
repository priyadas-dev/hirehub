# Assessment 3 Track 4B — 20k Corpus Scale

**Generated:** 2026-11-06T05:15:44.760Z
**Live status:** verified_live

## 1. Pipeline (reuse)

- Seed: `scripts/rag/seed-job-corpus.mjs` + Stage D/E in `scripts/rag/scale-corpus-stages.mjs`
- Embed: `scripts/rag/embed-job-corpus.mjs --provider=gte` → `embedding_gte` (384) only
- Eval: frozen `a3_v1` via `scripts/rag/eval-frozen-set.mjs`
- Checkpoints: 5k → 10k (Stage D) → 20k (Stage E); baseline keys preserved

## 2. Corpus / embedding checkpoints

| Scale | Total rows | Unique keys | Embedded gte | Missing gte | Failed (embed run) | Dims | Baseline intact |
|---|---:|---:|---:|---:|---:|---:|---|
| 20k | 20000 | 20000 | 20000 | 0 | n/a | 384 | yes |

## 3. RAG eval at checkpoints (same bank / K / metrics)

| Scale | Hit@5 | Precision@5 | Category-hit | Faithfulness | Answer relevance | Verified |
|---|---:|---:|---:|---:|---:|---|
| 5k | 0.550 | 0.550 | 0.625 | 1.000 | 0.111 | yes |
| 10k | — | — | — | — | — | no |
| 20k | 0.700 | 0.700 | 0.750 | 1.000 | 0.222 | yes |

Unverified checkpoints are left blank — **not invented**.

**Note:** A blank **10k** cell means no frozen eval was captured while the live corpus was exactly at 10k (e.g. corpus already at 20k). Do not backfill invented scores.

## 4. Manual steps (if live scale not completed here)

```bash
# 1) Inventory (verify baseline intact + counts)
npm run rag:scale -- --stage=A
# 2) If rows < 10k: Stage D seed (resumable; skips existing keys)
npm run rag:scale -- --stage=D --dry-run
npm run rag:scale -- --stage=D --confirm-seed-scale
# 3) Embed pending gte only (384-dim embedding_gte; never wipes 768 column)
npm run rag:embed -- --provider=gte --limit=5000 --confirm-gte-bulk --batch-size=16
npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=10k
# 4) If rows < 20k: Stage E seed
npm run rag:scale -- --stage=E --confirm-seed-scale
# 5) Finish remaining gte embeddings (repeat until missingGte=0)
npm run rag:embed -- --provider=gte --limit=10000 --confirm-gte-bulk --batch-size=16
npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=20k
# 6) Refresh comparison + checkpoint report
npm run rag:scale -- --stage=F
npm run rag:checkpoint
```

## 5. Safety

- Upsert on `corpus_key` only; embeddings omitted on seed (never wiped).
- gte writes `embedding_gte` only; never mixes into 768 `embedding`.
- Stage D/E refuse to seed if baseline 5k keys are incomplete.
- Bulk gte embed requires `--confirm-gte-bulk`.
