# Recruiter AI Agent — full Playwright UI test report

**Date:** 2026-11-09  
**Route:** `/recruiter/agent`  
**Environment:** `http://127.0.0.1:8080` (`npm run dev`)  
**Tooling:** Playwright Chromium via `scripts/recruiter-agent-ui-audit.mjs`  
**Account:** Recruiter credentials from local `.env` (not stored here)  
**Mode:** **A — safe / read-mostly** (propose shortlist only; **no Confirm shortlist**; draft outreach with `confirmSend: false`; **no email send**)  
**Machine-readable:** `docs/recruiter-agent-ui-audit-results.json`

### Follow-up (2026-11-09 later) — P1–P3 fixes landed

| Finding | Fix |
|---------|-----|
| P1 misleading `via Supervisor` | Assistant turns use `source: "supervisor" \| "local"`; badge shows **via Supervisor** only for `askRecruiterAgent` paths, else **Local · owned data** |
| P2 starter never hit `list_jobs` | `isListJobsWithApplicantsQuestion` + intent order; starter lists jobs **with applicant counts** |
| P2 empty-job shortlist demo | Jobs query includes counts; list sorted with apps first; empty shortlist suggests jobs that have applicants |
| P3 toast / History label | Agent success toasts `duration: 2500`; audit waits for **Chat history**; prefers job with apps badge |

Re-audit after fix: **17 checks, 0 failed** (`docs/recruiter-agent-ui-audit-results.json`). Job title typos in DB remain out of scope.

---

## Executive summary

| Area | Result |
|------|--------|
| Auth guard (`/recruiter/agent` → `/auth`) | **Pass** |
| Page load + sidebar **AI Recruiter Agent** | **Pass** |
| Context strip (owned jobs / applicants search) | **Pass** |
| Starter chips (4) | **Pass** |
| Chat history rename / delete / New | **Pass** |
| Applicants header link | **Pass** |
| Mobile 390px | **Pass** |
| Draft outreach via Supervisor | **Pass** (editor + “not sent”) |
| Propose shortlist (empty job) | **Pass** (correct empty messaging) |
| Confirm shortlist (mutating) | **Not run** (Mode A) |
| **Multi-agent** | **Working for outreach; partially / misleading labels elsewhere** — see below |

Automated suite: **16 pass / 1 fail** (history label assertion mismatch only — product UI uses **“Chat history”**, not “History”).

---

## Multi-agent verdict

Production path: `askRecruiterAgent` → `invokeRecruiterAgentViaSupervisor` → `runSupervisor` → recruiter specialist (`shortlist` / `draft_outreach` / supervised NL).

| Flow | Evidence | Hits real Supervisor? | Verdict |
|------|----------|------------------------|---------|
| **Draft outreach** | Chat: “Outreach draft created… **VIA SUPERVISOR**”; **Outreach draft editor** with subject `Opportunity: senior labor`; toast “Outreach draft ready”; **Redraft via Supervisor** button; no send control | **Yes** (`runOutreach` → server fn) | **Working** |
| **Propose shortlist** (job with 0 applicants) | Reply: *“senior labor” is one of your owned jobs, but it has no applicants yet.* + VIA SUPERVISOR | Mostly **client** rank/empty path; server shortlist not needed when empty | **OK empty-state** |
| **List / show applicants** | Client intent handlers; still stamped **VIA SUPERVISOR** | **No** (local Supabase JWT lists) | **Label misleading** |
| **NL “Please shortlist…”** | Same empty-job message | Client shortlist intent | **Blocked by data** (no applicants on selected job) |
| Confirm shortlist bar | Not shown (no proposable applicant on selected job) | N/A | **Not exercised** |

**Bottom line:** The recruiter multi-agent stack **is working** for the critical mutating-gated specialist (**draft outreach through Supervisor, draft-only**). Several chat intents are **hybrid client routers** that still show **“via Supervisor”**, which overstates orchestration. Full shortlist propose→confirm needs a job **with** applicants (selected test job **senior labor** had none).

---

## How to re-run

```bash
npm run dev
npx playwright install chromium   # once
node scripts/recruiter-agent-ui-audit.mjs
```

Prefer `E2E_RECRUITER_EMAIL` / `E2E_RECRUITER_PASSWORD`. Informal `.env` lines `recuiter email:` / `recuiter password:` also work locally.

---

## Test matrix

| ID | Scenario | Result | Notes |
|----|----------|--------|-------|
| AUTH-01 | Signed-out → agent | **Pass** | Redirect `/auth` |
| RA-01 | Page load | **Pass** | Heading, context, chat, “Actions run via Supervisor” |
| RA-02 | Sidebar link | **Pass** | AI Recruiter Agent active |
| RA-03 | History chrome | **Fail (test)** | Expected “History”; UI says **“Chat history”** |
| RA-04 | Select owned job | **Pass** | e.g. senior labor |
| RA-05 | Applicants context | **Pass** | Empty for selected job; cross-job search exercised |
| RA-06 | Four starters | **Pass** | |
| MA-01 | List my jobs with applicants | **Pass*** | See issue: intent → applicants empty, not job list |
| MA-02 | Show applicants for this job | **Pass** | “No applicants found…” |
| MA-03 | Propose shortlist (no confirm) | **Pass** | Empty-job message; Confirm bar not shown |
| MA-04 | Draft outreach | **Pass** | Draft editor + subject; no send button |
| MA-05 | NL shortlist | **Pass** | Empty-job guidance |
| RA-07 | Rename / delete history | **Pass** | |
| RA-08 | New conversation | **Pass** | |
| RA-09 | Applicants link | **Pass** | |
| RA-10 | Mobile | **Pass** | |
| RA-11 | Copy draft | **Pass** | Draft editor not always still open after nav; no crash |

\*Pass = UI responded; product intent quality is flagged under Issues.

---

## Screenshots

| File | Shows |
|------|--------|
| `recruiter-agent-playwright-empty.png` | Initial agent page |
| `recruiter-agent-playwright-jobs.png` | Owned jobs context |
| `recruiter-agent-playwright-applicants.png` | Applicants empty / selection |
| `recruiter-agent-playwright-list-jobs.png` | List starter reply |
| `recruiter-agent-playwright-show-apps.png` | Show applicants reply |
| `recruiter-agent-playwright-shortlist-propose.png` | Propose shortlist empty-job |
| `recruiter-agent-playwright-outreach.png` | **Draft outreach + editor (Supervisor)** |
| `recruiter-agent-playwright-nl-shortlist.png` | NL shortlist empty-job |
| `recruiter-agent-playwright-mobile.png` | Narrow viewport |

---

## Issues found

### P1 — “via Supervisor” on client-only replies

Many intents (`list_jobs`, `list_applicants`, help, local browse/shortlist ranking messages) append assistant turns with `viaSupervisor: true` **without** calling `askRecruiterAgent` / `runSupervisor`.

**Impact:** Users (and QA) cannot tell real multi-agent server turns from local helpers. Undermines Track 3 demo honesty.

**Suggestion:** Only set `viaSupervisor` when the server Supervisor actually ran; otherwise label e.g. “Local · owned jobs” / omit the badge.

### P2 — Starter “List my jobs with applicants” does not list jobs

**Observed:** Reply was applicants empty-state (“No applicants found for the current filter…”), not the owned-jobs enumeration from `formatOwnedJobsReply`.

**Likely cause:** `detectRecruiterChatIntent` classifies the phrase toward `list_applicants` because it contains “applicants”.

**Suggestion:** Prefer `list_jobs` when the phrase leads with “list my jobs”, or return both sections (jobs + applicant counts).

### P2 — Shortlist confirm path hard to demo on this account’s first job

Selected job **senior labor** has **zero** applicants. Propose shortlist correctly refuses, so Mode A never shows the sticky **Confirm shortlist** bar.

**Suggestion for QA:** Select a job that already has applicants (or seed one) before claiming end-to-end shortlist multi-agent.

### P3 — Job title data quality

Owned titles visible in UI: **“AI enginners”**, **“TEst”**, **“marketing Head”** — typos/casing hurt search matching and demos.

### P3 — Toast linger / overlap

“Outreach draft ready” toast still visible during later shortlist chats in screenshots — noisy but non-blocking.

### P3 — Automated check brittle on “History” label

Product copy is **Chat history** (CSS uppercase). Update selectors accordingly (script assertion only).

---

## What was intentionally not done

| Action | Why |
|--------|-----|
| **Confirm shortlist** | Writes pipeline status + notifications (Mode B) |
| Email / campaign **send** | Page is draft-only; `confirmSend: false` |
| Cross-tenant ownership attack | Needs second recruiter account |
| CRM deep-link after draft | Out of this page’s primary scope |

---

## Coverage vs “don’t miss anything”

**Covered in browser:** auth gate, nav, context job/applicant pickers, starters, chat send, list/show/propose/draft/NL shortlist, history CRUD, New, Applicants link, mobile, draft editor presence, absence of send-email controls, Supervisor badge on replies.

**Not fully covered:** Confirm shortlist happy path, Select/resume from applicant-choice cards (needs applicants), Redraft via Supervisor button click persistence after navigation, clipboard copy success assertion, seeker-role forbidden check on this page.

---

## Pass / fail snapshot

- **Automated:** 16 pass, 1 fail (label mismatch)  
- **Multi-agent:** **Working** for outreach specialist; **partial** for shortlist (data-limited); **misleading** Supervisor labeling on local intents  
- **Product issues to fix:** viaSupervisor honesty, list-jobs starter intent, seed/demo job with applicants  

---

*Generated from Playwright UI audit against local dev. No secrets are stored in this file.*
