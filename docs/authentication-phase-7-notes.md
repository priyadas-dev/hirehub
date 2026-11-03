# Authentication Phase 7 — Automated tests & regression

**Phase:** 7 of 7  
**Date:** 2026-10-30  
**Status:** **Approved** (2026-10-30)

## Scope

- Expand unit coverage (claim matrix, password parity, open-redirect negatives)
- Selective Playwright auth smoke (skips safely without secrets)
- Keep `LIVE_DEMO_CHECKLIST` aligned with automated entry points

## Changes

| Change | Why |
| --- | --- |
| `AUTH_UNIT_REGRESSION_FILES` / `AUTH_UNIT_REGRESSION_GLOB` / `AUTH_E2E_SMOKE_SPEC` | Single place listing Phase 7 regression entry points |
| Claim eligibility matrix expansion | Admin / email-only / already-recruiter / seeker request never apply |
| Password schema parity test | Signup / reset / set share letter+number strength |
| Open-redirect negatives | `javascript:` / `data:` rejected by `safeAuthReturnPath` |
| `e2e/auth-smoke.spec.ts` | Public routes (opt-in) + seeker sign-in / cross-role / sign-out |
| `LIVE_DEMO_CHECKLIST` | Points at unit regression + optional Playwright |

## How to run

```bash
# Unit regression (no secrets)
npm test -- src/test/auth-role-routing.test.ts src/test/auth-intent.test.ts src/test/auth-errors.test.ts src/test/auth-recovery.test.ts src/test/account-password.test.ts src/test/password-recovery.test.ts src/test/oauth-signup-role.test.ts src/test/oauth-signup-role-claim.test.ts src/test/delete-own-account.test.ts src/test/assignment-verification.test.ts src/test/app-routing.test.tsx

# Optional Playwright (npm run dev first; never commit passwords)
# E2E_AUTH_PUBLIC=1 npm run test:e2e -- e2e/auth-smoke.spec.ts
# E2E_SEEKER_EMAIL=... E2E_SEEKER_PASSWORD=... npm run test:e2e -- e2e/auth-smoke.spec.ts
```

## Preserved

- Admin bootstrap-only (never signup)
- Job Seeker / Recruiter same password + claim rules
- E2E skips when credentials unset (CI-safe)

## Manual remaining (LIVE_DEMO)

Google OAuth signup/sign-in, recruiter email signup, password email round-trip, and admin cross-role still need a live origin — automated suite covers routing/claim/password helpers and optional seeker session smoke.

**Approved** — auth roadmap Phases 0–7 complete.
