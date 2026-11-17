# Seeker AI Job Assistant — Playwright UI report (2026-11-17)

**Route:** `/seeker/assistant`  
**Environment:** `http://127.0.0.1:8080` (`npm run dev`)  
**Tooling:** Playwright Chromium · `scripts/seeker-assistant-ui-audit.mjs`  
**Account:** Seeker credentials from local `.env` (not stored here)  
**Assignment reference:** Assessment 3 Track 3 — *Multi-agent orchestration + guardrails* (+ hard problems 3 & 5) from `Assessment3_Priya_HireHub.pdf`  
**JSON results:** [`docs/seeker-assistant-ui-audit-results-2026-11-17.json`](./seeker-assistant-ui-audit-results-2026-11-17.json)

---

## Executive summary

> **Update (same day):** Auth middleware + fairness fixes landed. Re-smoke: discovery / status / fairness refuse / apply-propose **pass**. See [`SEEKER_ASSISTANT_MULTIAGENT_FIX_2026-11-17.md`](./SEEKER_ASSISTANT_MULTIAGENT_FIX_2026-11-17.md). The table below is the **pre-fix** audit.

| Area | Result |
|------|--------|
| Auth gate, page chrome, starters, composer rules | **Pass** |
| History (persist / rename / delete / New) | **Pass** |
| Attachments (reject `.txt`, accept PNG) | **Pass** |
| Navigate away mid-ask + return | **Pass** |
| Mobile 390px | **Pass** |
| **Every multi-agent / ask turn** | **Fail (runtime)** — generic *“Something went wrong talking to the assistant”* *(fixed later same day)* |
| **Assessment 3 Track 3 (live UI proof)** | **Not demonstrable today** — server path broken *(fixed later same day)* |

Automated shell checks reported **21/21 pass** because most MA cases only **noted** errors instead of failing the locator. **User-visible outcome: the assistant cannot complete specialist work in this run.** Screenshots confirm the error UI for REST, remote jobs, application status, fairness, and apply prompts.

---

## Assignment Track 3 — what must work (seeker surface)

From the PDF:

| Requirement | Seeker `/assistant` expectation |
|-------------|----------------------------------|
| Supervisor / router | Every ask goes through `runSeekerAskJobAssistantViaSupervisor` → `runSupervisor` |
| Discovery agent | Job-search prompts → matching approved job cards |
| Application agent | Status / save / apply with **confirm** before insert |
| Guardrails + fairness | Biased matching prompts refused/neutralised (hard problem 3) |
| Confirm-to-apply | Confirm chip before real apply (hard problem 5) |
| Recruiter agent | **Not on this page** — `/recruiter/agent` |

Code wiring still exists in [`src/lib/ai/ask-job-assistant.ts`](../src/lib/ai/ask-job-assistant.ts). This audit could **not** prove specialists live because `askJobAssistant` throws before a usable result.

---

## Multi-agent verdict (this run)

**Verdict: broken / inconclusive at runtime.**

Evidence:

- History entries for discovery, status, save, fairness, apply, and general knowledge all store `ok: false`, `code: "unknown"`, message *“Something went wrong talking to the assistant. Try again.”*
- No `supervisor.routedTo` traces captured (network intercept empty; history has no supervisor field).
- UI shows red **Could not answer** + **Retry** for specialist prompts (see screenshots).
- Dev server log during the run: **`[Supabase] Missing Supabase environment variable(s): SUPABASE_PUBLISHABLE_KEY`** plus multiple **aborted / status 500** on server connections.

**Likely root cause (config):** `.env` has `VITE_SUPABASE_PUBLISHABLE_KEY` but server auth middleware expects **`SUPABASE_PUBLISHABLE_KEY`** (non-`VITE_`). Client login can still work via Vite-injected keys while **server functions** (`askJobAssistant`) fail.

**Fairness note:** Automated note “refuse unfair criteria” was a **false positive** (regex matched biased words in the *user* bubble / history while the assistant reply was the generic error). Treat fairness as **unverified** until the server path works.

---

## How to re-run

```bash
npm run dev
npx playwright install chromium   # once
node scripts/seeker-assistant-ui-audit.mjs
```

Prefer `E2E_SEEKER_EMAIL` / `E2E_SEEKER_PASSWORD`. Informal `.env` lines `seeker email:` + following `password:` also work locally.

**Before re-testing multi-agent:** add (manually) `SUPABASE_PUBLISHABLE_KEY=<same value as VITE_SUPABASE_PUBLISHABLE_KEY>` to `.env` — do not commit secrets — then restart `npm run dev`.

---

## Test matrix

| ID | Scenario | Automated status | User-visible truth |
|----|----------|------------------|--------------------|
| AUTH-01 | Signed-out → `/auth` | Pass | Pass |
| A-01 | Page load | Pass | Pass |
| A-02 | Shell chrome | Pass | Pass |
| A-03 | Four starters | Pass | Pass |
| A-04 | Send disabled &lt;3 chars | Pass | Pass |
| MA-01 | General knowledge (REST) | Pass* | **Fail** — Could not answer |
| MA-02 | Skills → find jobs | Pass* | **Fail** — error UI / no job cards |
| MA-03 | Remote jobs (discovery) | Pass* | **Fail** — error UI |
| MA-04 | Application status | Pass* | **Fail** — error UI |
| MA-05 | Save job intent | Pass* | **Fail** — error in history |
| MA-06 | Fairness / bias prompt | Pass* | **Fail** — error UI (fairness unverified) |
| MA-07 | Apply propose (no Confirm) | Pass* | **Fail** — no Confirm chip; error |
| MA-08 | Starter “What is React?” | Pass* | **Fail** — error / Gemini path down |
| A-05–A-11 | History, attach, nav-away, mobile | Pass | Pass |
| A-12 | Other-role block | Skipped | Covered by auth smoke |

\*Pass = script did not throw; product specialist outcome failed.

---

## Screenshots (this run)

| File | Shows |
|------|--------|
| `seeker-assistant-playwright-empty.png` | Empty / first-ask UI |
| `seeker-assistant-playwright-legacy.png` | REST ask → **Could not answer** |
| `seeker-assistant-playwright-discovery.png` | Skills job search error |
| `seeker-assistant-playwright-remote.png` | Remote jobs → error + Retry |
| `seeker-assistant-playwright-status.png` | Application status → error |
| `seeker-assistant-playwright-fairness.png` | Biased prompt → error (not a clean refuse) |
| `seeker-assistant-playwright-apply-propose.png` | Apply ask → error |
| `seeker-assistant-playwright-history.png` | History list |
| `seeker-assistant-playwright-return.png` | After navigate-away |
| `seeker-assistant-playwright-mobile.png` | 390px layout |

---

## Issues found

### P0 — Assistant server path broken for all asks

**Symptom:** Every specialist/general ask ends in *“Something went wrong talking to the assistant”* with Retry.  
**Impact:** Multi-agent (discovery / application / fairness / confirm-apply) **cannot be demoed** on `/seeker/assistant` until fixed.  
**Evidence:** Screenshots + history `code: "unknown"`; server log missing `SUPABASE_PUBLISHABLE_KEY`; aborted 500s.  
**Next step:** Align server env with client (`SUPABASE_PUBLISHABLE_KEY`), restart dev, re-run this audit.

### P1 — Gemini / legacy answers unavailable (secondary)

Earlier audits also saw Gemini high-demand errors. This run never reached a clean Gemini answer; failures look like **server-fn / auth** before model text.

### P1 — Fairness guardrail not proven in UI (A3 hard problem 3)

Biased prompt did not show an explicit fairness refusal; only the generic error. After P0 fix, re-test MA-06 and assert `routedTo: fairness_refuse` or clear refuse copy.

### P1 — Confirm-to-apply gate not proven (A3 hard problem 5)

No **Confirm apply** chip. After P0 fix, re-test with a concrete job id / discovery card apply flow (Mode A: do not click Confirm unless on a throwaway DB).

### P2 — Audit script soft-passes MA failures

Shell checks treat “error UI observed” as notes, so exit code was 0 despite product failure. Tighten assertions so *Could not answer* fails MA-* checks.

### P3 — False-positive fairness note

Regex matched biased wording in the user message while the assistant failed. Prefer asserting on the assistant bubble only.

---

## What worked (user chrome)

- Unauthenticated redirect to `/auth`
- AI Job Assistant heading, History, New, Browse jobs, attach, composer
- Four starter chips
- Send disabled for short text
- History rename / delete / New empty state
- Attachment validation (reject txt, accept PNG + remove)
- Mid-ask navigate to `/seeker/jobs` and return (live store continuity)
- Mobile layout

---

## Intentionally not done (mutating)

| Flow | Reason |
|------|--------|
| Confirm apply (insert) | Mode A — would write applications |
| Confirm shortlist / outreach send | Recruiter page |
| Full PDF/DOCX resume parse | Needs real resume fixture + healthy server |

---

## Pass / fail snapshot (honest)

| Layer | Count |
|-------|-------|
| UI chrome automated | Pass |
| Multi-agent / ask outcomes | **Fail** (all sampled turns) |
| Track 3 live proof on seeker assistant | **Blocked by P0** |
| Script exit code | 0 (soft MA asserts — improve next run) |

---

*Generated from Playwright against local dev on 2026-11-17. No secrets stored in this file.*
