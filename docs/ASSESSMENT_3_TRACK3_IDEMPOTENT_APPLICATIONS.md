# Assessment 3 Track 3 — Idempotent applications (Task 3D)

**Invariant:** For the same `(job_id, seeker_id)`, **exactly one** `applications` row may exist after concurrent duplicate apply attempts (double-click, retry, parallel agent/UI calls).

---

## 1. Database uniqueness evidence

| Source | Evidence |
|---|---|
| Core schema | `drizzle/migrations/0000_hirehub_core_schema.sql` — `CREATE TABLE public.applications` includes **`UNIQUE (job_id, seeker_id)`** |
| Remote history | `supabase/migrations/20261011113947_remote_baseline_*.sql` are **history markers only** (already applied on project `munqgybiuqpncxbgfvdp`); they do not re-state DDL |
| Safety net (not applied) | `drizzle/migrations/PROPOSED_0026_ensure_applications_job_seeker_unique.sql` — adds the UNIQUE constraint **only if missing**, after duplicate pre-check. **Do not apply without explicit approval.** |

### Live verification SQL (manual)

```sql
-- Constraint / unique index present?
SELECT c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
WHERE c.conrelid = 'public.applications'::regclass
  AND c.contype = 'u';

-- Existing duplicates? Must be empty before any ensure-UNIQUE apply.
SELECT job_id, seeker_id, COUNT(*) AS n
FROM public.applications
GROUP BY job_id, seeker_id
HAVING COUNT(*) > 1;
```

---

## 2. How duplicate requests are handled

| Layer | Behavior |
|---|---|
| `applyToJob` (`src/lib/apply-to-job.ts`) | Pre-check existing row → insert → on **23505** / unique message, re-fetch and return `{ ok: true, status: "already_applied", applicationId }` |
| Supabase adapter | JWT client only (`createSupabaseApplyToJobClient`) — never service role |
| Application agent | `confirm: false` → `needs_confirm`, **`insertsAttempted: 0`**; confirmed path calls `applyToJob` with **seekerId from auth deps** (`ask-job-assistant` uses `ctx.userId`) |
| Seeker job UI | Inserts with session `id` as `seeker_id`; treats 23505 as “Already applied” |

**Never trust a client-supplied seeker id for authorization** — agent/server paths derive seeker from the authenticated session.

---

## 3. Parallel test method and results

| Item | Detail |
|---|---|
| File | `src/test/apply-to-job-concurrency.test.ts` |
| Concurrent requests | **10** (`Promise.all`) for the same `(job_id, seeker_id)` |
| Race model | In-memory store with a **findExisting barrier** (all 10 see empty) then **UNIQUE + 23505** on insert |
| Assertions | Exactly **1** row; **1** `created`; **9** `already_applied` with the same `applicationId`; retries stay at 1 row; other seeker / other job allowed; empty seeker rejected; unconfirmed agent path never inserts |
| Backend under test | **Mock / simulated UNIQUE** — **not** live PostgreSQL |

### What this does *not* prove

JavaScript single-threaded mocks cannot replace Postgres row locking. Production safety depends on the **real UNIQUE constraint** (evidence above) plus the **23505** handler.

---

## 4. Manual live concurrency check (optional, after approval)

1. Confirm UNIQUE exists (SQL above).  
2. As one authenticated seeker JWT, fire ≥10 parallel `INSERT`/`applyToJob` calls for one approved job (script or HTTP).  
3. Assert `COUNT(*)` for that `(job_id, seeker_id)` is **1**.  
4. Assert losers surface as already-applied / 23505-handled, not 500s with extra rows.

Do **not** delete application rows to force the constraint.

---

## 5. Remaining limitations

1. Automated suite is **deterministic mock concurrency**, not Supabase integration.  
2. Job-detail UI path still inserts directly (handles 23505) rather than always going through `applyToJob` — DB UNIQUE still protects.  
3. `PROPOSED_0026` is unapplied; apply only after duplicate pre-check + explicit approval.  
4. Confirm-to-apply remains required on the Application Agent path; UI apply form is a separate seeker action.
