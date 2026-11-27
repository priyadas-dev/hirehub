# Assessment 3 Track 3 — Resume storage access control (Task 3E)

**Invariant:** Uploaded seeker resumes in the private `resumes` bucket are readable only by (1) the owning seeker, (2) admins, or (3) the recruiter who owns the job linked to an application that references that exact Storage path. Guessing a Storage path or URL must not bypass authorization.

**Status (2026-11-25):** Storage RLS + app mirror remain the security boundary. Recruiter Agent NL (`open` / `show` … resume) now enforces the same ownership rule in chat — Access Denied for names not on the recruiter’s owned jobs; owned applicants open via signed URL / `ResumeOpenLink`. Live browser proof screenshots are in §9.

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
| `src/test/recruiter-applicant-access.test.ts` | NL open-resume: unknown name → Access Denied (no owned-list dump); owned name with file → open/link copy; owned with no file → clear message; deny copy must not leak foreign PII | Unit (JWT ownership helpers + applicant Q&A) |
| `src/test/recruiter-agent-ui.test.ts` | `open_resume` intent + name extraction (`open jia resume`, `open Priya das resume`) | Unit |

These Storage RLS tests **do not** prove live Postgres Storage by themselves. Production safety depends on `PROPOSED_0008` remaining applied with `public = false`. NL deny/open paths are covered by unit tests **and** live browser screenshots in §9.

### Recruiter Agent NL resume open (product path)

| Ask | Expected |
|---|---|
| `show me jia resume` / `open jia resume` (not an applicant on jobs this recruiter owns) | `RECRUITER_RESUME_ACCESS_DENIED_MESSAGE` — no owned-applicant dump, no PII leak |
| `open Priya das resume` (applied to an owned job, resume on file) | Select applicant + open signed URL / show **View resume** link |
| Owned applicant, no file | “No resume on file …” |
| Ambiguous name | Ask which one / show cards — do not open blindly |

Implementation anchors: `isOpenResumeQuestion` / `extractResumeOpenNameHint` in `recruiter-agent-ui.ts`; `handleOpenResumeIntent` in `_app.recruiter.agent.tsx`; deny helpers in `recruiter-applicant-access.ts`; `ResumeOpenLink` + `resolveDisplayUrl` (JWT signed URL, no service-role on client).

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

## 8. Evidence layers

1. **Policy mirror Vitest** — `resume-access-rls.test.ts` (authorize-before-sign; createSignedUrl not called when denied).  
2. **Live Storage** — private `resumes` bucket + RLS policies + other-recruiter deny JSON.  
3. **Product NL + browser** — Recruiter Agent Access Denied / owned open + seeker upload screenshots (§9).  
4. **UI open path** — `ResumeOpenLink` / JWT `createSignedUrl` (TTL 120s); Storage RLS remains the boundary.  
5. **New uploads** — `resume_storage_path` under private bucket (not permanent public URLs).

---

## 9. Live browser proof (2026-11-25)

Environment: HireHub recruiter + seeker sessions on the deployed/dev app. Screenshots live under [`evidence/resume-access-2026-11-25/`](./evidence/resume-access-2026-11-25/).

### 9.1 Recruiter Agent — owned resume vs Access Denied

Recruiter (**Dibyo Das**) on **AI Recruiter Agent**:

1. Owned jobs listed (e.g. Tech Lead with applicant **Priya Das**); resume link shown on the applicant card (`Dibyo resume.pdf` / View resume).  
2. Prompt: `show me jia resume` → agent replies with the standard Access Denied copy (not an owned-applicant dump).

![Recruiter Agent: owned applicant resume link + Access Denied for Jia](./evidence/resume-access-2026-11-25/01-recruiter-agent-deny-jia-allow-owned.png)

### 9.2 Seeker upload — resume attached on apply

Job seeker (**Priya Das**) applying to an owned job (e.g. Module lead @ ACM Company) with a PDF attached for that application (override / profile resume). Proves resumes enter the private apply path before recruiter open.

![Seeker apply form with resume PDF attached (Dhiman_Das_Resume.pdf)](./evidence/resume-access-2026-11-25/02-seeker-apply-resume-upload.png)

![Seeker apply form with resume PDF attached (Ebadhur_Resume.pdf)](./evidence/resume-access-2026-11-25/03-seeker-apply-ebadhur-resume.png)

### 9.3 Owned resume open — downloaded PDFs

After authorized open (UI View resume / signed URL), the browser receives the PDF. Local downloads folder shows successful retrieval of resume files used in the verification session (filenames only — contents not pasted into this doc).

![Downloaded resume PDFs after authorized open](./evidence/resume-access-2026-11-25/04-owned-resume-downloads.png)

### 9.4 Proof matrix (this run)

| Scenario | Result | Evidence |
|---|---|---|
| Seeker attaches PDF on apply | Resume shown on apply form; path stored for the application | §9.2 screenshots |
| Hiring recruiter sees owned applicant resume link | Card + View resume / filename link | §9.1 |
| Recruiter asks NL for non-owned name (`jia`) | Access Denied message | §9.1 |
| Authorized open yields PDF bytes | Downloads of resume PDFs | §9.3 |

### 9.5 Observability (Sentry)

Sentry issue stream for the HireHub project around this work (includes resolved/older client errors from agent UI iteration). Used as ops context — ACL proof remains §9.1–§9.4.

![Sentry issues stream for HireHub around recruiter agent work](./evidence/resume-access-2026-11-25/05-sentry-observability.png)

---

## 10. Changelog

| Date | Note |
|---|---|
| 2026-11-25 | Added Recruiter Agent NL open-resume ownership enforcement + live browser proof screenshots (§9). |
| Earlier | Task 3E Storage privacy, RLS policy table, policy-mirror Vitest. |
