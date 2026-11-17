# Multi-Agent System — Root Cause Investigation & Fixes

**Date:** 2026-11-17  
**Scope:** Supervisor / Discovery / Application (Save + Apply)  
**Constraint:** No schema/migrations, no `.env` changes, no commit/push in this task

---

## 1. Exact root causes

### A. Application Agent never received the turn (primary UX failure)

`looksLikeApplyIntent` / `looksLikeSaveJobIntent` required both an action verb **and** words like `job|role|this|that|it`.

| User said | Matched? | What happened |
|---|---|---|
| `apply Software Engineer` | **No** (no “job”) | Fell through to **legacy Gemini** → generic “click Apply on the job page” |
| `saved first one` | **No** (`saved` ≠ `\bsave\b`) | Same legacy advice path |

So tools were **not executed**; the model only described UI steps. That matches the screenshots.

### B. Confirm Apply could not succeed even when routed

`runApplicationAgent` on `confirm: true` required a `coverNote` ≥ 10 characters. The seeker UI Confirm button only sends `confirmApply` + `applyJobId` — **no cover note**. Confirmed applies failed validation every time.

### C. Resume was not gated

Confirm could proceed without a resume on the profile. Spec requires asking the user to upload a resume when missing.

### D. Weak conversational job resolution

- “this one” / “that job” did not map to the first Discovery card.
- Title match ran, but demonstratives did not fall back to recent cards.
- Save phrases like “keep this” / “I like the second job” were not treated as Save intent.

### E. Noisy Discovery intent gaps (secondary)

- `finace job` failed industry intent because typo correction ran in ILIKE parsing but **not** in `normalizeLiveJobQuestion` used by intent.
- Some conversational industry asks needed broader patterns (`software work`, `related to programming`, fresher/vacancy phrasing).

### F. What was already working

- Discovery **does** call live approved job retrieval (not invented jobs).
- Supervisor **does** call Save/Apply tools when intent matches.
- Shared memory stores recent live job cards after Discovery.
- UI passes `recentJobs` from the last turn’s live citations into the next ask.
- Confirm-to-apply (propose → Confirm) is intentional — the agent must not silently insert.

---

## 2. What was broken (symptom summary)

1. Multi-agent looked “dumb” because Application routing missed natural phrases → legacy text.
2. Save/Apply appeared broken even after routing fixes, because Confirm lacked cover note + resume checks.
3. Follow-up “save/apply this/first/title” could not always resolve a DB job id.

---

## 3. What we changed

| Area | Change |
|---|---|
| Apply/Save intent | Accept `saved`, title-after-apply, keep/like/bookmark conversational forms |
| Job id resolution | Ordinal → fuzzy title → `this/that/it` → first recent card |
| Apply confirm | Default cover note **only after Confirm**; require profile name/email; **require resume file** |
| Propose message | Warn when no resume is on file |
| Query normalize | Typo correction (`finace`→`finance`) inside `normalizeLiveJobQuestion` |
| Industry intent | Broader patterns for software work / related-to / fresher / vacancy |
| Tests | New `multi-agent-workflow.test.ts` end-to-end style Supervisor tool tests |

---

## 4. Files / functions modified

- `src/lib/ai/agents/application.ts` — intent, `extractApplyJobId`, `runApplicationAgent`
- `src/lib/ai/live-query-understand.ts` — normalize typos + industry ask patterns
- `src/lib/ai/assistant-intent.ts` — fresher/vacancy vacancy patterns
- `src/test/multi-agent-workflow.test.ts` — **new**
- `src/test/phase7-agents.test.ts` / `phase7-application-tools.test.ts` — intent examples

---

## 5. How Discovery / Save / Apply work now

### Discovery

1. Supervisor classifies job-search (including noisy industry asks).  
2. Discovery calls `listLiveJobs` (JWT approved jobs) + optional corpus (context only).  
3. Live cards remembered in server memory + returned as citations (never invented).

### Save

1. Intent: save/saved/bookmark/keep/like + context.  
2. Resolve job id from `recentJobs` / memory (first / second / title / this).  
3. Call real `runSaveJobTool` → DB `saved_jobs`.  
4. Success message only after tool `ok: true`.

### Apply

1. Intent: apply + job/title/ordinal/this.  
2. Resolve job id the same way.  
3. **Propose** (`confirm: false`) → Confirm chip; no insert.  
4. **Confirm** → require name, email, resume on profile; default cover note if UI omitted one; call `applyToJob`; report created / already_applied / real errors.

---

## 6. Resume handling

- On propose: message states whether a resume is on file.  
- On confirm: if neither `resume_storage_path` nor `resume_url` → **validation error**, no insert.  
- Storage path still must belong to the seeker’s folder when present.

---

## 7. Test results

### Automated (Vitest)

- `multi-agent-workflow.test.ts` — final verification block (noisy Discovery, save this one + DB store, apply propose, resume gate, confirm insert, ordinals)
- `phase7-agents` / `phase7-application-tools`

**39/39 passed** in the focused re-run.

### Live UI + DB (2026-11-17 local)

Script: `scripts/multi-agent-final-ui-verify.mjs` + `scripts/multi-agent-final-db-verify.mjs`

| Check | Result |
|---|---|
| Noisy search `finace job` / `find me it job` | Pass (Discovery UI) |
| `save this one` | Pass — UI “Saved … bookmarks” |
| DB `saved_jobs` | Pass — **Junior Software Developer** + **Software Engineer Intern** rows |
| `apply for this job` | Pass — Confirm chip; no silent submit |
| Resume missing | Pass — asked to upload before confirm |
| Confirm insert (live) | Skipped (avoid prod write); **Pass** via instrumented DB unit test |
| `save the second job` | Pass — second title saved + DB verified |

Artifacts: `docs/multi-agent-final-ui-verify.png`, `docs/multi-agent-final-ui-verify.json`, `docs/multi-agent-final-db-verify.json`

---

## 8. Remaining limitations

- Intent is still **rule + heuristic** (not a trained NLU model); unusual phrasings can miss.
- Live search is ILIKE + synonym expansion, not full semantic re-rank for every query.
- Default cover note on Confirm is generic (UI still does not collect a custom About-you).
- Apply from chat requires resume on **profile** (attachment in chat is not auto-wired as the apply resume in this path).
- Path B durable memory still needs approved migration apply for cross-restart persistence.
- No production DB writes / migrations performed in this task.

---

## How to verify in the UI

1. Soft-refresh `/seeker/assistant`.  
2. Ask a noisy search (e.g. `finace job` / `find me it job`).  
3. `saved first one` → should show real Save outcome (not dashboard instructions).  
4. `apply Software Engineer` → Confirm chip → with resume on profile, Confirm inserts; without resume, clear upload message.
