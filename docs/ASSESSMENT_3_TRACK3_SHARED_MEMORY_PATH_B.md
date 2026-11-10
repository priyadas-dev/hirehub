# Assessment 3 Track 3 — Shared memory Path B (durable)

**Date:** 2026-11-06  
**Mode:** Path B — Supabase-backed `agent_sessions` behind the existing memory API  
**Depends on:** Path A ([`ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_A.md`](./ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_A.md))

---

## 1. Goal

Keep Supervisor → Discovery / Application shared memory **compatible**, and make it:

- Survive Node process restarts  
- Work across multiple server instances  
- Enforce **own-row** access via JWT + RLS  
- Preserve PII redaction and payload limits  

---

## 2. Schema (proposed — not auto-applied)

| Artifact | Path |
|---|---|
| Drizzle proposed SQL | `drizzle/migrations/PROPOSED_0027_agent_sessions.sql` |
| Supabase mirror | `supabase/migrations/20261106120000_proposed_0027_agent_sessions.sql` |

Table `public.agent_sessions`:

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `user_id` | FK → `profiles.id`, must equal `auth.uid()` |
| `conversation_id` | text 1–128, unique with `user_id` |
| `memory` | jsonb object, ~64KB cap, redacted app payload |
| `created_at` / `updated_at` | timestamptz |

RLS: authenticated SELECT/INSERT/UPDATE/DELETE **only** when `user_id = auth.uid()`.  
`anon` revoked. No browser service-role.

**Do not apply to production until you explicitly approve.** Until applied, the app **falls back** to Path A in-process memory when the table is missing.

---

## 3. Application architecture

| Piece | Role |
|---|---|
| `server-memory.ts` | Sync Map API unchanged for Supervisor / specialists; dirty + durable meta |
| `agent-session-payload.ts` | Validate / redact / size-clamp / merge JSONB |
| `agent-session-repository.ts` | JWT load/save + optimistic `updated_at` concurrency |
| `durable-agent-memory.ts` | `hydrate` → run → `persist`; fallback on DB errors |
| `ask-job-assistant.ts` | Per-request **isolated** memory + `withDurableAgentMemory` (JWT hydrate/persist) |

**user_id** always comes from `requireSupabaseAuth` / `context.userId` — never trusted from the chat body alone.  
**conversation_id** may come from the client but is namespaced under that JWT user.

### Concurrency

- Persist uses `UPDATE … WHERE updated_at = expected`.  
- On mismatch: reload, **merge** payloads (skills/jobs/prefs/turns), retry once.  
- Avoids clobbering a newer row with stale cache.

### Fallback

If `agent_sessions` is missing / RLS / network fails:

- Hydrate returns `fallback: true`  
- Supervisor continues with process-local Map (Path A)  
- No private DB errors are returned to the client  

---

## 4. Tests

`src/test/path-b-durable-memory.test.ts`

- Payload PII re-redaction  
- User isolation on keys  
- Stale-write merge  
- Restart simulation: clear Map → hydrate restores skills/jobs  
- Missing-relation fallback  

Existing Path A tests in `phase6-shared-memory.test.ts` remain valid for the sync API.

---

## 5. How to finish on a live project

1. **Approve** applying `PROPOSED_0027_agent_sessions.sql` (staging first if possible).  
2. Apply via your usual Supabase migration path.  
3. Confirm RLS: user A cannot `SELECT` user B rows.  
4. Smoke: seeker chat → restart `npm run dev` → same conversation still has skills/prefs (after hydrate).  
5. Keep service-role out of the browser; do not weaken RLS.

---

## 6. Status

| Item | Status |
|---|---|
| Proposed migration + RLS | **In repo** (not applied until you say so) |
| Adapter + seeker wiring | **Implemented** |
| Unit tests | **Implemented** |
| Live DB apply / restart proof on hosted project | **Pending your migration approval** |

---

## Changelog

| Date | Change |
|---|---|
| 2026-11-06 | Path B adapter, proposed `agent_sessions` SQL, unit tests, seeker hydrate/persist wiring. |
