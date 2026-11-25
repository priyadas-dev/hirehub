# Assessment 4 — Apply memory migrations (live Supabase)

Plan approval covers applying these schemas. Do **not** weaken RLS.

## Migrations

1. Path B (also ensured by A4 file):  
   `supabase/migrations/20261106120000_proposed_0027_agent_sessions.sql`
2. A4 layers (sessions ensure + episodic + semantic + match RPC):  
   `supabase/migrations/20261123180000_a4_agent_memory_layers.sql`

## How to apply

### Phase 0 status (Path B only) — DONE 2026-11-23

Applied to HireHub production (`munqgybiuqpncxbgfvdp`):

```sh
npx supabase db query --remote=munqgybiuqpncxbgfvdp --yes --file supabase/migrations/20261106120000_proposed_0027_agent_sessions.sql
```

Verified: table present, RLS + FORCE RLS, own-row select/insert/update/delete policies.

### Phase 1 (episodic + semantic) — DONE 2026-11-24

Applied to HireHub production (`munqgybiuqpncxbgfvdp`):

```sh
npx supabase db query --remote=munqgybiuqpncxbgfvdp --yes --file supabase/migrations/20261123180000_a4_agent_memory_layers.sql
```

Verified: `agent_memory_events`, `agent_semantic_memories`, `match_agent_semantic_memories`, RLS + FORCE on all memory tables.

## Smoke after apply

1. Sign in as seeker → `/seeker/assistant`
2. Say: “I want React frontend jobs in Dhaka”
3. Restart `npm run dev`
4. Same conversation: “Find jobs for me” should still use skills/location (Path B hydrate)
5. Settings → **Forget agent memory** → next turn should cold-start

## Evidence

- Unit: `npm test -- src/test/a4-memory-layer.test.ts src/test/path-b-durable-memory.test.ts`
- Eval: `npm run a4:memory-eval` → `scripts/rag/out/a4-memory-eval.json`
