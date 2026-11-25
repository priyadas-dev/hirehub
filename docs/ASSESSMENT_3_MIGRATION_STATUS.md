# Assessment 3 — Migration status (Amol Gap 5)

**Project:** HireHub `munqgybiuqpncxbgfvdp`  
**Verified:** 2026-11-24 (read-only `supabase db query --remote` + RLS probe)  
**Guardian:** no DDL applied in this closeout pass; status is observational only.

## Verdict for mentor

| Item | Live status | Evidence |
|------|-------------|----------|
| `agent_sessions` (Path B / PROPOSED_0027) | **APPLIED** | `to_regclass('public.agent_sessions') = agent_sessions`; RLS **on** + **FORCE RLS** |
| `PROPOSED_0022` CRM ownership integrity | **APPLIED** | Composite FKs present: `crm_campaigns_segment_same_recruiter_fkey`, `crm_recipients_campaign_same_recruiter_fkey`, `crm_recipients_contact_same_recruiter_fkey` (+ segment member same-recruiter FKs) |
| `PROPOSED_0028` `google_calendar_watch_channels` | **APPLIED** | `to_regclass(...) = google_calendar_watch_channels`; RLS **on** (service-role registry; no anon/authenticated policies by design) |

**Nothing from Amol’s migration list is on hold.** Stale A3 docs that still say “proposed / unapplied” for Path B or 0028 are outdated relative to this verification.

## Resume Storage (related security — Gap 3/4)

| Check | Live result |
|-------|-------------|
| `storage.buckets.resumes.public` | `false` |
| `file_size_limit` | `5242880` (5 MiB) |
| `allowed_mime_types` | `application/pdf` |
| SELECT policy | `resumes_select_owner_admin_or_hiring_recruiter` |
| INSERT/UPDATE/DELETE | seeker own-folder policies |

## db lint (advisor-adjacent)

`npx supabase db lint --remote=munqgybiuqpncxbgfvdp` (2026-11-24):

- **No critical security lint** on Storage / RLS.
- Style warnings only on `public.extract_known_skills` (text→text[] cast / shadowed loop var) — **out of scope** for A3 resume ACL; do not “fix” by weakening RLS.

## Security Advisor & resume Storage screenshots

Dashboard evidence saved (2026-11-24):

- [`a3-security-advisor-errors-pass.png`](./a3-security-advisor-errors-pass.png) — Security Advisor **0 errors**  
- [`a3-resumes-bucket-private.png`](./a3-resumes-bucket-private.png) — private bucket, PDF, 5 MB  
- [`a3-resumes-storage-policies.png`](./a3-resumes-storage-policies.png) — resume access policies  

Summary: [`a3-security-advisor-pass.md`](./a3-security-advisor-pass.md).

**Do not** make `resumes` public. Any RLS change needs explicit approval.

## Reproduce

```bash
npx supabase db query --remote=munqgybiuqpncxbgfvdp --yes --read-only "select to_regclass('public.agent_sessions')::text as agent_sessions, to_regclass('public.google_calendar_watch_channels')::text as watch_channels;"

npx supabase db query --remote=munqgybiuqpncxbgfvdp --yes --read-only "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'resumes';"

npx supabase db lint --remote=munqgybiuqpncxbgfvdp --fail-on none
```
