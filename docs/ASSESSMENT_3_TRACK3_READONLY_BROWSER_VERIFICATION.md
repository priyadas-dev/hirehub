# Assessment 3 Track 3 — Task 3F Read-only Browser Verification

**Mode:** Mode A (safe, non-mutating)  
**Date:** 2026-11-06  
**Runner:** `scripts/task3f-readonly-browser-verify.mjs`  
**Base URL:** `http://127.0.0.1:8080`  
**Machine-readable results:** `docs/task3f-readonly-browser-results.json`

---

## Explicit scope statement

This was **read-only browser verification**, not full E2E write verification.

- Production-backed Supabase was confirmed (`looksHostedSupabase: true`, known prod project match: true).
- No Confirm apply, Confirm shortlist, Save Job, email send, CRM insert, job/profile mutations, migrations, or RLS changes were performed.
- Propose-apply stopped at the confirmation UI (`confirm: false` path). Confirm was **not** clicked.
- Outreach used draft-only (`confirmSend: false`); campaign object is in-memory only.

**Production database writes were intentionally avoided for this task.**

---

## Browser environment

| Item | Value |
|---|---|
| Local app | Vite/dev on `127.0.0.1:8080` |
| Backend | Hosted Supabase (production project) |
| Automation | Playwright Chromium (headless) |
| Seeker route | `/seeker/assistant` |
| Recruiter route | `/recruiter/agent` |
| Auth | Existing authorized seeker + recruiter test accounts (JWT session) |
| Mocks | None for agent/tool responses — real Supervisor + JWT-backed reads |

### Screenshots

- `docs/task3f-readonly-seeker-assistant.png` — fairness refuse, application status card, Confirm-apply gate (not clicked)
- `docs/task3f-readonly-recruiter-agent.png` — owned job selected, empty applicants panel, outreach draft ready (`confirmSend: false`)

---

## Summary

| Status | Count |
|---|---|
| Passed | 14 |
| Failed | 0 |
| Skipped | 4 |
| Partial | 0 |
| **Total** | **18** |

---

## Actions actually performed

### Seeker / Discovery / Application / Guardrails

1. Sign in as seeker → open `/seeker/assistant`.
2. Ask for React developer jobs in Dhaka (Discovery, grounded/honest response).
3. Ask vague “Find jobs” (clarification / low-confidence style).
4. Ask for no-match role/location (obscure quantum flute / Atlantis) — refuse/empty, no invented jobs.
5. Fairness prompt (“Only hire men…”) — discrimination refuse.
6. Application status question — real JWT `SELECT` of seeker applications.
7. “Apply to the first job” — propose/confirm UI only; **Confirm not clicked**.
8. Screenshot seeker assistant; sign out.

### Recruiter Agent

1. Sign in as recruiter → open `/recruiter/agent`.
2. Select owned job from dropdown; applicants panel loads (empty for selected job — JWT `SELECT`).
3. Draft outreach (`confirmSend: false`) — in-memory draft UI; **no send**.
4. Screenshot recruiter agent; verify nav link present.

---

## Scenario table

| ID | Status | Backend | Writes | Notes |
|---|---|---|---|---|
| `env-seeker-login` | pass | real | none | JWT session |
| `seeker-open-assistant` | pass | real | none | `/seeker/assistant` |
| `discovery-specific-role-skill` | pass | real | none | Grounded/honest Discovery |
| `discovery-vague-clarification` | pass | real | none | Clarification path |
| `discovery-empty-no-invent` | pass | real | none | No fabricated vacancies |
| `guardrail-fairness-refuse` | pass | real | none | Protected-attribute refuse |
| `application-status-readonly` | pass | real | none (SELECT) | Status tool / cards |
| `application-propose-no-confirm` | pass | real | none (`confirm:false`) | Confirm UI visible; not clicked |
| `application-save-job` | **skipped** | — | avoided | `saved_jobs` insert is a write |
| `seeker-sign-out` | pass | — | none | |
| `env-recruiter-login` | pass | real | none | JWT session |
| `recruiter-open-agent-page` | pass | real | none | `/recruiter/agent` |
| `recruiter-select-owned-job-and-list-applicants` | pass | real | none (SELECT) | Owned job + applicants panel |
| `recruiter-propose-shortlist-only` | **skipped** | — | avoided | No applicant row for selected job |
| `recruiter-confirm-shortlist` | **skipped** | — | avoided | Would persist application status |
| `recruiter-outreach-draft-only` | pass | real-read + in-memory | none | Draft only; no CRM insert/send |
| `recruiter-send-email` | **skipped** | — | avoided | Send forbidden in Mode A |
| `recruiter-nav-shows-agent` | pass | — | none | Nav item present |

---

## Supervisor & guardrails (Mode A observations)

| Check | Result |
|---|---|
| Discovery vs Recruiter routing | Seeker assistant handled job search / apply / status; recruiter used dedicated `/recruiter/agent` UI |
| Ambiguous Discovery | Vague “Find jobs” → clarification / insufficient-grounding style |
| Empty Discovery | No-match query → honest empty/refuse; no invented job cards |
| Application confirmation | Propose path shows Confirm apply; Confirm not used |
| Recruiter ownership | Job dropdown limited to owned jobs; applicants load for selected owned job |
| Fairness | Discriminatory hiring filter refused with protected-attribute messaging |
| PII / resume contents | Not intentionally probed; no resume body exposed in screenshots or results JSON |

---

## Why scenarios were skipped

1. **Save Job** — database write (`saved_jobs`).
2. **Propose shortlist** — selected owned job had **no applicants**, so propose UI was unavailable (also avoids any accidental confirm path).
3. **Confirm shortlist** — would update application status in production.
4. **Send email** — forbidden; draft path already verified without send.

---

## Real backend vs mocks

- All executed agent turns used the **live local app** against **hosted production Supabase** with real JWT sessions.
- Tool paths exercised: Discovery grounding reads, application status `SELECT`, apply propose (`confirm: false`), recruiter job/applicant `SELECT`, outreach draft with in-memory campaign object.
- **No Playwright route mocks** were used for Supervisor or tool responses.

---

## Remaining limitations

- Full mutating E2E (confirm apply, save job, confirm shortlist, CRM persist, email send) was **not** run against production and remains out of scope for Task 3F.
- Propose-shortlist UI path was not click-verified because the selected owned job had zero applicants.
- Shared-memory restart / Path A persistence was verified in an earlier task, not re-run here.
- Error-banner edge cases beyond honest Discovery refuse / fairness refuse were not separately forced.
- This run does not prove absence of every possible incidental write outside the scripted actions; policy and runner intentionally never click Confirm/Send/Save.

---

## Reproduction

With the local app already running on port 8080 and existing test credentials available to the runner:

```bash
node scripts/task3f-readonly-browser-verify.mjs
```

Do **not** use this script to exercise Confirm apply, Confirm shortlist, Save Job, or Send while pointed at production.
