# Assessment 3 Track 4A — Agent & RAG Evaluation

**Generated:** 2026-11-06T05:15:29.345Z

## 1. Methodology

- **Agent task-success:** labelled offline scenarios in `src/lib/ai/agents/agent-scenarios.ts` (deterministic mocks; no real apply/email/DB).
- **RAG retrieval:** frozen set `scripts/rag/eval-sets/a3_v1.json` via `scripts/rag/eval-frozen-set.mjs` → Hit@k, Precision@k, MRR, nDCG, category-hit.
- **RAG answer quality:** heuristic faithfulness + answer relevance (`src/lib/ai/rag-metrics.ts`) — **automated**, not LLM-judged.
- **Assessment 2 baseline:** `scripts/rag/out/eval-report.json` (category-hit on 56-query bank).
- Generated JSON/MD under `scripts/rag/out/` (gitignored); fixtures stay under `scripts/rag/eval-sets/`.

## 2. Agent task-success

| Metric | Value |
|---|---:|
| Scenarios | 18 |
| Passed | 18 |
| Failed | 0 |
| **Task-success rate** | **100.0%** |

### By agent family

| Agent | Total | Passed | Failed | Rate |
|---|---:|---:|---:|---:|
| application | 6 | 6 | 0 | 100.0% |
| discovery | 3 | 3 | 0 | 100.0% |
| guardrail | 2 | 2 | 0 | 100.0% |
| recruiter | 2 | 2 | 0 | 100.0% |
| supervisor | 5 | 5 | 0 | 100.0% |

### Scenario detail

| ID | Agent | Expected route | Result | Detail |
|---|---|---|---|---|
| `fairness-refuse` | guardrail | fairness_refuse | PASS | blocked |
| `pii-redact` | guardrail | — | PASS | redacted |
| `discovery-success` | discovery | discovery | PASS | jobs=1 |
| `discovery-unsuccessful-empty` | discovery | discovery | PASS | empty grounded |
| `discovery-guardrail-refuse` | discovery | fairness_refuse | PASS | fairness_refuse |
| `supervisor-route-discovery` | supervisor | discovery | PASS | discovery |
| `apply-intent` | application | application | PASS | detected |
| `apply-needs-confirm` | application | application | PASS | 0 inserts |
| `apply-confirm-idempotent` | application | application | PASS | 1 row |
| `apply-ambiguous-missing-job` | application | application | PASS | clarification |
| `save-job-idempotent` | application | application | PASS | saved+already_saved |
| `supervisor-route-save` | supervisor | application | PASS | saveOutcome |
| `check-status-ownership` | application | application | PASS | isolated |
| `supervisor-route-status` | supervisor | application | PASS | applicationStatuses |
| `recruiter-non-owner` | recruiter | recruiter | PASS | forbidden |
| `outreach-draft-only` | recruiter | recruiter | PASS | draft only |
| `supervisor-route-recruiter` | supervisor | recruiter | PASS | recruiter |
| `supervisor-fairness-refuse` | supervisor | fairness_refuse | PASS | refused |

## 3. RAG metrics (Assessment 3 frozen set)

**Artifact:** `scripts/rag/out/a3-frozen-5k-2026-11-05T09-06-20-714Z.json`

| Field | Value |
|---|---|
| Eval set | a3_v1 |
| Scale label | 5k |
| Provider | gte |
| K | 5 |
| Cases | 20 |
| Hit@K | 0.550 |
| Precision@K | 0.550 |
| MRR | 0.550 |
| nDCG@K | 0.550 |
| Category-hit@K (legacy) | 0.625 |
| Suspicion (>0.90 hit) | no |

### Answer metrics (heuristic — not LLM judge)

| Case | Faithfulness | Answer relevance | Methods |
|---|---:|---:|---|
| `a3-answer-faith-eng` | 1.000 | 0.111 | token_overlap_heuristic / query_token_coverage |

## 4. Assessment 2 vs Assessment 3 (comparable where evidence exists)

| Dimension | Assessment 2 | Assessment 3 @ frozen a3_v1 |
|---|---|---|
| Query bank | EVAL_QUERY_BANK (56) category-proxy | a3_v1 (20) paraphrase/noisy/no-hit |
| K | 5 | 5 |
| Hybrid FTS | true | hybrid retrieve (live) |
| Category-hit@K | 0.745 | 0.625 |
| Clean / noisy category-hit | 0.750 / 0.688 | n/a (different bank) |
| Hit@K / Precision@K | not reported as IR Hit/P@k in A2 artifact | 0.550 / 0.550 |
| Faithfulness harness | absent | heuristic present |

### Comparison notes

- Assessment 2 headline metric is category-hit@k on EVAL_QUERY_BANK (56 cases).
- Assessment 3 frozen set a3_v1 uses independent paraphrases/noisy/no-hit/answer probes (20 cases).
- A3 Precision@k / Hit@k use category_proxy grades unless relevantCorpusKeys are filled — not identical to A2 category-hit.
- Do not claim A3 “beats” A2 on category-hit: query banks and grading differ.
- Faithfulness and answer relevance are automated token-overlap heuristics — not LLM-as-judge.

## 4b. Scale checkpoints (5k / 10k / 20k) — measured only

| Scale | Hit@5 | Precision@5 | Category-hit | Faithfulness | Answer relevance | Verified |
|---|---:|---:|---:|---:|---:|---|
| 5k | 0.550 | 0.550 | 0.625 | 1.000 | 0.111 | yes |
| 10k | — | — | — | — | — | no |
| 20k | 0.700 | 0.700 | 0.750 | 1.000 | 0.222 | yes |

Blank cells mean **not measured yet** (Task 4B). Values are never invented.

## 5. Reproduce

```bash
npm run rag:eval:agents
npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=5k
npm run rag:eval:track4a
npm run rag:checkpoint
npm run rag:eval -- --provider=gte   # Assessment 2 bank (optional refresh)
```

## 6. Limitations & remaining Task 4B

- Agent harness is offline with deterministic mocks — not live E2E against production DB.
- RAG frozen metrics require live Supabase corpus + embeddings; Track 4A reuses last measured artifact when present.
- 10k mid-checkpoint eval may be blank if the corpus was already past 10k before that eval ran — never invent that cell.
- Category-proxy Precision@k is weaker than gold corpus_key labels.
- Recruiter UI is out of scope for Track 4A.
- **Task 4B:** expand/evaluate at 20,000 synthetic postings (Stage E) with confirm flags — not part of Track 4A.
