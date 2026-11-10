# HireHub Assessment 3 — Phase 8 Report

**Phase:** 8 — RAG Stages A→F (scale harness + eval)  
**Date:** 2026-11-05  
**Approval:** User requested start Phase 8  
**Binding docs:** roadmap, engineering rules, Phase 0 baseline, Phase 7 report, Phase 8 plan  

**Mutation statement:** No `.env` edits, no migration apply/repair/`db push`, no embedding reset, no baseline 5k deletes, no Phase 9. **No live 10k/20k seed or bulk embed** (confirm flags required; not passed this session). Stage A inventory + frozen 5k eval were read-only / retrieve-only against existing corpus.

---

## 1. Understanding

Ship Track 4 evidence: preserve 5k, freeze an independent eval set, measure retrieval + answer metrics vs A2 narrative, report agent task-success %, and provide a safe append-only path to ≥20k — without wiping vectors or mixing embedding dimensions.

---

## 2. Decision

| Approach | Chosen? | Why |
|---|---|---|
| Auto-seed 20k on phase start | No | Roadmap: explicit confirm before seed/embed |
| Wipe / re-embed baseline | No | Engineering rules forbid |
| Replace A2 bank only | No | Freeze new `a3_v1` + keep A2 as comparator |
| **Harness + freeze + measure @5k + dry-run B–F + agent %** | **Yes** | Completes code DoD; honest about live scale |

---

## 3. Implementation

### New
| Path | Role |
|---|---|
| `src/lib/ai/rag-metrics.ts` | Hit@k, P@k, R@k, MRR, nDCG, faithfulness / answer-relevance |
| `src/lib/ai/corpus-quality.ts` | Dup / balance / leakage sample checks |
| `src/lib/ai/agents/agent-scenarios.ts` | Offline Phase 6–7 task scenarios |
| `scripts/rag/eval-sets/a3_v1.json` | Frozen independent eval set |
| `scripts/rag/scale-corpus-stages.mjs` | Stages A–F CLI |
| `scripts/rag/eval-frozen-set.mjs` | Frozen-set metrics runner |
| `scripts/rag/eval-agent-scenarios.mjs` | Agent success % CLI |
| `src/test/phase8-rag.test.ts` | Unit evidence |
| `docs/assessment-3-evaluation-report.md` | A2 vs A3 side-by-side |
| `docs/ASSESSMENT_3_PHASE_8_PLAN.md` / `PHASE_8_REPORT.md` | Plan + report |

### Evolved
| Path | Change |
|---|---|
| `package.json` | `rag:eval:frozen`, `rag:eval:agents`, `rag:scale` |
| Roadmap / engineering rules | Phase 8 status |

### Stage outcomes
| Stage | Result |
|---|---|
| A | **PASS** — 5000 corpus / 5000 gte / baseline intact |
| B | **PASS** — append sample quality offline |
| C | **PASS** — leakage check + `a3_v1` frozen |
| D | **READY** — dry-run only (no `--confirm-seed-scale`) |
| E | **READY** — dry-run only |
| F | **PARTIAL** — 5k column filled; 10k/20k pending D/E |

---

## 4. Acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| ≥20k corpus-only rows with gte for new rows | **BLOCKED** (harness ready) | Needs confirm seed+embed; live still 5k |
| Same frozen eval at 5k/10k/20k | **PARTIAL** | `a3_v1` frozen; measured @5k only |
| Precision@k / hit-rate / faithfulness vs A2 | **PASS** (scaffold + 5k numbers) | Eval report §4–5 |
| Agent task-success % | **PASS** | 100% (7/7) offline |
| No baseline destruction | **PASS** | Stage A intact; no reset run |

**Definition of Done (code):** Met with honest BLOCKED on live ≥20k until confirm.  
**Definition of Done (full Track 4 live scale):** Pending user confirm for D/E.

---

## 5. Tests / commands

```text
vitest: phase8-rag.test.ts → 7 passed
npm run rag:eval:agents → 7/7 PASS
npm run rag:scale -- --stage=A|B|C|F
npm run rag:eval:frozen -- --provider=gte --scale-label=5k
→ hitRate=0.550 precision@5=0.550 categoryHit=0.625
```

---

## 6. Risks / gaps

1. Live 10k/20k not written yet.  
2. Precision@k uses category proxy until gold `relevantCorpusKeys` filled.  
3. Answer metrics are heuristics.  
4. Phase 7 recruiter UI gap unchanged.  

---

## 7. Next step

**STOP.** Phase 8 harness complete for approved code scope.  

To finish live scale columns, explicitly approve:

`npm run rag:scale -- --stage=D --confirm-seed-scale` (then embed + eval; then Stage E).

Await approval before **Phase 9** (classifier F1 report).
