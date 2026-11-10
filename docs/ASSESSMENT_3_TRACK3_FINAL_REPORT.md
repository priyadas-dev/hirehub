# Assessment 3 Track 3 — Final Evidence Report

**Track:** Multi-agent orchestration + guardrails (**20 pts**)  
**Hard problems covered in this track’s evidence:** 1 (idempotent apply), 2 (resume ACL — partial live proof), 3 (fairness), 5 (application real actions)  
**Report date:** 2026-11-09  
**Scope of this document:** Final documentation synthesis only — **no** new features, **no** code/schema/RLS/.env changes, **no** production mutations.

**Companion guides:**  
[`ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md`](./ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md) ·  
[`ASSESSMENT_3_TRACK3_STATUS.md`](./ASSESSMENT_3_TRACK3_STATUS.md) ·  
[`ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md`](./ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md)

---

## 1. Executive verdict

| Question | Answer |
|---|---|
| Is Track 3 **implementation-complete** for the Assessment 3 brief? | **Yes** — Supervisor + Discovery + Application + Recruiter, shared memory (Path A), guardrails (validation, PII, fairness, low-confidence), seeker + recruiter UIs, real JWT actions with confirm gates |
| Is every production write path **live-browser proven**? | **No** — Task **3F Mode A** (read-only) is complete; **Mode B** mutating E2E needs an isolated non-prod DB |
| Can you claim durable DB shared memory? | **No** — Path A is **in-process** and **resets on server restart**. Path B code exists; migration apply is still pending explicit approval |
| Can you claim live Storage RLS denial in browser? | **No** — resume evidence is a **policy mirror** (+ unit tests), not a live three-JWT Storage matrix |

---

## 2. Architecture and agent responsibilities

```text
Seeker UI  → askJobAssistant (JWT) → runSupervisor
Recruiter UI → ask-recruiter-agent → recruiter-via-supervisor → runSupervisor
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
               Discovery      Application         Recruiter
               (live jobs)    (apply/save/status) (shortlist/outreach)
                    │               │                │
                    └─────── Shared memory (Path A) ─┘
                             userId :: conversationId
```

| Agent | Responsibility | Key entry |
|---|---|---|
| **Supervisor** | Guardrails first; route; memory read/write; merge structured results | `src/lib/ai/agents/supervisor.ts` |
| **Discovery** | Recommend **approved** live jobs (+ optional corpus); never invent vacancies | `src/lib/ai/agents/discovery.ts` |
| **Application** | Confirm-to-apply, Save Job, Check Application Status (JWT only) | `src/lib/ai/agents/application.ts` |
| **Recruiter** | Owned-job shortlist propose/confirm; outreach **draft** (no auto-send from NL) | `src/lib/ai/agents/recruiter.ts`, `recruiter-agent-runner.ts` |

**UIs**

| Role | Route | Notes |
|---|---|---|
| Seeker | `/seeker/assistant` | Discovery / apply propose+confirm / save+status outcomes |
| Recruiter | `/recruiter/agent` | Owned jobs, applicants, propose shortlist, draft outreach |

---

## 3. Supervisor routing and guardrails

### Routing (seeker)

Typical priority after validation + PII + fairness:

1. Application — apply / save / status intents  
2. Discovery — job search / skill ranking  
3. Legacy pipeline — general Q&A via existing job assistant  

Recruiter/admin roles use the recruiter supervisor branch (structured directive and/or NL shortlist/outreach).

### Guardrails

| Guardrail | Behavior | Module |
|---|---|---|
| Input validation | Reject invalid supervised turns | `guardrails/validation.ts` |
| PII redaction | Email / phone / labeled ID scrubbed before LLM/memory | `guardrails/pii.ts` |
| Fairness | Discriminatory hiring filters refused/neutralized **before** rank | `guardrails/fairness.ts` |
| Low-confidence | Empty/vague Discovery → clarify or refuse; no invented cards | `guardrails/confidence.ts` |
| Structured outputs | Typed agent/supervisor payloads (`pendingApply`, `saveOutcome`, `applicationStatuses`, traces) | supervisor + job-assistant types |

**Doc:** [`ASSESSMENT_3_TRACK3_GUARDRAILS.md`](./ASSESSMENT_3_TRACK3_GUARDRAILS.md)

---

## 4. Shared memory design and limitations

| Item | Detail |
|---|---|
| Implementation | `src/lib/ai/memory/server-memory.ts` |
| Keying | `userId::conversationId` |
| Stores | Turns (redacted), skills, preferences, recent job cards |
| Consumers | Discovery (skills/hints/context); Application (recent jobs only) |
| Path A status | **Verified** (unit + UI Path A script) |
| Path B | Adapter + proposed `agent_sessions` SQL in repo; **not applied** to hosted DB without approval |

### Explicit limitation (must state for assessment)

**Shared Memory Path A is in-process only. It resets when the Node/Vite server process restarts (or the process Map is cleared). It is not durable across instances or deploys until Path B migration is approved and applied.**

**Docs:**  
[`ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_A.md`](./ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_A.md) ·  
[`ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_B.md`](./ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_B.md)

---

## 5. Application and Recruiter workflows

### Application Agent

| Tool | Behavior | Write? |
|---|---|---|
| Apply | Propose (`confirm: false`) → chip; confirm → `applyToJob` (JWT) | Write only on confirm |
| Save Job | Idempotent `saved_jobs` via UNIQUE `(seeker_id, job_id)` | Write |
| Check status | Paginated list / id lookup; always filter `seeker_id` from auth | Read |
| Task 2A UI | `SaveJobOutcomeChip`, `ApplicationStatusOutcomeList` | Display only |

Helpers: `src/lib/apply-to-job.ts`, `save-job.ts`, `seeker-application-status.ts`  
UI: `src/components/assistant/AssistantToolOutcomes.tsx`, `_app.seeker.assistant.tsx`

### Recruiter Agent

| Action | Behavior | Write? |
|---|---|---|
| List owned jobs / applicants | JWT + DB ownership (`recruiter_id`) | Read |
| Propose shortlist | `confirm: false` — no status change | No |
| Confirm shortlist | Owned application only | Write + possible notify |
| Draft outreach | Editable draft; NL path `confirmSend: false` | No send by default |

UI: `src/routes/_app.recruiter.agent.tsx`

---

## 6. Security and ownership checks

| Control | How enforced |
|---|---|
| Role areas | `profiles.role` via auth; area guards — not browser-supplied roles |
| Live jobs / apply / save / status | Caller JWT Supabase client; never service-role apply |
| Seeker id | From authenticated session deps — never trusted from free text |
| Resume path ACL | Storage folder must match seeker; assert on apply |
| Recruiter tools | Ownership from DB job/application `recruiter_id` |
| Resume Storage | Private `resumes` bucket + RLS; app mirror in `resume-access.ts` |

**Resume evidence classification:** policy + unit **mirror** — see §9.  
**Doc:** [`ASSESSMENT_3_TRACK3_RESUME_ACCESS_CONTROL.md`](./ASSESSMENT_3_TRACK3_RESUME_ACCESS_CONTROL.md)

---

## 7. Idempotency — implementation and evidence

| Layer | Evidence |
|---|---|
| Schema | `UNIQUE (job_id, seeker_id)` on `applications` (core migration) |
| Handler | `applyToJob` pre-check + Postgres `23505` → `already_applied` |
| Agent | Unconfirmed path attempts **0** inserts |
| Live SQL | UNIQUE presence verified (see idempotent doc) |
| Concurrency suite | **Mocked** 10-way race → 1 row |

### Explicit limitation

**The automated concurrency test is a deterministic mock of UNIQUE + 23505. It is not a live PostgreSQL stress test against Supabase.**

**Doc:** [`ASSESSMENT_3_TRACK3_IDEMPOTENT_APPLICATIONS.md`](./ASSESSMENT_3_TRACK3_IDEMPOTENT_APPLICATIONS.md)

---

## 8. Test results (exact counts — focused re-check 2026-11-09)

Focused Vitest runs used for this final report (not a full-repo sweep):

### A. Core multi-agent / Task 2–3 suite

```text
Files: 7 passed
Tests: 67 passed
```

Includes:

- `phase6-agents.test.ts`
- `phase6-shared-memory.test.ts`
- `phase7-agents.test.ts`
- `phase7-recruiter-supervisor.test.ts`
- `phase7-application-tools.test.ts`
- `ask-job-assistant-supervisor.test.ts`
- `assistant-tool-outcomes.test.tsx`

### B. Guardrails / idempotency mock / resume mirror

```text
Files: 3 passed
Tests: 33 passed
```

Includes:

- `guardrail-confidence.test.ts`
- `apply-to-job-concurrency.test.ts` (**mocked** concurrency)
- `resume-access-rls.test.ts` (**policy mirror**)

**Combined focused evidence cited here:** **10 files, 100 tests passed** (67 + 33).

---

## 9. Task 3F live browser verification

| Item | Value |
|---|---|
| Mode | **Mode A — complete** |
| Date (canonical re-run) | 2026-11-09 |
| Summary | **14 passed / 0 failed / 4 skipped / 18 total** |
| Backend | Local app → **production-backed** hosted Supabase |
| Policy | No Confirm apply/shortlist, no Save Job, no email send |

**Canonical report:** [`ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md`](./ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md)  
**JSON:** [`task3f-readonly-browser-results.json`](./task3f-readonly-browser-results.json)  
**Screenshots:** `task3f-readonly-seeker-assistant.png`, `task3f-readonly-recruiter-agent.png`

### Explicit limitation

**Mode B (mutating browser E2E: confirm apply/shortlist, save job, send) requires an isolated non-production environment.** It was not run against production.

---

## 10. Evidence classification matrix

| Area | Implemented + unit-tested | Live read-only browser | Mocked / policy-mirror | Unverified on production writes |
|---|---|---|---|---|
| Supervisor routing | Yes | Yes (Mode A seeker/recruiter pages) | — | Mutating recruiter confirm |
| Discovery (no invent) | Yes | Yes | — | — |
| Fairness refuse | Yes | Yes | — | — |
| Low-confidence / clarify | Yes | Yes | — | — |
| Propose apply (confirm:false) | Yes | Yes | — | Confirm apply insert |
| Save Job | Yes | Skipped (write) | — | Live save write |
| Application status | Yes | Yes (SELECT) | — | — |
| Recruiter page + owned list | Yes | Yes | — | — |
| Propose shortlist | Yes | Skipped (no applicant row) | — | Confirm shortlist |
| Outreach draft | Yes | Yes (draft only) | — | Send / CRM persist |
| Shared memory Path A | Yes | Path A UI script earlier | Restart emptiness unit | Durable Path B live |
| Idempotent apply | Yes + live UNIQUE SQL | — | **Concurrency mock** | Live parallel stress |
| Resume ACL | Design + RLS in migrations | — | **Policy mirror Vitest** | Live Storage JWT matrix |

---

## 11. Evidence file index

| Topic | Path |
|---|---|
| This final report | `docs/ASSESSMENT_3_TRACK3_FINAL_REPORT.md` |
| Status | `docs/ASSESSMENT_3_TRACK3_STATUS.md` |
| Human guide | `docs/ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md` |
| Guardrails | `docs/ASSESSMENT_3_TRACK3_GUARDRAILS.md` |
| Idempotency | `docs/ASSESSMENT_3_TRACK3_IDEMPOTENT_APPLICATIONS.md` |
| Resume ACL | `docs/ASSESSMENT_3_TRACK3_RESUME_ACCESS_CONTROL.md` |
| Memory Path A | `docs/ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_A.md` |
| Memory Path B | `docs/ASSESSMENT_3_TRACK3_SHARED_MEMORY_PATH_B.md` |
| Browser 3F (canonical) | `docs/ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md` |
| Browser results JSON | `docs/task3f-readonly-browser-results.json` |
| Browser screenshots | `docs/task3f-readonly-*.png` |
| Path A memory UI results | `docs/path-a-shared-memory-ui-results.json` (if present) |

---

## 12. Remaining limitations and skipped checks

1. **Shared memory** — in-process; **resets on server restart**; Path B migration not applied.  
2. **Task 3F Mode B** — not run; needs non-prod DB.  
3. **Save Job / Confirm apply / Confirm shortlist / Send email** — intentionally skipped in Mode A.  
4. **Propose-shortlist click** — skipped in latest Mode A run (no applicant on selected owned job).  
5. **Concurrency** — mocked UNIQUE race, not live Postgres stress.  
6. **Resume ACL** — policy mirror / unit tests; not live Storage RLS browser proof.  
7. Optional mentor UX polish (e.g. “which agent ran” badge) — not required by brief.

---

## 13. Final checklist

### Completed requirements (implementation + evidence)

- [x] Supervisor / router over Discovery, Application, Recruiter  
- [x] Discovery with real approved jobs (no invent)  
- [x] Application tools: apply (confirm gate), save, status + Task 2A UI  
- [x] Recruiter agent + UI (ownership, draft outreach)  
- [x] Guardrails: validation, PII, fairness, low-confidence  
- [x] Shared memory Path A (skills/prefs/recent jobs across agents)  
- [x] Idempotent applications (UNIQUE + handler + mock concurrency)  
- [x] Resume privacy design + policy-mirror tests  
- [x] Focused unit suite: **67 + 33 = 100** tests passed (2026-11-09 re-check)  
- [x] Task **3F Mode A** browser verification: **14/0/4** (pass/fail/skip)

### Remaining limitations (honest)

- [ ] Mode B mutating browser E2E on isolated DB  
- [ ] Live resume Storage JWT denial matrix  
- [ ] Path B durable memory migration apply (optional / approval-gated)  
- [ ] Live PostgreSQL concurrency stress (optional)

### Track 3 implementation-complete?

**Yes — for Assessment 3 Track 3 feature scope**, with the limitations above clearly labeled.

### Evidence still useful for final assessment submission (optional polish)

1. Optional Mode B demo on a **non-prod** project/branch  
2. Optional live Storage deny screenshots (seeker / owner recruiter / other recruiter)  
3. Package this final report + 3F screenshots + status doc for DCT/mentor hand-in  

---

## 14. Changelog

| Date | Change |
|---|---|
| 2026-11-09 | Task **3G** — final Track 3 evidence report created from existing implementation + Mode A browser re-verification + focused Vitest counts. |
