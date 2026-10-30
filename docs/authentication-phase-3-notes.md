# Authentication Phase 3 — Manual signup / sign-in polish

**Phase:** 3 of 7  
**Updated:** 2026-10-30  
**Status:** Code complete — applies to **Job Seeker and Recruiter** equally; Admin sign-in preserved

## Product rules (locked)

| Rule | Behavior |
| --- | --- |
| Role selection | **Sign up only** — Job Seeker or Recruiter |
| Sign in | Existing accounts only (email or Google); **no** role picker |
| Password rules | Same for seeker and recruiter signup (8+ chars, letters + number) |
| Saved role | Sign in never changes `profiles.role` (includes Admin) |
| Admin | Not offered on signup; existing admin opens `/admin` via saved role |

## What changed

| Change | Detail |
| --- | --- |
| Password parity | `authSignupFormSchema` / `newPasswordField` for both roles |
| Sign-in validation | Email + password presence only |
| Role UI | Full “I am a…” only on **Sign up** |
| Error copy | `formatAuthErrorMessage` for duplicate / confirm / rate-limit / weak password |

## What to test

1. Signup as **Job Seeker** (email) with weak vs strong password.  
2. Signup as **Recruiter** (email) with same password rules.  
3. Sign in tab — **no** role cards; existing seeker / recruiter / admin keep workspace.  
4. Duplicate email → Sign in / Google guidance.  
5. Unit: `npm test -- src/test/account-password.test.ts src/test/auth-errors.test.ts`
