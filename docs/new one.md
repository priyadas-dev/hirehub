# HireHub — Assessment 2 Report

Intern: Priya Das (Sylhet)  
Mentor: Amol — Tech Manager  
Assessment: SJ Innovation Assessment 2 (continuation of Assessment 1)  
Generated: 27 October 2026

## Link URL

| Link | URL |
|------|-----|
| Live dashboard | https://capture-replay-tool.vercel.app/ |
| GitHub | https://github.com/priyadas-dev/capture-replay-tool |
| Supabase project | munqgybiuqpncxbgfvdp |

## Test credentials (emails only)

This report does **not** include passwords, API keys, service-role keys, tokens, or other secrets. Share login credentials only via DCT or DM.

| Role | Email |
|------|-------|
| Admin | priyadas0767@gmail.com |
| Recruiter | miyradr@gmail.com |
| Job Seeker | priyadas142307@gmail.com |

## Assessment brief (one line)

Same HireHub app, plus an AI agent, two automations, RAG on ≥5,000 records, LLM integration with ≥70% accuracy evidence, automated tests, polished UI, and documentation.

---

## Track 1 — AI agent (Option A: job-search assistant)

**Status:** complete

The AI Job Assistant is a seeker-only chat at `/seeker/assistant`. It is an intent-routed server agent (`askJobAssistant`), not freeform chat that invents vacancies. The model answers from grounded context: live approved jobs and/or synthetic corpus RAG.

| Capability | Purpose |
|------------|---------|
| `classifyAssistantIntent` | Routes job search vs career / learning / interview vs general questions |
| Live approved-job search | Real jobs with `status = approved` via user JWT + RLS |
| Corpus RAG retrieve | Synthetic `job_corpus` context only (never shown as real openings) |
| Gemini answer generation | Grounded replies (`gemini-3.8-flash`) |
| Resume / file inspect | PDF, DOCX, or image (server-side, max 2 MB) |

Client UI: seeker chat + approved-job cards + local history (no resume bytes stored).

Server pipeline: `src/lib/ai/ask-job-assistant.ts` → `job-assistant.ts` → `live-recommend.ts` / corpus retrieve → Gemini.

LLM: Google Gemini for chat (`GEMINI_API_KEY`, server-only). Embeddings for RAG use `EMBEDDING_PROVIDER=gte` (`gte-small`, 384-d).

---

## Track 2 — Two workflows / automations

**Status:** complete

Both run without a user clicking through every step.

### 1. Smart job skill-match notification

When a job becomes `approved`, a database trigger notifies seekers whose `profiles.skills` overlap known skills in the job text. Matching runs `SECURITY DEFINER` (clients cannot list other seekers’ skills).

- Idempotency: `job_skill_match:{jobId}:{seekerId}`
- Migration file: `drizzle/migrations/PROPOSED_0012_job_skill_match_notifications.sql`
- Code / tests: `src/lib/job-skill-match-notify.ts`, `src/test/job-skill-match-notify.test.ts`
- **Live Supabase (`munqgybiuqpncxbgfvdp`):** Applied — verified live RPC responses for `extract_known_skills`, `known_skill_overlap`, and `notify_seekers_matching_approved_job` (27 Oct 2026)

### 2. Application-status notify + auto-close expired jobs

When a recruiter/admin updates an application status, Edge Function `notify-application-status` inserts an in-app seeker notification (JWT auth; ownership from DB).

- Idempotency: `application_status:{applicationId}:{status}`
- Scheduled Edge Function `close-expired-jobs` calls `close_expired_approved_jobs` for approved jobs past `application_deadline` (Asia/Dhaka). Auth: `x-hirehub-cron-secret` (value not published here)
- `PROPOSED_0014` adds `closed_reason` and recruiter reopen after expiry
- Code: `supabase/functions/notify-application-status`, `supabase/functions/close-expired-jobs`, `src/lib/job-auto-close.ts`
- **Live Supabase (`munqgybiuqpncxbgfvdp`):** Applied — verified `jobs.closed_reason` (rows with `expired_deadline`), live `close_expired_approved_jobs`, and existence of `recruiter_reopen_expired_job` (service-role call returns permission denied as expected; execute is granted to `authenticated`) (27 Oct 2026)

---

## Track 3 — RAG on ≥5,000 records

**Status:** complete (corpus); eval reported honestly

### Design

```
chunk (synthetic job text)
  → gte-small (384-d) → public.job_corpus.embedding_gte (pgvector)
  → match_job_corpus_gte (dense) + search_job_corpus_fts (Postgres FTS)
  → RRF / lexical re-rank (src/lib/ai/corpus-rerank.ts)
  → assistant corpus context (src/lib/ai/corpus-retrieve.ts)
```

Live vacancies stay on a separate path (user JWT + `jobs` RLS). Corpus rows are never recommended as real openings.

### PROPOSED_0018 (Postgres FTS) — status by layer

| Layer | Status | Evidence |
|-------|--------|----------|
| SQL file in repo | Present | `drizzle/migrations/PROPOSED_0018_job_corpus_fts.sql` |
| Applied on live Supabase | Verified | `job_corpus.search_tsv` readable; `search_job_corpus_fts` RPC callable; RAG probe `ftsReady: true` (27 Oct 2026) |
| Used by retrieval code | Verified | `retrieveCorpusMatches` calls `search_job_corpus_fts` and `rerankHybridCandidates` |
| Used in latest eval run | Verified | `scripts/rag/out/eval-report.json` → `hybrid: true`, `ftsReady: true` (generated 2026-10-27T13:02:57.122Z) |

### Live corpus (HireHub project, counted 27 Oct 2026)

| Metric | Count |
|--------|------:|
| Corpus-only rows (`job_id` IS NULL) | 5000 |
| Populated `embedding_gte` (384-d) | 5000 |
| Populated legacy `embedding` (768-d) | 1015 |
| App provider | gte |

### Evaluation (matching / noisy / edge)

- Query bank: **56** cases in `src/lib/ai/corpus-eval.ts` (≥50), including **16** clean↔noisy pairs
- Artifacts: `scripts/rag/out/eval-report.json`, `scripts/rag/out/clean-vs-noisy.md`
- Model: `gte-small` · k=5 · provider `gte` · hybrid retrieval
- Command: `npm run rag:eval -- --provider=gte`

| Set | Cases | Category hit-rate@k |
|-----|------:|--------------------:|
| matching | 31 | 77.4% (24/31) |
| noisy | 19 | 63.2% (12/19) |
| edge | 6 | 33.3% (2/6) |
| Overall (category-labelled) | 51 | 74.5% |

Clean vs noisy (paired intents):

| Metric | Clean (without noise) | Noisy (with typos) |
|--------|----------------------:|-------------------:|
| Category hit rate | 75.0% | 68.8% |
| Avg top similarity | 0.834 | 0.827 |
| Paired intents | 16 | 16 |

Noise still reduces hit-rate. Corpus hits remain synthetic practice context only.

---

## Track 4 — LLM integration + ≥70% accuracy

**Status:** complete on held-out synthetic eval (meets ≥70%; not a real-job claim)

Prior submission reported 100% accuracy on synthetic labels. Mentor feedback flagged likely label leakage from category words. Current offline evaluation uses category-name/slug masking on **description** features, strips synthetic skill-list / category-revealing boilerplate from features, and uses a **template-group** 80/20 split so seniority/location variants of the same role do not appear on both sides. Occupational title words such as “data”, “product”, and “marketing” are **kept** in titles (documented in `classifier-eval.json` notes). The gold category column is never used as a feature.

| Item | Value |
|------|--------|
| Task | Predict job category from title + description |
| Features | Text only (label column never used as a feature) |
| Model | Multinomial Naive Bayes (`src/lib/ai/job-classifier.ts`) |
| Split | 80/20 template-group (seed 42) — 3814 train / 1186 test |
| Held-out accuracy | 0.953 (95.3%) |
| Macro F1 | 0.937 |
| Meets ≥70% | Yes |
| Evidence | `scripts/rag/out/classifier-eval.json` (generated 2026-10-27T12:12:37.775Z) |
| Command | `npm run rag:classify` |

Chat LLM (assistant) is separate: Gemini (`gemini-3.8-flash`). Classifier is offline train/test evidence only.

### Per-class precision / recall / F1 (held-out)

| Class | Precision | Recall | F1 | Support |
|-------|----------:|-------:|---:|--------:|
| engineering | 1.000 | 1.000 | 1.000 | 104 |
| data | 1.000 | 1.000 | 1.000 | 83 |
| design | 1.000 | 0.325 | 0.491 | 83 |
| product | 1.000 | 1.000 | 1.000 | 105 |
| marketing | 0.597 | 1.000 | 0.748 | 83 |
| sales | 1.000 | 1.000 | 1.000 | 104 |
| operations | 1.000 | 1.000 | 1.000 | 104 |
| finance | 1.000 | 1.000 | 1.000 | 104 |
| healthcare | 1.000 | 1.000 | 1.000 | 104 |
| education | 1.000 | 1.000 | 1.000 | 104 |
| customer_support | 1.000 | 1.000 | 1.000 | 104 |
| hr | 1.000 | 1.000 | 1.000 | 104 |

Leakage diagnostics from the same artifact: title-only accuracy 26.4%; description-only 100%; template-group overlap 0. Residual `design` ↔ `marketing` confusion remains visible above.

---

## Track 5 — Test automation

**Status:** complete — single-command suite + Playwright smoke

```sh
npm test
npm run test:e2e
```

| Layer | What | Command |
|-------|------|---------|
| Unit | Assistant, RAG/embed, notifications, skill-match, auto-close, classifier, auth helpers | `npm test` |
| E2E | Playwright assistant smoke (`e2e/assistant-smoke.spec.ts`) | `npm run test:e2e` |

Last captured unit run (23 Oct 2026): 53 test files / 382 passed (exit 0).

Playwright skips safely when `E2E_SEEKER_*` credentials are unset (never commit passwords).

---

## Track 6 — UI/UX

**Status:** acceptable for scoring

Shared signed-in shell for seeker, recruiter, and admin. Live landing at https://capture-replay-tool.vercel.app/.

AI Job Assistant chat with approved-job cards. Loading / empty / error patterns on main flows; in-app notifications when automations fire.

---

## Track 7 — Docs & DCT submission

**Status:** docs complete in-repo; **DCT submission pending**

In-repo documentation covers the agent, automations, RAG design, metrics, and how to run tests:

- `README.md`
- `docs/ai-job-assistant.md`
- `docs/assessment-2-verification.md`
- `docs/deploy-assessment-2.md`
- This report
- RAG / classifier artifacts under `scripts/rag/out/`

**DCT:** No repository evidence confirms that Dev Control Tower upload is finished. Remaining action: upload the redacted PDF / required DCT package and share demo credentials only via DCT or DM.

---

## Scoring parameters checklist

| Parameter | Max | How we meet it |
|-----------|----:|----------------|
| AI agent (new / enhanced) | 20 | Option A Job Assistant + live jobs + Gemini + attachments |
| Two automations E2E | 15 | Skill-match on approve (`0012` live) + status notify / expiry auto-close (`0014` live) |
| RAG ≥5k + matching / extreme / noise | 20 | 5000 gte vectors + 56-query hybrid FTS + re-rank + clean/noisy table |
| LLM + ≥70% accuracy evidence | 15 | Gemini chat + 95.3% masked held-out classifier with per-class P/R/F1 |
| Test automation | 15 | `npm test` (382 passed) + Playwright smoke |
| Best-possible UI/UX | 10 | Landing, role shells, assistant chat, notifications |
| Docs & DCT submission | 5 | Docs/metrics here; **DCT upload still pending** |
| **Total** | **100** | |
| Bonus (Ollama + multi-step agent actions) | +10 | Not claimed |

---

## How to reproduce key evidence

```sh
npm run rag:eval -- --provider=gte   # → eval-report.json + clean-vs-noisy.md
npm run rag:classify                  # → classifier-eval.json (masked + per-class P/R/F1)
npm test                             # unit suite
npm run test:e2e                     # needs E2E_SEEKER_* locally (never commit)
npm run build
npm run dev                          # or use https://capture-replay-tool.vercel.app/
```

---

## Known gaps (honest)

1. Edge-set category hit-rate remains weak (33.3% on 6 edge queries); no full corpus re-embed was done to chase scores after the ≥5k bar.
2. DCT submission is not verified complete from repository evidence — upload the redacted report package and share credentials only via DCT or DM.

---

*SJ Innovation — Internal. Assessment 2 report for HireHub. Prepared for mentor review.*
