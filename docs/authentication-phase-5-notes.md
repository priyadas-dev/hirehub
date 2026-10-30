# Authentication Phase 5 — Route protection review

**Phase:** 5 of 7  
**Date:** 2026-10-30  
**Status:** Audit complete + small hardening — awaiting smoke checklist

## Route matrix (verified)

| Kind | Routes | Gate |
| --- | --- | --- |
| Public | `/`, `/auth`, `/forgot-password`, `/reset-password`, `/support` | None |
| Authenticated shell | `/_app/*` (URLs `/seeker`, `/recruiter`, `/admin`, `/settings`, `/dashboard`) | `readSession()` in `_app` |
| Seeker-only | `/seeker/*` | `wrongRoleHome(..., "seeker")` |
| Recruiter-only | `/recruiter/*` | `wrongRoleHome(..., "recruiter")` |
| Admin-only | `/admin/*` | `wrongRoleHome(..., "admin")` |
| Shared authenticated | `/settings` | Any valid session |
| Alias | `/dashboard` | Redirect → `ROLE_HOME[role]` |

Authorization for data mutations remains **RLS + `profiles.role`** (not UI alone).

## Changes in this phase

| Change | Why |
| --- | --- |
| `wrongRoleHome` shared helper | Same cross-role redirect for seeker / recruiter / admin layouts |
| `safeAuthReturnPath` on `_app` → `/auth?redirect=` | Avoid open redirects / `/auth` loops in return URLs |
| `/auth` `beforeLoad` | Established sessions go to role home; **skip** when `oauth` or `error` so Google claim/discard still runs |

## Preserved

- Admin area and admin sign-in → `/admin`
- Post-auth `resolvePostAuthPath` still blocks cross-role deep links
- No new product routes invented

## What to test before Phase 6

1. Logged out → open `/seeker` or `/recruiter/jobs` → `/auth?redirect=…` → after sign-in, same-role deep link honored.  
2. Seeker session → open `/recruiter` → redirected to `/seeker`.  
3. Recruiter session → open `/admin` → redirected to `/recruiter`.  
4. Admin session → open `/seeker` → redirected to `/admin`; `/admin/users` OK.  
5. Already signed in → visit `/auth` → bounce to role home (no form flash if possible).  
6. Google signup/sign-in callbacks still complete (claim / discard / errors).  
7. Unit: `npm test -- src/test/auth-role-routing.test.ts`

Reply **Phase 5 approved** to continue with **Phase 6**.
