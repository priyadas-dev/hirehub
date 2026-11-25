# Assessment 4 — Phase 2: Semantic recall (Amol checklist)

## What Phase 2 is (your job this phase)

Make HireHub **stop re-asking** what it already knows by:

1. **Writing** facts through the Supervisor only (skills, location, target role, recruiter rubric)
2. **Recalling** top-k=5 by similarity + recency each turn
3. **Injecting** them into Supervisor → Discovery / legacy context
4. **Proving** Session1 → Session2 + cold vs warm side-by-side

## Amol requirement map

| Brief line | How we meet it |
|------------|----------------|
| Retrieve most relevant memories by similarity + recency | `match_agent_semantic_memories` + gte-small 384-d |
| Inject into supervisor context | `supervisor.ts` after PII, before route |
| Seeker target role / recruiter rubric | `fact-extract.ts` + recruiter persist/recall |
| Evidence: session1 fact → session2 recall | `npm run a4:recall-trace` + unit tests |
| Evidence: side-by-side vs cold start | Same trace + tests (search query + answer change) |

## What you should do (demo / evidence)

1. Ensure `EMBEDDING_PROVIDER=gte` in server env (memory vectors are 384-d only).
2. Run:
   ```sh
   npm run a4:recall-trace
   npm test -- src/test/a4-memory-layer.test.ts
   ```
3. Live UI smoke:
   - Session1: “I want React frontend jobs in Dhaka”
   - New chat / next day: “Find jobs for me”
   - Confirm it searches with remembered prefs (not re-asking role/city)
4. Keep `scripts/rag/out/a4-session1-session2-trace.json` for DCT write-up

## Gaps closed in this Phase 2 pass

| Gap | Fix |
|-----|-----|
| Recall only in conversationContext text; Discovery `searchHints` stayed cold | `recalledMemoriesToDiscoveryEnrichment` merges into skills + searchHints |
| No supervisor observability for demo | `supervisor.semanticRecall` `{ count, kinds, preview }` |
| Fake/gemini 768 fallback could poison pgvector space | Memory embeds **gte-only**; wrong dim → skip write/recall |
| Weak Amol “trace” artifact | `a4:recall-trace` JSON side-by-side |
| Recruiter only wrote, did not recall into help answers | Recruiter path recalls + injects into legacy context |

## Remaining (not Phase 2 blockers)

- Live JWT end-to-end UI recording for DCT (you run once after deploy)
- Phase 3–5 already coded; keep using their eval/README numbers at submit time
