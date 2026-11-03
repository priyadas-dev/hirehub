# Authentication Phase 6 — Recovery & edge cases

**Phase:** 6 of 7  
**Date:** 2026-10-30  
**Status:** **Approved** (2026-10-30)

## Scope

- Password reset allowlist checklist (ops)
- Claim failure recovery UX (continue / sign out / Settings delete / support)
- Company pending vs active copy consistency

## Changes

| Change | Why |
| --- | --- |
| `src/lib/auth-recovery.ts` | Shared claim-recovery copy + allowlist checklists |
| `/auth` claim failure panel | Toast-only was insufficient; user can continue as seeker, sign out to retry Google recruiter signup, open Settings to delete, or contact support |
| `suppressHomeRef` after claim failure | Prevents auto-redirect to seeker home while recovery is open; clears OAuth stash + strips `oauth` search |
| Recruiter jobs empty copy | Was “company is active immediately”; now pending until admin approves (matches product rules) |
| `forgot-password` errors | Prefer `formatAuthErrorMessage`; keep redirect-allowlist-specific copy |
| `LIVE_DEMO_CHECKLIST` | Claim recovery + allowlist wording |

## Password reset allowlist (ops)

Use `PASSWORD_RESET_ALLOWLIST_CHECKLIST` and `PASSWORD_RESET_REDIRECT_URLS` in `assignment-verification` / `auth-recovery`:

1. Site URL matches the HireHub origin in use  
2. Additional Redirect URLs include each local `…/reset-password`  
3. Additional Redirect URLs include deployed `…/reset-password`  
4. Forgot password uses `window.location.origin`  
5. Open the email link on that same host  

Google OAuth pair: `GOOGLE_OAUTH_ALLOWLIST_CHECKLIST` + `GOOGLE_OAUTH_REDIRECT_URLS`.

## Preserved

- Admin never offered in claim recovery or signup role picker  
- Job Seeker and Recruiter share the same recovery / password rules  
- No new product routes  

## What to test before Phase 7

1. Force or simulate failed Google recruiter claim → recovery panel with Continue / Sign out / Settings / Support.  
2. Continue as Job Seeker → `/seeker` with seeker role.  
3. Sign out to retry → signup Recruiter → Continue with Google.  
4. Forgot password on localhost → email link lands on same origin `/reset-password` (allowlist checked).  
5. Recruiter jobs empty state mentions company **pending**, not active.  
6. Unit: `npm test -- src/test/auth-recovery.test.ts src/test/assignment-verification.test.ts`

**Approved** — continue with Phase 7 (`docs/authentication-phase-7-notes.md`).
