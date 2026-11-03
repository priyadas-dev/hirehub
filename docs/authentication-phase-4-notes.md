# Authentication Phase 4 — Google UX (seeker + recruiter)

**Phase:** 4 of 7  
**Date:** 2026-10-30  
**Depends on:** Phase 2 claim RPC + Phase 3 signup-only role selection  
**Status:** Code complete — awaiting smoke checklist

## Behavior matrix

| Action | Job Seeker | Recruiter | Admin |
| --- | --- | --- | --- |
| Sign up + email | `requested_role` → seeker home | `requested_role` → recruiter home | N/A (no signup) |
| Sign up + Google | Default seeker + welcome | Claim → recruiter (or keep existing + message) | N/A |
| Sign in + email/Google | Saved role home | Saved role home | Saved role → `/admin` |
| Sign in + brand-new Google | Discarded → prompted to Sign up | Same | N/A |

## What changed

| Change | Detail |
| --- | --- |
| Provider errors | `formatGoogleOAuthProviderError` — no hardcoded project ref |
| Failed/cancelled Google | Clears role + sign-in stashes |
| Claim skipped | Toast explains existing role kept (seeker cannot self-promote) |
| Google seeker signup | Welcome toast on `oauth=google` + `go_home` |
| Google sign-in | Welcome back; never applies signup role |
| Intent on error strip | Only kept when still on signup mode |

## Files

- `src/routes/auth.tsx`
- `src/lib/auth-errors.ts`
- `src/lib/oauth-signup-role.ts` (existing signup-only redirect/claim rules)
- `src/test/auth-errors.test.ts`

## What to test before Phase 5

1. **Signup Google as Job Seeker** (new account) → `/seeker`, welcome toast.  
2. **Signup Google as Recruiter** (new account) → `/recruiter`, role `recruiter`.  
3. **Existing seeker** Google via Sign up as Recruiter → stays seeker + “existing role” message.  
4. **Sign in Google** (existing seeker/recruiter/admin) → correct `ROLE_HOME`, no role change.  
5. **Sign in Google** with unregistered Google → blocked, nudged to Sign up (choose role).  
6. Cancel Google / provider error → friendly toast, busy cleared, can retry.  
7. Unit: `npm test -- src/test/auth-errors.test.ts src/test/oauth-signup-role.test.ts`

Reply **Phase 3 & 4 approved** when checklist passes.
