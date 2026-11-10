# Assessment 3 Track 3 — Status (done vs pending)

**Track:** Multi-agent orchestration + guardrails (**20 pts**)  
**Compared against:** Assessment 3 requirements brief (Track 3 + Hard Problems 1, 2, 3, 5)  
**Codebase reviewed:** HireHub (Supervisor, Discovery, Application, Recruiter, guardrails, UIs, tests, docs)  
**Date:** 2026-11-09 (status refreshed for Task 3G; Track 5 cross-link updated)  
**Related human guide:** [`ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md`](./ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md)  
**Final evidence report:** [`ASSESSMENT_3_TRACK3_FINAL_REPORT.md`](./ASSESSMENT_3_TRACK3_FINAL_REPORT.md)

> Living note: update this file when Track 3 completion status changes (e.g. Mode B finished, live resume JWT matrix recorded). Do **not** mark Mode B / live Storage denial / Path B DB apply as done until evidence exists.

---

## Verdict

Against the Assessment 3 brief and the current codebase, **Track 3 multi-agent + guardrails is largely done in product, code, and tests**.

What’s left is mostly **proof polish** (browser E2E, live resume JWT matrix, durable memory)—**not** missing agents.

| Estimate | Meaning |
|---|---|
| **~85–90%** | Track 3 **feature** work |
| **~70–80%** | “Mentor-ready **proof**” if they insist on full live browser + live Storage denial demos |

---

## Brief requirement vs codebase

| Brief requirement | Status | Notes |
|---|---|---|
| Supervisor / router | **Done** | Routes + guardrails first |
| Discovery agent (recommend jobs, no invent) | **Done** | Live approved jobs + corpus |
| Application agent (apply / save / status) | **Done** | Real JWT actions |
| Recruiter agent (shortlist + draft outreach) | **Done** | + `/recruiter/agent` UI |
| Shared memory | **Done for Track 3** (Path B code ready; DB apply pending) | Path A verified; Path B adapter + proposed `agent_sessions` — see `ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_B.md` |
| Validation | **Done** | |
| PII redaction | **Done** | |
| Low-confidence refusal / clarify | **Done** (Task 3C) | |
| Structured outputs | **Done enough** | Typed agent/supervisor payloads |
| Fairness guardrail (Hard Problem 3) | **Done** | Refuse before rank + tests |
| Application takes **real** actions (Hard Problem 5) | **Done** | Confirm → `applyToJob` |
| Idempotent apply (Hard Problem 1) | **Done** | Live UNIQUE verified; concurrent unit test (mock race) |
| Secure resume ACL (Hard Problem 2) | **Partial** | Private bucket + RLS + unit mirror; **live JWT denial matrix not recorded** |
| Seeker UI through Supervisor | **Done** | `/seeker/assistant` |
| Recruiter agent UI | **Done** | Task 3B |
| Documented guardrails | **Done** | Track 3 MD guides |
| Full live browser multi-agent E2E (Task 3F) | **Mode A done** / Mode B pending | Canonical: [`ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md`](./ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md) (2026-11-09: 14 pass / 0 fail / 4 skip); mutating Mode B still needs non-prod DB |

---

## Done — you can claim this for Track 3

1. **Supervised multi-agent system** — Supervisor + Discovery + Application + Recruiter  
2. **Guardrails** — validation, PII, fairness-before-rank, low-confidence refuse/clarify  
3. **Confirm-to-apply** — propose = 0 inserts; confirm = real apply  
4. **Recruiter ownership + draft-only outreach** — no auto-send from UI  
5. **Seeker + Recruiter UIs** wired to Supervisor paths  
6. **Idempotent applications** — DB `UNIQUE (job_id, seeker_id)` proven live; handler + tests  
7. **Resume privacy design** — private `resumes` bucket + Storage policies + authorize-before-sign tests  
8. **Unit/integration tests** — Phase 6/7, confidence, concurrency mock, resume ACL mirror  
9. **Human docs** — multi-agent guide + guardrails / idempotent / resume docs  
10. **Task 3F Mode A** — read-only multi-agent browser verification on prod-backed local app (no confirm/save/send)  

That matches the brief’s “done looks like” for Track 3:

> Clear supervisor + specialists, shared memory, guardrails including fairness, application agent can take real actions.

---

## Pending — honest gaps

| Pending | Why it matters | Blocking Track 3 score? |
|---|---|---|
| **Task 3F — Mode B mutating browser E2E** (confirm apply / shortlist / save / send) | Strongest write-path demo evidence | Mode A read-only verification **done**; Mode B still optional / needs non-prod |
| **Live resume denial** (other recruiter / anon get 403) | Hard Problem 2 “proof Amol wants” | Unit/policy mirror exists; live matrix still strengthens bonus/security story |
| **Durable shared memory (Path B) — apply migration** | Code + proposed SQL in repo; survives restart only after `agent_sessions` exists | Explicitly approve/apply `PROPOSED_0027_agent_sessions.sql` on Supabase |
| **Optional UI “which agent ran” badge** | Easier mentor explanation | Not required by brief |

### Not Track 3 pending (other tracks)

| Track / item | Status | Notes |
|---|---|---|
| **Track 5 — model improvement / fine-tune** | **Done** (dual-benchmark + preferred-band synthetic) | Final package: [`ASSESSMENT_3_TRACK5_REPORT.md`](./ASSESSMENT_3_TRACK5_REPORT.md) · exec: [`ASSESSMENT_3_TRACK5_EXEC_SUMMARY.md`](./ASSESSMENT_3_TRACK5_EXEC_SUMMARY.md). Default **`v2-div-b`** (Macro F1 **0.861**, acc **0.864** ∈ (70%, 90%)). Independent OOD `track5_ood_v1` n=215 under frozen **`v2-div-b`**: Macro F1 **0.218** / acc **0.247** (prior `enriched_v2` freeze ~0.21 preserved) — separate headline, not HireHub-production proof. |
| HubSpot / Resend / Calendar depth | Pending (other track) | Not Track 3 |
| CRM campaign tracking UI | Pending (other track) | Not Track 3 |
| 20k RAG eval packaging | Pending / separate | Track 4 scale packaging |
| CI / Sentry packaging | Pending (other track) | Not Track 3 |
| DCT hand-in | Pending process | Not a code gap |

---

## Evidence scoreboard (implementation)

| # | Item | Status |
|---|---|---|
| 1 | Supervisor | **Done** |
| 2 | Discovery | **Done** |
| 3 | Application | **Done** |
| 4 | Recruiter | **Done** |
| 5 | Shared memory | **Done** for brief (Path A verified; Path B adapter ready; migration apply pending approval) |
| 6 | Guardrails | **Done** |
| 7 | Seeker UI → Supervisor | **Done** |
| 8 | Recruiter UI | **Done** |
| 9 | Idempotent apply | **Done** |
| 10 | Resume ACL | **Partial** (policy + unit mirror; no live JWT matrix) |
| 11 | Tests | **Done** |
| 12 | Docs | **Done** |
| — | Task 3F Mode A read-only browser | **Done** (re-verified 2026-11-09) |
| — | Task 3F Mode B mutating browser | **Paused** (prod-backed; needs isolated DB) |
| — | Task 3G final evidence report | **Done** — [`ASSESSMENT_3_TRACK3_FINAL_REPORT.md`](./ASSESSMENT_3_TRACK3_FINAL_REPORT.md) |

---

## How to talk about it (mentor / DCT)

- **For Track 3 (20 pts):** You have implemented the multi-agent system + guardrails + hard problems **1 / 3 / 5** in code, with strong unit evidence and live UNIQUE proof.  
- **Still to finish for maximum confidence / bonus polish:** optional live resume denial; optional Mode B Task 3F when you accept write risk or use disposable/non-prod data. Mode A read-only browser verification is recorded.  
- **Shared memory:** Say *“agents share conversation memory on the server today; it’s process-local, not a DB table yet.”*

### Safe next step on current Supabase

Follow **Mode A** in [`ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md`](./ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md) §11 (local UI, propose-only — no confirm apply/shortlist unless intentional).

---

## Shared memory — how to finish the “Partial” gap

**Today:** `src/lib/ai/memory/server-memory.ts` — in-process `Map` keyed by `userId::conversationId`. Supervisor already writes turns / skills / preferences / recent jobs and Discovery/Application read bundles.  
**Gap:** memory resets on server restart / multi-instance (not a DB table).

### Path A — Prove & polish (no schema) — **COMPLETED 2026-11-06**

Evidence: [`ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_A.md`](./ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_A.md), `scripts/path-a-shared-memory-ui-verify.mjs`, `docs/path-a-shared-memory-ui-results.json`.

1. ~~UI same conversation skills → Discovery follow-up~~ **Pass**  
2. ~~Application propose-only using conversation/recent-job context~~ **Pass** (Mode A)  
3. ~~Restart limitation documented + unit “new instance empty”~~ **Pass**  
4. No schema / no redesign  

### Path B — Durable memory — **CODE COMPLETE; migration apply pending**

Evidence: [`ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_B.md`](./ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_B.md), `PROPOSED_0027_agent_sessions.sql`, `src/test/path-b-durable-memory.test.ts`.

1. ~~Proposed `agent_sessions` + RLS~~ **In repo** (not applied to hosted DB yet)  
2. ~~JWT load/save adapter + optimistic concurrency~~ **Done**  
3. ~~Seeker Supervisor hydrate/persist wiring~~ **Done** (falls back to Path A if table missing)  
4. ~~Unit tests~~ **Done**  
5. **You still must explicitly approve applying the migration** to staging/production before restart durability is live  

**Until migration is applied:** shared memory behaves as Path A (in-process) with safe fallback.

---

## Changelog

| Date | Change |
|---|---|
| 2026-11-06 | Initial Track 3 status snapshot vs Assessment 3 brief + codebase audit. |
| 2026-11-06 | Added shared-memory Path A (prove) vs Path B (durable, needs schema approval). |
| 2026-11-06 | **Path A completed** — UI verify + docs + restart-limitation unit test; memory marked done for Track 3 brief. |
| 2026-11-06 | **Path B code** — `agent_sessions` proposed SQL + durable adapter + seeker wiring + unit tests; **DB apply still needs your approval**. |
| 2026-11-09 | **Task 3F Mode A re-verified**; canonical browser doc updated. **Task 3G** final evidence report added. Status linked to final report; Mode B / live Storage / Path B apply remain incomplete. |
| 2026-11-09 | Recruiter Agent UI → chat-first hybrid (owned job/applicant search + Supervisor chat shortlist/draft). |
| 2026-11-09 | **P0 status sync:** Track 5 / fine-tune marked **Done** (synthetic evidence) with links to Track 5 report + exec summary; removed stale “fine-tune pending” wording from other-tracks list. |
| 2026-11-09 | **P0 status re-sync (post P4/P5):** Track 5 row updated — default **`v2-div-b`** (joint band + Macro F1 ≥ 0.85); OOD `track5_ood_v1` noted as separate independentBenchmark; links unchanged. |
