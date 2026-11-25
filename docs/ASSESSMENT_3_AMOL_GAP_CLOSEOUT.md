# Assessment 3 — Amol gap closeout pack

**Intern:** Priya Das · **Mentor:** Amol · **Due:** 25 Nov 2026  
**Rules:** project-guardian (no `.env` edits, no unapproved DDL, no RLS weaken, no Lovable history rewrite)

## Status board

| # | Gap | Status | Evidence |
|---|-----|--------|----------|
| 1 | CI green URL + `assessment-3` Release | **DONE** — green run + Release published 2026-11-24 | [Actions](https://github.com/priyadas-dev/hirehub/actions/runs/44091862041) · [Release](https://github.com/priyadas-dev/hirehub/releases/tag/assessment-3) · [`a3-ci-green-actions.png`](./a3-ci-green-actions.png) |
| 2 | Sentry DSN + one real event | **DONE** — local + Vercel DSN; redeployed; live Issue captured 2026-11-24 | Marker `hirehub-a3-sentry-smoke-2026-11-24T06:25:04.122Z` · [`a3-sentry-event-screenshot.png`](./a3-sentry-event-screenshot.png) · [`ASSESSMENT_3_SENTRY_EVIDENCE.md`](./ASSESSMENT_3_SENTRY_EVIDENCE.md) |
| 3 | Supabase Security Advisor + resume | **DONE** — Advisor **0 errors**; resumes private + PDF/5MB + policies (screenshots in docs) | [`a3-security-advisor-errors-pass.png`](./a3-security-advisor-errors-pass.png) · [`a3-resumes-bucket-private.png`](./a3-resumes-bucket-private.png) · [`a3-resumes-storage-policies.png`](./a3-resumes-storage-policies.png) · [`a3-security-advisor-pass.md`](./a3-security-advisor-pass.md) |
| 4 | Live other-recruiter deny + upload checks | **DONE** — live JWT matrix `pass: true` (hiring allow; non-entitled + anon deny); upload PDF/size enforced | [`a3-resume-other-recruiter-deny.json`](./a3-resume-other-recruiter-deny.json) |
| 5 | Migrations `agent_sessions` / 0022 / 0028 | **DONE — ALL APPLIED** (live verified 2026-11-24) | [`ASSESSMENT_3_MIGRATION_STATUS.md`](./ASSESSMENT_3_MIGRATION_STATUS.md) |
| 6 | Agent apply E2E real write | **DONE** — demo video (Drive / DCT): discover → Confirm apply → applications row | Demo video submitted with Dev Control Tower |

## 1 — CI + Release (complete)

- Green CI: https://github.com/priyadas-dev/hirehub/actions/runs/44091862041 (Vitest **106** files / **957** tests)  
- Screenshot: [`a3-ci-green-actions.png`](./a3-ci-green-actions.png)  
- Release: https://github.com/priyadas-dev/hirehub/releases/tag/assessment-3  
- Publish record: [`a3-ci-release-status.json`](./a3-ci-release-status.json) 

## 2 — Sentry (complete)

- DSN set locally and on Vercel Production; app redeployed after update.  
- Live event marker: `hirehub-a3-sentry-smoke-2026-11-24T06:25:04.122Z`  
- Screenshot: [`a3-sentry-event-screenshot.png`](./a3-sentry-event-screenshot.png)  
- Details: [`ASSESSMENT_3_SENTRY_EVIDENCE.md`](./ASSESSMENT_3_SENTRY_EVIDENCE.md)  

## 3 — Security Advisor / resume Storage (complete)

- Advisor **0 errors**: [`a3-security-advisor-errors-pass.png`](./a3-security-advisor-errors-pass.png)  
- Resumes **private** + PDF/5MB: [`a3-resumes-bucket-private.png`](./a3-resumes-bucket-private.png)  
- Resume Storage policies: [`a3-resumes-storage-policies.png`](./a3-resumes-storage-policies.png)  
- Summary: [`a3-security-advisor-pass.md`](./a3-security-advisor-pass.md)  

## 4 — Resume deny + upload checks (complete)

- Live matrix: [`a3-resume-other-recruiter-deny.json`](./a3-resume-other-recruiter-deny.json) (`pass: true`)  
- Reproduce: `npm run a3:resume-deny`  
- Upload: PDF + ≤5 MB (`validateResumePdfFile` + bucket limits)

## 5 — Migrations (complete)

All three live on `munqgybiuqpncxbgfvdp` — see [`ASSESSMENT_3_MIGRATION_STATUS.md`](./ASSESSMENT_3_MIGRATION_STATUS.md).

## 6 — Agent apply E2E (complete)

Demo video (Drive / Dev Control Tower): pick job → **Confirm apply** → applications row.

## Protected / unchanged

- `.env*` files  
- Existing Storage RLS (not weakened)  
- Mode A browser scripts default (no accidental prod writes)  
- No force-push / history rewrite  
