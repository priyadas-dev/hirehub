# HireHub Assessment 3 — Phase 1 Report (Security Proofs)

**Phase:** 1 only  
**Date:** 2026-11-02  
**Branch:** `feature/auth-module-phases-1-7`  
**Rules followed:** `docs/ASSESSMENT_3_ENGINEERING_RULES.md`, checklist, roadmap, baseline, project-guardian  

**Mutation statement:** No migrations applied, no `.env` changes, no RLS weakened, no live data/corpus/embedding changes, no commit/push, Phase 2 not started.

---

## 1. Understanding

Phase 1 must prove:

1. Duplicate / concurrent applies cannot create two `applications` rows for the same `(job_id, seeker_id)`.  
2. A recruiter who does **not** own the job cannot access the seeker’s resume object.  

Reuse existing UNIQUE constraint, seeker apply flow, and PROPOSED_0008 Storage SELECT policy — do not rebuild auth/apply/RLS.

---

## 2. Decision (smallest safe change)

| Approach considered | Chosen? | Why |
|---|---|---|
| Rewrite apply UI + new schema | No | Forbidden rebuild; UNIQUE already exists |
| Live integration tests with service role | No | Would bypass user JWT / risk data mutation |
| **Extract `applyToJob` + racing UNIQUE mock + resume policy mirror tests** | **Yes** | Proves both properties without weakening RLS or touching live DB |

**Untouched on purpose:** migrations, RLS SQL, `.env`, RAG/classifier, auth module, CI (Phase 2).

---

## 3. Implementation

### New files
| File | Purpose |
|---|---|
| `src/lib/apply-to-job.ts` | Idempotent apply helper (pre-check + insert + 23505 → already_applied) |
| `src/lib/apply-to-job-supabase.ts` | User-JWT Supabase adapter (no service role) |
| `src/lib/resume-access.ts` | Pure mirror of PROPOSED_0008 resume SELECT rules |
| `src/test/idempotent-apply.test.ts` | Pre-check + **parallel** UNIQUE race → exactly one row |
| `src/test/resume-access-rls.test.ts` | Owner/admin/hiring OK; **other recruiter denied** |
| `docs/ASSESSMENT_3_PHASE_1_REPORT.md` | This report |

### Modified files
| File | Change |
|---|---|
| `src/routes/_app.seeker.jobs.$jobId.tsx` | Mutation now calls `applyToJob(createSupabaseApplyToJobClient(supabase), …)` |

---

## 4. Evidence — concurrent duplicate-apply prevention

**DB fact (unchanged):** `UNIQUE (job_id, seeker_id)` in `drizzle/migrations/0000_hirehub_core_schema.sql`.

**Handler:** `applyToJob` treats `23505` / duplicate messages as idempotent success after re-fetch.

**Test:** `src/test/idempotent-apply.test.ts` → `parallel duplicate applies collapse to exactly one row (UNIQUE race)`

- Fires **5 concurrent** `applyToJob` calls against an in-memory store that enforces UNIQUE with an awaitable race window.  
- Asserts: `rowCount === 1`, `successfulInserts === 1`, exactly one `created`, four `already_applied`, shared `applicationId`.

**Reproduce:**

```bash
npx vitest run src/test/idempotent-apply.test.ts --reporter=verbose
```

**Result (this session):** 5/5 tests passed in file (including parallel race).

---

## 5. Evidence — unauthorized recruiter resume denial

**Policy fact (unchanged):** `resumes_select_owner_admin_or_hiring_recruiter` in `PROPOSED_0008` — SELECT allowed for object owner, admin, or recruiter where `jobs.recruiter_id = auth.uid()` and application `resume_storage_path` matches exactly.

**Test:** `src/test/resume-access-rls.test.ts` → `denies a different recruiter (wrong job owner)`

- Hiring recruiter → allowed (`hiring_recruiter`).  
- Other recruiter → `allowed: false`, `reason: "denied"` (`otherRecruiterResumeAccessDenied` === true).  

This is a **policy-logic proof** (unit). It does not open a live Storage 403 against production (would require seeded dual-recruiter fixtures and approved live credentials). Live RLS remains the enforcement layer.

**Reproduce:**

```bash
npx vitest run src/test/resume-access-rls.test.ts --reporter=verbose
```

**Result (this session):** 6/6 tests passed in file.

---

## 6. Verification

| Check | Result |
|---|---|
| Phase 1 unit tests | **11 passed** (idempotent-apply + resume-access-rls) |
| Full `npm test` | **65 files / 503 tests passed** (2026-11-02) |
| Lint on touched TS | No issues reported |
| Migrations / `.env` / RAG | Unchanged |

---

## 7. Risks / limitations (honest)

1. **Parallel apply test is an in-memory UNIQUE race model**, not a live Postgres `Promise.all` against Supabase. It proves handler + constraint semantics; a future optional live integration test would need approved fixtures.  
2. **Resume denial test mirrors PROPOSED_0008 in TypeScript**; it does not assert an HTTP 403 from Storage in this phase. Confirm policy remains applied on the linked project before demo (Phase 0 noted 0008 as inventory-related; do not re-apply without approval).  
3. Helper returns `already_applied` as a thrown “Already applied” in the UI path (preserves existing toast UX).  
4. Phase 2 CI not started (per authorization).

---

## 8. Next step

**STOP.** Await your approval before Phase 2 (CI skeleton).

Suggested DCT evidence commands for later submission:

```bash
npx vitest run src/test/idempotent-apply.test.ts src/test/resume-access-rls.test.ts --reporter=verbose
npm test
```
