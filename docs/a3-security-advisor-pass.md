# Assessment 3 — Security Advisor & resume Storage evidence

**Date:** 2026-11-24  
**Project:** HireHub `munqgybiuqpncxbgfvdp`  
**Guardian:** read-only verification; no RLS weaken; no `.env` edits.

## Security Advisor

| Check | Result | Evidence |
|-------|--------|----------|
| Security Advisor errors | **0 errors** — no errors detected | [`a3-security-advisor-errors-pass.png`](./a3-security-advisor-errors-pass.png) · [`a3-security-advisor-screenshot.png`](./a3-security-advisor-screenshot.png) |
| CLI `db lint` (linked) | No critical security findings | [`a3-security-advisor-lint.json`](./a3-security-advisor-lint.json) |

## Resume Storage (access control)

| Check | Result | Evidence |
|-------|--------|----------|
| `resumes` bucket privacy | **Public = off** | [`a3-resumes-bucket-private.png`](./a3-resumes-bucket-private.png) |
| File size limit | **5 MB** | same |
| Allowed MIME types | **application/pdf** | same |
| Storage policies | SELECT (owner / admin / hiring recruiter); INSERT/UPDATE/DELETE (seeker own folder) | [`a3-resumes-storage-policies.png`](./a3-resumes-storage-policies.png) |

## App-side upload checks

- `validateResumePdfFile` — PDF + ≤5 MB (`src/lib/resume-upload.ts`)  
- UI: `ResumePdfPicker`  

## Live access matrix

Hiring recruiter can sign; non-entitled path + anon denied — [`a3-resume-other-recruiter-deny.json`](./a3-resume-other-recruiter-deny.json).

## DCT

Upload the three primary screenshots (Advisor 0 errors · private bucket · policies) to Dev Control Tower with the submission report.
