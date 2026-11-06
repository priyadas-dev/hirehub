# Assessment 3 Track 3 — Shared memory Path A verification

**Date:** 2026-11-06  
**Mode:** Path A (prove existing in-process memory; **no** DB table / migration / RLS changes)  
**Scope:** Skills, preferences, and recent jobs shared across Supervisor → Discovery / Application in one conversation; honest restart limitation.

---

## 1. What “shared memory” is today

| Item | Detail |
|---|---|
| Implementation | `src/lib/ai/memory/server-memory.ts` |
| Storage | Process-local `Map` keyed by `userId::conversationId` |
| Written by | Supervisor on seeker turns (append turns, merge skills/preferences, remember recent jobs) |
| Read by | Discovery (`getDiscoveryBundle` → skills, searchHints, conversationContext); Application (`getApplicationBundle` → recentJobs only) |
| PII | `appendTurn` re-redacts text before store |

This **already satisfies** the Assessment 3 brief’s “shared memory” requirement for multi-agent orchestration. Path A does **not** add durability.

---

## 2. UI verification (same conversation)

**Script:** `scripts/path-a-shared-memory-ui-verify.mjs`  
**App:** `http://127.0.0.1:8080` (`npm run dev`)  
**Account:** local seeker credentials from `.env` (not stored in this doc)  
**Machine results:** `docs/path-a-shared-memory-ui-results.json`  
**Screenshot:** `docs/path-a-shared-memory-ui.png`

| Check | Result |
|---|---|
| Seeker login | **Pass** |
| Open `/seeker/assistant` | **Pass** |
| Seed skills + Dhaka preference (“I am strongest in React and TypeScript…”) | **Pass** |
| Follow-up Discovery (“Find developer jobs for me”) in same conversation | **Pass** |
| Application propose-only (“Please apply to the first job…”) — Mode A, no confirm insert | **Pass** |
| Same-conversation confirm UI surface | **Pass** |

**Interpretation:** Within one live conversation, Supervisor keeps context; Discovery follow-up runs in that conversation; Application propose path can use prior job context without confirming an insert.

Supporting automated evidence (no UI): `src/test/phase6-shared-memory.test.ts` — Supervisor stores skills/hints/recentJobs; follow-up Discovery call is enriched; Application resolve “first job” from memory with `confirm: false`.

---

## 3. Server-restart limitation (honest)

| Fact | Evidence |
|---|---|
| Memory lives only in the Node process | Module-level `Map` in `server-memory.ts` |
| All `createServerAgentMemory()` calls in one process share that **same** Map | Source: single `const store = new Map(...)` at module scope |
| Restart / process recycle → empty memory | Clearing the Map (or exiting Node) drops all conversations |
| Unit proof of restart semantics | Test: *“process-local module Map is cleared on restart semantics (_resetForTests)”* in `phase6-shared-memory.test.ts` |

**What this means for demos:** Soft context (skills / Dhaka / recent job cards) works **during** a running server session. After `npm run dev` restart (or deploy recycle), agents start with empty server memory for that conversation until the user talks again. Creating another memory factory object **without** restart does **not** isolate data — only process death / explicit reset does.

**What we are not claiming:** Multi-instance sticky memory, durable `agent_sessions` rows, or cross-device persistence. That would be **Path B** and needs an approved migration.

---

## 4. What Path A did *not* change

- No new tables / migrations / RLS  
- No redesign of `createServerAgentMemory` API  
- No confirm-apply / shortlist writes for this verification  
- No commit / push  

---

## 5. Status after Path A

| Item | Status |
|---|---|
| Shared memory between Supervisor / Discovery / Application (same conversation) | **Verified** (UI + unit) |
| Durable across restart | **Still partial / deferred** (Path B optional) |
| Track 3 “shared memory” brief requirement | **Met** with documented limitation |

---

## Changelog

| Date | Change |
|---|---|
| 2026-11-06 | Path A UI script + results; restart limitation documented; unit test for new-instance emptiness. |
