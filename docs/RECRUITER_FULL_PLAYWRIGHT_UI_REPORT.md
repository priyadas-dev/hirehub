# Recruiter workspace — full Playwright UI test report

**Date:** 2026-11-05  
**Environment:** `http://127.0.0.1:8080` (`npm run dev`)  
**Tooling:** Playwright (Chromium), script `scripts/recruiter-ui-audit.mjs`  
**Account:** Recruiter credentials from local `.env` (not stored in this document)  
**Machine-readable results:** `docs/recruiter-ui-audit-results.json`

---

## Executive summary

| Area | Result |
|------|--------|
| Auth guard (`/recruiter` → sign-in) | **Pass** |
| Recruiter dashboard & sidebar | **Pass** |
| Jobs (list, filters, search, post form validation) | **Pass** |
| Job detail (invalid / non-UUID id) | **Fail** — React runtime error |
| Applicants (filters, deep links) | **Pass** (no applicant rows exercised end-to-end) |
| Company profile (`/recruiter/company`) | **Pass** |
| Settings | **Pass** |
| Header job search (⌘K / Enter) | **Pass** |
| Mobile (390px) sheet navigation | **Pass** |
| Profile menu | **Pass** |
| `/recruiter/crm/*` | **Fail** — site **404** (routes not registered) |
| `/recruiter/job-categories` | **Fail** — site **404** (routes not registered) |

**Registered recruiter routes** (from `src/routeTree.gen.ts` and `src/test/app-routing.test.tsx`):  
`/recruiter`, `/recruiter/applicants`, `/recruiter/company`, `/recruiter/jobs`, `/recruiter/jobs/new`, `/recruiter/jobs/$jobId`, `/recruiter/jobs/$jobId/edit`.

CRM and recruiter job-categories **route files are not present on disk** in this workspace and are **absent from `routeTree.gen.ts`**, so those URLs cannot be exercised as product UI here. Older CRM-only reports under `docs/` (screenshots + segment reports) reflect a different tree state or unpushed work.

---

## How to re-run

```bash
npm run dev
npx playwright install chromium   # once per machine
node scripts/recruiter-ui-audit.mjs
```

Prefer standard env vars (do not commit values):

- `E2E_RECRUITER_EMAIL`
- `E2E_RECRUITER_PASSWORD`

The audit script also accepts informal `.env` lines `recuiter email:` / `recuiter password:` for local runs only.

---

## Test matrix

| ID | Scenario | Result | Notes |
|----|----------|--------|-------|
| AUTH-01 | Visit `/recruiter` while signed out | **Pass** | Redirects to `/auth` |
| R-01 | Dashboard loads | **Pass** | Welcome, stats, recent sections |
| R-02 | Sidebar navigation (all items) | **Pass** | Dashboard → Post a Job → My Job Posts → Applicants → Company Profile → Settings |
| R-03 | My Job Posts — title + status filters | **Pass** | |
| R-04 | My Job Posts — data loads | **Pass** | At least one job card/row visible for test account |
| R-05 | Post a Job — empty submit | **Pass** | Client validation; no job submitted |
| R-06 | `/recruiter/jobs/abc` (invalid id) | **Fail** | Shell nav timeout; **console: `TypeError: Cannot read properties of undefined (reading 'status')`** in `RecruiterJobDetailsPage` |
| R-07 | `/recruiter/jobs/abc/edit` | **Pass** | Route registered (edit shell loads) |
| R-08 | Applicants — job filter | **Pass** | |
| R-09 | Applicants — `?status=shortlisted` | **Pass** | |
| R-10 | Company profile | **Pass** | Page heading is **Profile** (browser title still “Company profile”) |
| R-11 | Settings | **Pass** | |
| R-12 | Header search → `?q=engineer` on jobs | **Pass** | |
| R-16 | Open job from list | **Partial** | Automation matched **Post a job** link (`/recruiter/jobs/new`) first; real job detail screenshot not captured reliably |
| R-13 | Mobile 390px — **Open navigation** sheet | **Pass** | Main nav inside sheet |
| R-14 | Profile menu | **Pass** | Settings / sign-out items |
| R-15 | Seeker blocked from `/recruiter` | **Skipped** | Covered by `e2e/auth-smoke.spec.ts` |
| R-ROUTE | `/recruiter/crm` (+ contacts, segments, campaigns) | **Fail** | Global **404 Page not found** |
| R-ROUTE | `/recruiter/job-categories` | **Fail** | Global **404 Page not found** |

---

## Screenshots (this run)

| File | Page |
|------|------|
| `recruiter-full-playwright-dashboard.png` | Recruiter dashboard |
| `recruiter-full-playwright-jobs.png` | My Job Posts (filters) |
| `recruiter-full-playwright-jobs-new.png` | Post a Job (validation state) |
| `recruiter-full-playwright-applicants.png` | Applicants |
| `recruiter-full-playwright-company.png` | Profile / company (Manor IT — approved) |
| `recruiter-full-playwright-mobile.png` | Mobile dashboard + nav sheet |
| `recruiter-full-playwright-crm.png` | **404** (CRM not registered) |
| `recruiter-full-playwright-job-categories.png` | **404** (route not registered) |

---

## Issues found (user-facing)

### P1 — CRM and job categories unreachable

Direct navigation to `/recruiter/crm`, `/recruiter/crm/contacts`, `/recruiter/crm/segments`, `/recruiter/crm/campaigns`, and `/recruiter/job-categories` shows the app-wide **404** screen.  
**Cause (this branch):** routes are not in `src/routeTree.gen.ts`; corresponding `src/routes/_app.recruiter.crm*.tsx` files are not on disk.

**Recommendation:** Merge or regenerate CRM route files, run dev/build so the TanStack router plugin updates `routeTree.gen.ts`, add CRM (and categories) to `src/components/shell/nav.ts` if product expects sidebar links.

### P1 — Invalid job id crashes job detail

**Steps:** Sign in as recruiter → open `/recruiter/jobs/abc` (non-existent / invalid id).

**Expected:** “Job not found” empty/error state inside the app shell.

**Observed:** React error boundary; console stack points at `RecruiterJobDetailsPage` accessing `.status` on undefined data (`_app.recruiter.jobs.$jobId.index.tsx`).

### P2 — Company page title vs nav label

Sidebar: **Company Profile**. In-page `PageHeader` title: **Profile**. Works functionally; naming is inconsistent for QA/docs.

### P2 — Console noise during audit

- HTTP **400** / **404** on some requests during job detail error path.
- Recommend re-test after job-not-found handling is fixed.

### P3 — Credentials in URL (one failed login attempt)

During a retry, navigation briefly hit `/auth?email=…&password=…` (query string). Sign-in should never put passwords in the URL. If reproduced manually, treat as auth/routing bug and rotate password if the URL was logged.

---

## Flows intentionally not run (avoid side effects)

| Flow | Reason |
|------|--------|
| Submit new job | Creates admin approval workload |
| Change applicant status / interviews | Mutates hiring pipeline + notifications |
| Delete or close job | Destructive |
| Edit company / contact save | Mutates production profile data |
| CRM campaigns send / Resend | External email side effects |
| Sign out (end of suite) | Would block subsequent checks in same script |

These should be added as isolated Playwright tests with fixtures or a dedicated test recruiter account.

---

## Coverage vs “don’t miss anything”

**Covered in browser (this report):** all **registered** recruiter routes, shell (sidebar, header search, profile menu, mobile sheet), auth redirect, jobs list UX, post-job validation, applicants filters/URL params, company profile read-only view, settings entry.

**Not available on this branch:** entire **CRM** subtree and **recruiter job categories** UI.

**Not deeply exercised:** real job detail/edit from list, applicant detail sheet, status pipeline actions, interview panel, job close/reopen/delete, company edit forms, notifications bell content, dashboard stat card links.

For CRM-specific cases (segments not-found, campaigns guards), see legacy artifacts:

- `docs/CRM_SEGMENTS_PLAYWRIGHT_FULL_UI_REPORT.md`
- `docs/CRM_SEGMENTS_PLAYWRIGHT_UI_TEST_REPORT.md`
- `docs/crm-*-playwright-*.png`

Re-run those after CRM routes exist on this branch.

---

## Pass/fail counts

- **Pass:** 15 automated checks  
- **Fail:** 6 (5 unregistered routes + 1 invalid job detail)  
- **Skipped / partial:** 2 (seeker guard, real job open from list)

---

*Generated from Playwright UI audit against local dev. No secrets are stored in this file.*
