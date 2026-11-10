# HireHub Assessment 3 — Phase 6 Report

**Phase:** 6 — Guardrails + Supervisor + Discovery Agent  
**Date:** 2026-11-02  
**Approval:** Explicit user approval to start Phase 6  
**Binding docs:** roadmap, engineering rules, baseline, Phase 5 final verification, Phase 6 plan  

**Mutation statement:** No `.env` edits, no migration apply/repair/`db push`, no corpus/embedding reseed, no RLS weaken, no Phase 7 agents, no Resend/HubSpot/webhook deploy, no commit/push.

---

## 1. Understanding

Build a supervised multi-agent foundation on the existing seeker AI Job Assistant: guardrails (validation, PII, low-confidence, fairness **before** rank), discovery over live-recommend + corpus retrieve (never invent jobs), and server-side conversation memory — without rebuilding the assistant UI.

---

## 2. Decision

| Approach | Chosen? | Why |
|---|---|---|
| Replace `/seeker/assistant` UI | No | Evolve pipeline only |
| New DB `agent_sessions` table | No | In-process memory first (roadmap allows); additive DDL needs separate approval |
| Rebuild RAG/embeddings | No | Reuse `retrieveCorpusMatches` / live recommend |
| Wire CRM/email into agents | No | Separate ops track |
| **Supervisor behind `askJobAssistant` + guardrails in `runJobAssistant` + discovery specialist** | **Yes** | Matches roadmap; preserves AuthZ/RLS/JWT live jobs |

### Checklist (A–I summary)
- Rules/roadmap/baseline/Phase 5 verification read  
- Reuse: intent, live-recommend, corpus-retrieve, skill-match, job-assistant  
- No schema apply; no secrets; fairness before rank; seeker role gate preserved  

---

## 3. Implementation

### New modules
| Path | Role |
|---|---|
| `src/lib/ai/guardrails/pii.ts` | Email / phone / labeled ID redaction |
| `src/lib/ai/guardrails/fairness.ts` | Discriminatory filter detect → refuse or neutralize **before** rank |
| `src/lib/ai/guardrails/confidence.ts` | Low-confidence assessment / refusal helpers |
| `src/lib/ai/guardrails/validation.ts` | Structured supervised-turn validation + payload builder |
| `src/lib/ai/guardrails/index.ts` | Barrel exports |
| `src/lib/ai/memory/server-memory.ts` | Server Map keyed by `userId` + `conversationId` |
| `src/lib/ai/agents/discovery.ts` | Live jobs + optional corpus; `inventedJobs: false` invariant |
| `src/lib/ai/agents/supervisor.ts` | Guardrails → discovery \| legacy; memory write |
| `docs/ASSESSMENT_3_PHASE_6_PLAN.md` | Implementation plan |
| `src/test/phase6-agents.test.ts` | Fairness / PII / memory / discovery / supervisor tests |

### Evolved (not rebuilt)
| Path | Change |
|---|---|
| `src/lib/ai/ask-job-assistant.ts` | Routes through `runSupervisor` (legacy = existing `runJobAssistant`) |
| `src/lib/ai/job-assistant.ts` | PII redact + fairness refuse before ranking (defense in depth) |
| `docs/ASSESSMENT_3_IMPLEMENTATION_ROADMAP.md` | Phase 6 acceptance checked |
| `docs/ASSESSMENT_3_ENGINEERING_RULES.md` | Phase 6 note + history pending clarification |

### Flow
```text
Seeker UI → askJobAssistant (JWT + profiles.role)
  → runSupervisor
       → PII redact + fairness gate
       → discovery (job search / skill rank) OR runJobAssistant legacy
       → server memory append (userId + conversationId)
```

Live jobs still use caller JWT (RLS). Corpus still uses server-only service role via existing retrieve path.

---

## 4. Acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| Supervisor → discovery path works | **PASS** | `phase6-agents.test.ts` supervisor discovery route; live citations from deps only |
| Guardrails invoked | **PASS** | PII + fairness + validation + confidence modules; wired in supervisor + `runJobAssistant` |
| Biased prompt test passes | **PASS** | Fairness refuse; `listLiveJobs` not called |
| Shared memory readable across turns | **PASS** | `createServerAgentMemory` append/get/context tests |

**Definition of Done:** Met for code/unit evidence.

---

## 5. Tests

```text
vitest: phase6-agents, job-assistant, assistant-intent(+routing),
        live-recommend, skill-match, corpus-rag, assistant-live-store, assistant-history
→ 9 files, 87 passed
```

---

## 6. Risks / limitations / gaps

1. **Server memory is process-local** — resets on server restart; not multi-instance durable. Additive `agent_sessions` table would need separate approval.  
2. **Discovery answers for job search are template-based** in the supervisor path (not full Gemini prose) — intentional for grounded cards; legacy LLM path still used for non-discovery intents.  
3. **Fairness patterns are heuristic** — not a legal compliance engine; extend patterns as needed.  
4. **PII redaction is conservative** — may miss uncommon formats.  
5. **Live browser demo** of supervised turns **UNVERIFIED** this session.  
6. **Resend / HubSpot / resend-webhook** still separate blockers (not Phase 6).  
7. **Migration history markers** for 0020/0021/0022 still pending separate approval.  
8. Phase 7 (application + recruiter agents) **not started**.

---

## 7. Changed files (summary)

**Added:** guardrails/*, memory/server-memory.ts, agents/discovery.ts, agents/supervisor.ts, phase6-agents.test.ts, PHASE_6_PLAN.md, PHASE_6_REPORT.md  

**Modified:** ask-job-assistant.ts, job-assistant.ts, IMPLEMENTATION_ROADMAP.md, ENGINEERING_RULES.md  

---

## 8. Next step

**STOP.** Phase 6 complete for approved scope.  
Await explicit approval before **Phase 7** (application agent + recruiter agent).
