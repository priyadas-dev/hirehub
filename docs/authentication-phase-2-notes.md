# Authentication Phase 2 — Role model & claim integrity

**Phase:** 2 of 7  
**Date:** 2026-10-29  
**Depends on:** Phase 1 approved (Option A; PROPOSED_0007 confirmed live)  
**Status:** Code complete — **apply SQL 0019 + smoke-test before Phase 3**

## What changed

| Change | Detail |
| --- | --- |
| Removed delete+insert | `claim-oauth-signup-role.ts` no longer deletes the `profiles` row |
| Preferred path | SQL RPC `claim_oauth_recruiter_role(uuid)` (service_role only) |
| Fallback | Direct `UPDATE … SET role = recruiter` when RPC missing (needs 0007) |
| Retry | One automatic retry on retryable failures (`withOneClaimRetry`) |
| Email path | `buildEmailSignupMetadata` → `requested_role` for `handle_new_user` (tested) |
| UX | Clearer toast when Google recruiter claim fails |

## Files

- `src/lib/oauth-signup-role-claim.ts` (new helpers)
- `src/lib/claim-oauth-signup-role.ts` (rewrite)
- `src/lib/account-password.ts` (uses shared metadata builder)
- `src/routes/auth.tsx` (claim failure copy)
- `src/test/oauth-signup-role-claim.test.ts`
- `drizzle/migrations/PROPOSED_0019_claim_oauth_recruiter_role.sql`
- `supabase/migrations/20261029120000_proposed_0019_claim_oauth_recruiter_role.sql`

## You must apply SQL (Dashboard)

In Supabase **SQL Editor**, run the contents of:

`drizzle/migrations/PROPOSED_0019_claim_oauth_recruiter_role.sql`

Verify:

```sql
select proname
from pg_proc
where proname = 'claim_oauth_recruiter_role';
```

Expect one row.

## What to test before Phase 3

1. **SQL applied** — `claim_oauth_recruiter_role` exists (query above).  
2. **Unit tests** — `npm test -- src/test/oauth-signup-role-claim.test.ts src/test/oauth-signup-role.test.ts` (or full `npm test`).  
3. **New Google → Recruiter** — use a **brand-new** Google account, choose Recruiter, Continue with Google → land on `/recruiter`, `profiles.role = recruiter`.  
4. **New Google → Seeker** — still lands on `/seeker`.  
5. **Existing Google seeker + Recruiter chosen** — stays seeker; toast explains role not changed.  
6. **Email recruiter signup** — still creates `recruiter` via `requested_role` (confirm-email path OK).  
7. **No profile wipe** — after a successful Google recruiter claim, profile fields (name/email) remain; no orphan auth users.

Reply **Phase 2 approved** when 1–3 (and ideally 4–6) pass.
