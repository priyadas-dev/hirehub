# Assessment 3 Track 3 — Guardrails (confidence & related)

**Scope:** Multi-agent Supervisor + Discovery / Application / Recruiter specialists  
**Updated:** Task 3C (low-confidence boundary fix)  
**Important:** Discovery “confidence” scores are **heuristic grounding summaries**, not calibrated probabilities, not retrieval similarity, and not model certainty.

---

## 1. How confidence is determined (Discovery only)

Module: `src/lib/ai/guardrails/confidence.ts`

| Signal | Effect on heuristic score |
|---|---|
| Baseline (ungrounded) | Starts at **0.2** (below the refuse floor) |
| ≥1 live approved job | +0.55 |
| ≥1 corpus match | +0.25 |
| Job intent + 0 live + 0 corpus | Reason `empty_job_search`; score capped ≤ 0.3 |
| Non-job intent + empty grounding | Reason `empty_grounding`; score capped ≤ 0.25 |

`confident` is true when live jobs exist, or corpus grounding pushes the heuristic above the refuse floor.

**Not claimed:** These numbers are calibrated against human labels or measured ECE/Brier scores. They exist so empty / under-grounded Discovery turns do not look like successful recommendations.

### Application & Recruiter

These specialists **do not** use `assessDiscoveryConfidence` / numeric floors.

| Agent | Gate |
|---|---|
| Application | Required `jobId`, JWT seeker id, **confirm-to-apply** (`confirm: true` before insert) |
| Recruiter | JWT + DB ownership (`job.recruiter_id` / CRM owner), confirm for shortlist, `confirmSend` for send |

---

## 2. Refusal vs clarification (Discovery)

Decision helper: `decideDiscoveryConfidence` → `clarify` | `refuse` | `allow`.

| Situation | Action | Result code | User-facing intent |
|---|---|---|---|
| Vague empty search (e.g. “find jobs” with no leftover filters) | **Clarify** | `needs_clarification` | Ask for role / skill / location |
| Specific empty search (filters present, 0 live + 0 corpus) | **Refuse** | `low_confidence` | Insufficient grounded HireHub context |
| Live jobs (and/or sufficient corpus) | **Allow** | `ok: true` | Normal Discovery cards / corpus context |
| Discriminatory hiring filter | Fairness refuse (before rank) | `fairness_refuse` | Block ranking |

Supervisor maps:

- `low_confidence` → model `guardrail-confidence`, `insufficientContext: true`, no live cards  
- `needs_clarification` → model `guardrail-clarify`, same empty-card posture  

No application insert and no outreach email are triggered on these paths.

---

## 3. Why rules are agent-specific

| Concern | Discovery | Application | Recruiter |
|---|---|---|---|
| Empty / weak grounding | Heuristic score + clarify/refuse | N/A (needs job id) | N/A |
| Ownership | Live jobs via caller JWT / RLS | Seeker id from auth | Job/CRM owner from DB |
| Side effects | None (read-only search) | Insert only after confirm | Shortlist/update after confirm; send only if `confirmSend` |
| Fairness / PII | Shared Supervisor / Discovery gates | Shared on seeker turns | Recruiter path still uses ownership + draft-only defaults |

A single global numeric threshold across all agents would be wrong: Application/Recruiter failures are **authorization and confirmation** failures, not retrieval-confidence failures.

---

## 4. Root cause fixed in Task 3C (0.35 boundary)

**Previous behavior**

1. `assessDiscoveryConfidence` started at **score = 0.35**.  
2. Empty job search never incremented the score → plateau at exactly **0.35**.  
3. `shouldRefuseLowConfidence` used **`score < 0.35`**.  
4. Therefore empty search did **not** refuse, while still reporting a non-confident assessment — the guardrail missed its primary case.

**Fix**

- Ungrounded baseline starts **below** the refuse floor.  
- Empty job search is an explicit reason (`empty_job_search`) that always refuses when not clarifying.  
- Refuse predicate is **inclusive** of the historical floor (`score <= 0.35`) so a plateau at 0.35 cannot slip through.  
- Vague empty queries prefer **clarification** instead of a hard refuse.

---

## 5. Known limitations

1. Heuristic scores are **not** calibrated; do not report them as probabilities in mentor demos without that caveat.  
2. Vague-query detection strips common scaffolding; unusual phrasings may refuse instead of clarify (safe bias).  
3. Fairness and PII patterns remain heuristic, not a compliance engine.  
4. Corpus-only hits can still “allow” with an honest non-vacancy message — that is intentional grounding, not live job invention.  
5. Process-local server memory and live E2E of every guardrail path may still be environment-dependent.

### Examples

| Query / situation | Expected |
|---|---|
| “Find React jobs in Dhaka” + live hits | Allow Discovery |
| “Find obscure quantum flute jobs in Atlantis” + empty | `low_confidence` refuse |
| “Find jobs” + empty | `needs_clarification` |
| “Only hire men for engineering” | Fairness refuse (no live search) |
| Apply without job id | Clarification; **0** inserts |
| Recruiter shortlist on someone else’s job | `forbidden`; no status write |
| Outreach with `confirmSend: false` | Draft only; no send |

---

## 6. Tests

- `src/test/guardrail-confidence.test.ts` — boundary, empty, clarify, high-confidence, Application/Recruiter gates, fairness/PII, Supervisor routing  
- Existing Phase 6/7/8 + Track 4 scenario regressions (`discovery-unsuccessful-empty` now expects low-confidence refuse)
