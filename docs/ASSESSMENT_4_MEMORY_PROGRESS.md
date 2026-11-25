# Assessment 4 — Memory Layer Progress Tracker

**Intern:** Priya Das  
**Path:** Memory (not Orchestration)  
**Rule:** Update status at the end of every work session.  
**Statuses:** `todo` | `in_progress` | `done` | `blocked`

## Decision stub

- **Chosen:** Memory — continues A3 Path B; fills REQUIRED evidence; lower slip risk than greenfield orchestration.
- **Trade-off:** top-k=5 recall + rolling summary vs dumping full history into context.
- **Cut:** No LangGraph/Temporal hiring DAG in this capstone.
- **Decision Log:** [`ASSESSMENT_4_DECISION_LOG.md`](./ASSESSMENT_4_DECISION_LOG.md)

---

## Checklist (1:1 with A4 evidence)

| ID | Requirement | Evidence | Status |
|----|-------------|----------|--------|
| P0 | Path B `agent_sessions` live + restart hydrate | **Live applied** 2026-11-23 on `munqgybiuqpncxbgfvdp`; RLS on + 4 own-row policies; `path-b-durable-memory.test.ts` 10/10 | done |
| P1 | Episodic + semantic schema + match RPC + RLS | **Live applied** 2026-11-24 on `munqgybiuqpncxbgfvdp`; events + semantic + `match_agent_semantic_memories` + own-row RLS | done |
| P2 | Semantic recall into supervisor | Enrich searchHints + `supervisor.semanticRecall` trace; `a4:recall-trace` side-by-side; tests 10/10 | done |
| P3 | Summarization / compaction | `compaction.ts`; tokens 412→251 (39.1%↓), fidelity 4/4 | done |
| P4 | Governance: PII write, RLS, forget-me | `memory-write-policy.ts`, Settings UI, `forget-agent-memory.ts`, tests | done |
| P5 | Product before/after in README | README Assessment 4 table | done |
| P5b | Decision Log + demo + DCT `assessment-4` | Decision Log + [`ASSESSMENT_4_DEMO_SCRIPT.md`](./ASSESSMENT_4_DEMO_SCRIPT.md); tag/DCT at hand-in | done |

---

## Phase notes

### Phase 0 — Path B apply
- **Applied live:** `supabase/migrations/20261106120000_proposed_0027_agent_sessions.sql` → HireHub (`munqgybiuqpncxbgfvdp`) on 2026-11-23
- Verified: `to_regclass('public.agent_sessions')` = `agent_sessions`; RLS + FORCE RLS; policies select/insert/update/delete (own-row)
- Unit restart/hydrate proof: `npm test -- src/test/path-b-durable-memory.test.ts` → **10 passed**
- Manual UI smoke (optional follow-up): seeker chat → restart `npm run dev` → same conversationId retains skills/prefs

### Phase 1 — Multi-layer schema
- **Applied live** 2026-11-24: `20261123180000_a4_agent_memory_layers.sql`
- `agent_memory_events` — present, RLS + FORCE, 4 own-row policies
- `agent_semantic_memories` — present, RLS + FORCE, 4 own-row policies, HNSW on `embedding_gte`
- `match_agent_semantic_memories` — present (SECURITY INVOKER, `auth.uid()` scoped)

### Phase 2 — Recall
- Module: `src/lib/ai/memory/semantic-memory.ts` (+ discovery enrichment, gte-only embeds)
- Supervisor inject: after PII, before route; merges recall into skills/searchHints/context
- Trace field: `supervisor.semanticRecall`
- Evidence: `npm run a4:recall-trace` → `scripts/rag/out/a4-session1-session2-trace.json`
- Guide: [`ASSESSMENT_4_PHASE2_RECALL.md`](./ASSESSMENT_4_PHASE2_RECALL.md)
- Wiring: seeker + recruiter supervisor paths

### Phase 3 — Compaction
- Rolling `summary` on session payload
- Token before/after: **412 → 251 (39.1%↓)**; fidelity **pass 4/4**

### Phase 4 — Forget-me
- Server action: `forgetMyAgentMemory`
- UI: Settings → Forget agent memory
- Tests: forget clears semantic recall

### Phase 5 — Proof pack
- Eval: `npm run a4:memory-eval` → `scripts/rag/out/a4-memory-eval.json`
- README table: shipped
- Decision Log: shipped
- Demo script: shipped

---

## Session log

| Date | What shipped | Blockers |
|------|--------------|----------|
| 2026-11-23 | Full Memory Layer implementation: schema, recall, compaction, forget-me, eval, README, Decision Log, demo docs | Live Supabase `db push` still needs project link / dashboard apply per DB_APPLY doc |
| 2026-11-23 | **Phase 0 only:** applied Path B `agent_sessions` to production; verified RLS; Path B unit tests green | Episodic/semantic tables not applied in this step (Phase 1) |
| 2026-11-24 | **Phase 1:** applied episodic + semantic + match RPC; verified all 3 tables + RLS + function live | — |
| 2026-11-24 | **Phase 2 hardened:** searchHints from recall, supervisor trace, gte-only embeds, session1→2 trace artifact, recruiter recall | Live UI demo still manual for DCT |
