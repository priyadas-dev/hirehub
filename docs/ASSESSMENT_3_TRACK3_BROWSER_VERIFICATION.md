# Assessment 3 Track 3 — Task 3F Browser Verification

**Task:** 3F Safe Read-only Browser Verification  
**Mode:** Mode A (non-mutating)  
**Run date:** 2026-11-09  
**Runner:** `scripts/task3f-readonly-browser-verify.mjs`  
**Base URL:** `http://127.0.0.1:8080` (local Vite)  
**Machine-readable results:** [`task3f-readonly-browser-results.json`](./task3f-readonly-browser-results.json)  
**Prior Mode A report (2026-11-06):** [`ASSESSMENT_3_TRACK3_READONLY_BROWSER_VERIFICATION.md`](./ASSESSMENT_3_TRACK3_READONLY_BROWSER_VERIFICATION.md)

---

## 1. Production connection inspection (read-only)

| Check | Result |
|---|---|
| Playwright setup | `playwright.config.ts` + `scripts/task3f-readonly-browser-verify.mjs`; Chromium installed for this run |
| Local app | `npm run dev` → Vite on port **8080** |
| Supabase target | `.env` `VITE_SUPABASE_URL` / project id resolve to **hosted** `*.supabase.co` |
| Known prod project match | **true** (`matchesKnownProdProject: true` in results JSON) |
| Safe to run mutating E2E? | **No** — same project is production-backed |
| Mode used | **Mode A only** — propose / draft / SELECT paths; no Confirm / Save / Send |

**Conclusion:** The local app **can** connect to the existing production Supabase project. That is why this task stays read-only: mutating browser flows would write real application/pipeline/CRM/email side effects.

**No `.env` edits, migrations, RLS changes, or application code changes were made for this task.**

---

## 2. Explicit safety policy (what was never done)

- No Confirm apply  
- No Confirm shortlist  
- No Save Job (`saved_jobs` insert)  
- No outreach email send  
- No resume upload / delete / modify  
- No CRM record create/update  
- No schema / migration / RLS changes  
- No commit / push  
- No fake test users created  

---

## 3. Live browser run summary (2026-11-09)

| Status | Count |
|---|---|
| Passed | **14** |
| Failed | **0** |
| Skipped | **4** |
| Partial | **0** |
| **Total** | **18** |

`generatedAt`: `2026-11-09T05:01:51.457Z`

### Screenshots (this run)

| File | Content |
|---|---|
| [`docs/task3f-readonly-seeker-assistant.png`](./task3f-readonly-seeker-assistant.png) | Seeker AI Job Assistant after Discovery / fairness / status / propose-apply |
| [`docs/task3f-readonly-recruiter-agent.png`](./task3f-readonly-recruiter-agent.png) | Recruiter Agent page after owned-job select + outreach draft |

---

## 4. Exact checks performed

### Passed — live browser (real JWT + production-backed reads)

| ID | What was verified |
|---|---|
| `env-seeker-login` | Existing seeker account sign-in; JWT session |
| `seeker-open-assistant` | `/seeker/assistant` loads (Discovery / Application UI) |
| `discovery-specific-role-skill` | “Find React developer jobs in Dhaka” → grounded/honest Discovery response |
| `discovery-vague-clarification` | “Find jobs” → clarification / low-confidence style |
| `discovery-empty-no-invent` | No-match query → honest empty/refuse; no invented vacancies |
| `guardrail-fairness-refuse` | Discriminatory prompt refused |
| `application-status-readonly` | Application status question → JWT-scoped status UI/text (SELECT only) |
| `application-propose-no-confirm` | Propose apply / confirm gate shown; **Confirm not clicked** |
| `seeker-sign-out` | Clean session switch |
| `env-recruiter-login` | Existing recruiter account sign-in |
| `recruiter-open-agent-page` | `/recruiter/agent` loads |
| `recruiter-select-owned-job-and-list-applicants` | Owned job dropdown + applicants panel (JWT SELECT) |
| `recruiter-outreach-draft-only` | Draft outreach UI; `confirmSend: false` / in-memory draft; **no send** |
| `recruiter-nav-shows-agent` | AI Recruiter Agent nav present |

### Skipped — would write or was unavailable without writes

| ID | Why skipped |
|---|---|
| `application-save-job` | Would `INSERT` into `saved_jobs` |
| `recruiter-propose-shortlist-only` | No applicant row on selected owned job (propose UI unavailable); also avoids accidental confirm path |
| `recruiter-confirm-shortlist` | Would persist application status (+ possible notifications) |
| `recruiter-send-email` | External / CRM side effect forbidden in Mode A |

### Failed

None.

---

## 5. Evidence classification

### A. Actual live browser verification (this task)

- Playwright Chromium against local app on `127.0.0.1:8080`  
- Real seeker + recruiter JWT sessions against **production-backed** Supabase  
- Results JSON + screenshots listed above  
- No Playwright response mocks for Supervisor / agent tools  

### B. Existing unit-test evidence (not re-run as the primary 3F proof)

Prior Track 3 Vitest coverage remains valid for:

- Supervisor seeker + recruiter routing  
- Confirm-to-apply gate / idempotency helpers  
- Save Job / Check Status tools + pagination / ownership isolation  
- Shared memory isolation + PII redaction  
- Fairness / confidence guardrails  

Representative files: `src/test/phase6-agents.test.ts`, `phase6-shared-memory.test.ts`, `phase7-agents.test.ts`, `phase7-recruiter-supervisor.test.ts`, `phase7-application-tools.test.ts`, `ask-job-assistant-supervisor.test.ts`, `assistant-tool-outcomes.test.tsx`.

### C. Mocked / policy-mirror evidence

- Resume ACL **policy mirror** unit tests (`resume-access`) — not re-validated in this browser pass  
- Idempotent apply UNIQUE / concurrency docs remain separate from Mode A browser  

### D. Unverified production behavior (still out of Mode A)

| Behavior | Status |
|---|---|
| Confirm apply insert on production | **Unverified** (intentionally not clicked) |
| Save Job write | **Unverified** (skipped) |
| Confirm shortlist status update + notify | **Unverified** (skipped) |
| Outreach email send / CRM persist | **Unverified** (skipped) |
| Propose-shortlist UI with a real applicant selected | **Not click-verified** this run (no applicant on selected job) |
| Mutating E2E on isolated non-prod DB (Mode B) | **Not run** |

---

## 6. Reproduction

1. Start app: `npm run dev` (port 8080).  
2. Ensure existing seeker/recruiter credentials are available to the runner (env or local `.env` labels — **do not commit secrets**).  
3. Run:

```bash
node scripts/task3f-readonly-browser-verify.mjs
```

4. Inspect `docs/task3f-readonly-browser-results.json` and the two PNG screenshots.

**Do not** point this script at production and then click Confirm apply / Confirm shortlist / Save / Send.

---

## 7. Remaining limitations

1. Full mutating E2E still requires a **non-production** Supabase project/branch (Mode B).  
2. Propose-shortlist click path was skipped (no applicants on the selected owned job).  
3. Mode A cannot prove Confirm/Save/Send correctness on live data.  
4. This run does not re-prove Shared Memory restart durability or Path B `agent_sessions`.  
5. Incidental writes outside scripted actions are not exhaustively audited; the runner never clicks Confirm/Send/Save by design.

---

## 8. Task 3F completion verdict

| Criterion | Met? |
|---|---|
| Inspect Playwright + production-backed connection | **Yes** |
| Safe read-only browser checks for Discovery / clarify / propose-apply / recruiter page / draft | **Yes** |
| Skip mutating / external side effects with documented reasons | **Yes** |
| No fake users / no production writes intentionally performed | **Yes** |
| Record results + screenshots + evidence classification | **Yes** |
| This report file created/updated | **Yes** |

**Task 3F (Mode A safe read-only browser verification) can be marked complete.**

Mode B mutating browser proof against an isolated database remains a separate, optional follow-up — not part of this task.
