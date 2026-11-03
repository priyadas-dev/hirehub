# Assessment 2 — Verification checklist

Use this sheet for manual demos and submission evidence. Mark **Pass / Fail / Pending** only after you perform the step. Do not mark browser items from unit tests alone.

Deploy steps: [`deploy-assessment-2.md`](./deploy-assessment-2.md).

## Environment prerequisites

- [ ] Local `.env` has `GEMINI_API_KEY`, `SUPABASE_*`, `EMBEDDING_PROVIDER=gte` (server keys never `VITE_`)
- [ ] Signed in as a **seeker** for assistant tests
- [ ] Recruiter + admin accounts available for automation demos
- [ ] At least one seeker profile has non-empty `skills` (e.g. `React, SQL`) for skill-match demo
- [ ] `npm run dev` running (or deployed demo URL filled below)

| Field | Value |
|-------|--------|
| Demo URL | |
| Date verified | |
| Verifier name | |

## Measured backend metrics (reconfirm with commands)

| Check | Command / query | Expected (last measured) | Actual | Pass? |
|-------|-----------------|--------------------------|--------|-------|
| Corpus size | SQL count `job_corpus` where `job_id` is null | 5000 | | |
| gte embeddings | count `embedding_gte` not null | 5000 | | |
| Legacy 768 | count `embedding` not null | 1015 | | |
| Provider | `EMBEDDING_PROVIDER` | `gte` | | |
| Classifier (NB) | `npm run rag:classify` | ≥70% held-out; last run **95.28%** acc / macro F1 **0.937** (3814/1186, seed 42, template_group) | | |
| Classifier compare | `scripts/rag/out/classifier-compare.json` | NB + TF-IDF+LogReg; per-class P/R/F1 + confusion matrices | | |
| Confusion matrix | `scripts/rag/out/classifier-eval.json` | exists (regenerate locally; `scripts/rag/out/` is gitignored) | | |
| RAG eval | `npm run rag:eval -- --provider=gte` | cases + clean-vs-noisy table | | |
| Clean vs noisy | `scripts/rag/out/clean-vs-noisy.md` | exists after eval; ≥12 pairs | | |
| Hybrid FTS | apply `PROPOSED_0018_job_corpus_fts.sql` | `search_job_corpus_fts` + `search_tsv` | | |
| Unit tests | `npm test` | all pass | | |
| Build | `npm run build` | succeeds | | |
| E2E (optional) | `npm run test:e2e` | skips without `E2E_SEEKER_*` | | |

**Classifier caveat:** Scores are on **synthetic** text with template-group splits (zero group overlap in last run). Description-only ablation was **100%** — strong generator/tooling signal, not proof of real-job classification or “leakage-free” perfection. TF-IDF+LogReg baseline was **75.38%** / macro F1 **0.741** (`fixed_preset`; train holdout non-discriminative).

**RAG caveat:** App code supports hybrid dense + Postgres FTS (`PROPOSED_0018`) + re-rank when `search_tsv` / `search_job_corpus_fts` exist. **Confirm on your Supabase** before claiming live FTS; local `eval-report.json` may show `hybrid`/`ftsReady` from the DB used at eval time. Eval bank is ≥50 queries — use **clean vs noisy** for noise evidence; do not reseed embeddings to chase scores.

## AI Job Assistant — browser scenarios

Sign in as seeker → `/seeker/assistant`.

| # | Action | Expected | Pass? | Notes / screenshot |
|---|--------|----------|-------|--------------------|
| 1 | Ask a general tech question (e.g. explain REST / OOP / Docker) | Non-empty answer; **no** “no approved jobs matched” card | | |
| 2 | Ask learning advice (e.g. what to learn after a language) | Advice answer; no forced vacancy list | | |
| 3 | Ask interview / CV improvement question | Career advice; not a silent job search | | |
| 4 | `Show me full-time jobs` | Approved job cards only (no pending); View/Apply work | | |
| 5 | `Are there remote jobs?` | Remote filter; no resume-skill spam | | |
| 6 | `I want a job in Dhaka. Are there any jobs?` | Location filter; may honestly no-match if DB has no Dhaka approved jobs | | |
| 7 | Attach readable PDF/DOCX → `Find jobs matching my resume` | Resume processed; cards with match reasons when skills overlap | | |
| 8 | After resume: ask unrelated location/type question | Does **not** force resume ranking | | |
| 9 | After jobs shown: `Which of those jobs matches my resume?` | Compares recent cards to session skills | | |
| 10 | Attach invalid/oversized/non-PDF image claim | Clear error; chat still usable | | |
| 11 | History: New conversation / reopen prior | History works; no resume bytes in storage | | |

**Browser verification performed in this repo session?** No (credentials/UI not driven here). Fill Pass only after you run the steps.

## Automation A — `notify-application-status`

| Item | Detail |
|------|--------|
| Trigger | Recruiter/admin updates application status via HireHub UI (invokes Edge Function) |
| Auth | Bearer JWT; recruiter must own the job **or** caller is admin; no identity fields in body |
| Action | Insert seeker in-app notification |
| Idempotency | `application_status:{applicationId}:{status}` dedupe key |
| Code | `supabase/functions/notify-application-status`, `src/lib/notify-application-status.ts` |
| Unit tests | `src/test/notify-application-status.test.ts` |

### Demo steps

1. As recruiter, open an applicant and move status (e.g. applied → shortlisted).
2. As that seeker, open the notifications panel.
3. Confirm one notification for the new status.
4. Retry the same transition/notify path if available — still one logical notification (dedupe).

| Result | Pass? | Screenshot |
|--------|-------|------------|
| Notification appears | | |
| Dedupe holds | | |

## Automation B — Postgres notification triggers

| Item | Detail |
|------|--------|
| Trigger | Row events on `companies`, `jobs`, `applications` (AFTER INSERT/UPDATE) |
| Action | `notify_user` inserts notification rows (SECURITY DEFINER) |
| Not a cron | Fires only on DB changes — not a scheduled worker |
| Migration | `drizzle/migrations/PROPOSED_0005_notifications.sql` (+ 0006b) |

### Demo steps

1. Recruiter submits a company or job that stays `pending` → admin receives “awaiting review” notification.
2. Admin approves company/job → recruiter receives approval notification.
3. Seeker applies → recruiter notified (per trigger rules).

| Result | Pass? | Screenshot |
|--------|-------|------------|
| Pending → admin notify | | |
| Approved → recruiter notify | | |

## Automation C — Smart job skill-match notification (requires PROPOSED_0012)

| Item | Detail |
|------|--------|
| Trigger | Job status transitions **to** `approved` |
| Action | Notify seekers whose `profiles.skills` overlap known skills in job text |
| Auth / privacy | `SECURITY DEFINER` trigger; no client listing of other seekers’ skills; RLS unchanged |
| Idempotency | `job_skill_match:{jobId}:{seekerId}` |
| Code | `src/lib/job-skill-match-notify.ts`, `drizzle/migrations/PROPOSED_0012_job_skill_match_notifications.sql` |
| Unit tests | `src/test/job-skill-match-notify.test.ts` |
| Production | **Not applied until you approve** |

### Demo steps (after 0012 applied)

1. Seeker A: skills include a known skill present in a pending job (e.g. React).
2. Seeker B: non-overlapping skills or empty skills.
3. Admin approves the job.
4. A gets “New job matches your skills”; B does not; recruiter still gets normal approval notify.
5. Reopen/re-approve → still one skill-match row for A.

| Result | Pass? | Screenshot |
|--------|-------|------------|
| Matching seeker notified | | |
| Non-matching skipped | | |
| Dedupe holds | | |

## Automation D — Auto-close expired jobs (requires PROPOSED_0013 + schedule)

| Item | Detail |
|------|--------|
| Trigger | Scheduled Edge Function `close-expired-jobs` (or manual POST with cron secret) |
| Action | RPC `close_expired_approved_jobs` sets `approved` → `closed` when deadline &lt; Asia/Dhaka today |
| Auth | (1) Header `x-hirehub-cron-secret` = `CRON_SECRET` (≥16 chars); (2) service_role JWT so `protect_job_status` allows only expired approved→closed |
| Notify | Existing `jobs_notify_events` → recruiter `job_closed` |
| Code | `src/lib/job-auto-close.ts`, `supabase/functions/close-expired-jobs`, `PROPOSED_0013_auto_close_expired_jobs.sql` |
| Unit tests | `src/test/job-auto-close.test.ts` |
| Recruiter reopen | After **0014**: job details → Extend deadline & reopen when `closed_reason=expired_deadline` |
| Production | **Not applied / not scheduled until you approve** |

### Demo steps (after 0013 + 0014 + function deploy + secret)

1. Approved job with yesterday’s `application_deadline`.
2. Invoke closer once → status `closed`, `closed_reason=expired_deadline`, recruiter `job_closed` notify.
3. Invoke again → closed count 0.
4. As owning recruiter: open job details → set future deadline → **Extend deadline & reopen job**.
5. Confirm status `approved`, `closed_reason` null; seekers can see/apply again.
6. Manually close a job → reopen control must **not** appear for recruiter (admin can still reopen).

| Result | Pass? | Screenshot |
|--------|-------|------------|
| Job auto-closed | | |
| Recruiter notified | | |
| Idempotent re-run | | |
| Expiry reopen works | | |
| Manual-close not recruiter-reopenable | | |

## Playwright / authenticated browser E2E

| Item | Detail |
|------|--------|
| Config | `playwright.config.ts`, `e2e/assistant-smoke.spec.ts` |
| Command | `npm run test:e2e` |
| Credentials | `E2E_SEEKER_EMAIL` / `E2E_SEEKER_PASSWORD` (local only; never commit) |
| Without creds | Suite **skips** safely |
| Optional | `E2E_BASE_URL` (default `http://127.0.0.1:8080`); run `npm run dev` first; `npx playwright install chromium` once |

| Result | Pass? | Notes |
|--------|-------|-------|
| Smoke ran with creds | | |
| Or skipped without creds | | |

## Sign-off

| Criterion | Evidence attached? | Ready to submit? |
|-----------|--------------------|------------------|
| AI agent | | |
| Automations (A–D as required by PDF) | | |
| RAG 5k+ | | |
| Clean vs noisy eval | | |
| Classifier ≥70% | | |
| Tests (+ E2E or manual) | | |
| UI/UX screenshots | | |
| Documentation | | |
