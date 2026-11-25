# Assessment 3 Track 3 — Resume storage access control (Task 3E)

**Invariant:** Uploaded seeker resumes in the private `resumes` bucket are readable only by (1) the owning seeker, (2) admins, or (3) the recruiter who owns the job linked to an application that references that exact Storage path. Guessing a Storage path or URL must not bypass authorization.

---

## 1. Architecture (upload → retrieve)

```text
Seeker picks PDF
  → validateResumePdfFile (PDF, ≤5 MB)
  → uploadResumePdf → path `{seeker_id}/{uuid}-{file}`
  → private bucket `resumes` (JWT insert: own folder only)
  → profiles / applications store resume_storage_path (not a permanent signed URL)

Open resume (UI ResumeOpenLink / picker)
  → resolveDisplayUrl(path, "resume")
  → createSignedUrl via caller JWT (TTL 120s)
  → Supabase Storage SELECT RLS must allow the object
```

Defense-in-depth app mirror: `src/lib/resume-access.ts`

- `evaluateResumeStorageSelectAccess` — same rules as Storage policy  
- `issueResumeSignedUrlAfterAuthorization` — **never** calls `createSignedUrl` if evaluation denies

---

## 2. Bucket privacy

| Setting | Value | Source |
|---|---|---|
| Bucket id | `resumes` | `PROPOSED_0008` |
| `public` | **`false`** | `INSERT INTO storage.buckets ... public = false` |
| MIME | `application/pdf` | same |
| Max size | 5 MiB | same |

**Do not make this bucket public.**

---

## 3. Relevant Storage / RLS policies

From `drizzle/migrations/PROPOSED_0008_secure_resume_portfolio_company_logos.sql`  
(also mirrored under `supabase/migrations/20261014090002_proposed_0008_...sql`):

| Policy | Who | Effect |
|---|---|---|
| `resumes_select_owner_admin_or_hiring_recruiter` | `authenticated` | SELECT if path safe AND (folder = `auth.uid` OR admin OR EXISTS application where `jobs.recruiter_id = auth.uid` AND exact `resume_storage_path = name` AND seeker folder bind) |
| `resumes_insert_job_seeker_own` | seeker | INSERT own folder only |
| `resumes_update_job_seeker_own` | seeker | UPDATE own folder only |
| `resumes_delete_job_seeker_own` | seeker | DELETE own folder only |

There is **no** `anon` SELECT policy on `resumes` — unauthenticated users cannot read objects.

DB check constraints also bind `profiles.resume_storage_path` / `applications.resume_storage_path` to `{owner_id}/...`.

---

## 4. Who can access which resumes

| Actor | Access |
|---|---|
| Job seeker (folder = their id) | Own objects |
| Hiring recruiter (`jobs.recruiter_id` for an application that stores that exact path) | That applicant resume only |
| Other recruiter | **Denied** |
| Unauthenticated | **Denied** |
| Admin | Allowed (policy + mirror) |
| Path guess / unsafe path (`..`, wrong folder) | **Denied** |

Hiding the link in the UI is **not** the security boundary — Storage RLS + authorize-before-sign are.

---

## 5. How unauthorized access is denied

1. **Storage RLS** rejects SELECT / `createSignedUrl` for JWT principals that fail the policy.  
2. **App mirror** returns `denied` / `unauthenticated` / `unsafe_path` without issuing a URL.  
3. Short TTL signed URLs (120s) are not stored in the DB as permanent links.  
4. Seeker id / recruiter id for ownership come from JWT + DB joins — not from client-trusted identity fields.

---

## 6. Tests and results

| File | What | Backend |
|---|---|---|
| `src/test/resume-access-rls.test.ts` | Seeker allow; hiring recruiter allow; other recruiter deny; other-job path deny; unbound path deny; unauthenticated deny; unsafe/guessed path deny; **createSignedUrl not called when denied** | **Policy mirror + injected mock signer** — **not** live Supabase Storage |

These tests **do not** prove live Postgres Storage RLS by themselves. Production safety depends on `PROPOSED_0008` remaining applied with `public = false`.

---

## 7. Manual live verification (safe, non-destructive)

Run in Supabase SQL Editor / Storage UI on an environment you control. Prefer non-production. **Do not** download or paste real resume contents into tickets.

```sql
-- Bucket must stay private
SELECT id, name, public
FROM storage.buckets
WHERE id = 'resumes';
-- Expect: public = false

-- SELECT policies on storage.objects for resumes (names)
SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname ILIKE '%resume%';
```

Then with three JWT sessions (seeker, hiring recruiter, other recruiter):

1. Seeker: `createSignedUrl` on `{seeker_id}/...` → success.  
2. Hiring recruiter (owns the job for that application path) → success.  
3. Other recruiter (same path) → failure / no usable URL.  
4. Logged-out / anon key → failure.  
5. Guessed path under another user’s folder → failure.

Do **not** apply new migrations for Task 3E unless a live check shows the bucket is public or policies are missing — then propose only, await approval.

---

## 8. Remaining limitations

1. Automated suite is a **policy mirror**, not an integration test against live Storage.  
2. Browser `ResumeOpenLink` still uses JWT `createSignedUrl` directly; live deny depends on Storage RLS (mirror helper is available for gated call sites).  
3. Legacy `applications.resume_url` https links (pre-private-bucket) remain readable if they point at public hosts — new uploads should use `resume_storage_path`.  
4. No dedicated local Supabase Storage test harness in this repo for parallel JWT matrix runs.
