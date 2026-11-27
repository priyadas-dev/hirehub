# HireHub (`capture-replay-tool`)

HireHub is a role-based hiring workspace: **job seekers** browse approved openings, apply, and track status; **recruiters** manage company profiles and jobs; **admins** approve companies and job posts. This repository also includes Assessment Track work for an **AI Job Assistant**, **RAG over a synthetic job corpus**, and **offline job-category classification**.

> Connected to [Lovable](https://lovable.dev). Prefer normal commits on `feature/hirehub-ai-agent`; avoid force-pushing rewritten history on the connected branch.

## Role workspaces

| Role | Primary routes |
|------|----------------|
| Seeker | `/seeker`, `/seeker/jobs`, `/seeker/applications`, `/seeker/assistant`, `/seeker/profile` |
| Recruiter | `/recruiter`, `/recruiter/jobs`, `/recruiter/applicants`, `/recruiter/company` |
| Admin | `/admin`, `/admin/jobs`, `/admin/companies`, `/admin/users` |

Authorization reads `profiles.role` from the database (never from browser-supplied role claims). Protected UI lives under the `_app` layout.

## Setup

```sh
git clone <this-repository-url>
cd capture-replay-tool
npm install
```

Copy `.env.example` to `.env` and set values locally. **Never commit `.env` or real secrets.**

### Important environment variables

| Variable | Client? | Purpose |
|----------|---------|---------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL for the browser client |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Anon/publishable key (RLS applies) |
| `SUPABASE_URL` | Server | Same project URL for server functions |
| `SUPABASE_PUBLISHABLE_KEY` | Server | User-JWT client when needed |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Corpus RAG RPCs — **never** `VITE_` |
| `GEMINI_API_KEY` | Server only | Answer generation (`gemini-3.8-flash`) — **never** `VITE_` |
| `EMBEDDING_PROVIDER` | Server | `gte` (recommended), `gemini`, or `local` |
| `RESEND_API_KEY` | Server | Optional contact / account mail |
| `CRON_SECRET` | Edge Function | ≥16 chars for `close-expired-jobs` schedule auth |
| `E2E_SEEKER_EMAIL` / `E2E_SEEKER_PASSWORD` | Local only | Optional Playwright; **never commit** |

## Development, test, build

```sh
npm run dev
npm test
npm run build
npm run test:e2e   # skips unless E2E_SEEKER_* set; needs playwright browsers + running app
```

AI / RAG helpers:

```sh
npm run rag:classify
npm run rag:eval -- --provider=gte   # also writes clean-vs-noisy.md — does not reseed
npm run rag:embed -- --provider=gte --limit=200   # smoke; bulk needs --confirm-gte-bulk
npm run a4:memory-eval               # Assessment 4 memory before/after metrics
npm run a4:recall-trace              # Assessment 4 session1→session2 recall side-by-side
```

Deploy checklist: [`docs/deploy-assessment-2.md`](docs/deploy-assessment-2.md).

## AI Job Assistant

- **Route:** `/seeker/assistant` (seeker-only)
- **Intent router:** `src/lib/ai/assistant-intent.ts` (`classifyAssistantIntent`)
- **Pipeline:** `src/lib/ai/ask-job-assistant.ts` → `src/lib/ai/job-assistant.ts`
- **Live jobs:** authenticated user JWT + RLS (`src/lib/ai/live-recommend.ts`)
- **Corpus RAG:** service-role RPC only (`match_job_corpus` / `match_job_corpus_gte`)
- **Attachments:** PDF (`unpdf`), DOCX (`mammoth`), JPG/PNG/WEBP (Gemini vision) — max 2 MB, server-side only
- **History:** browser `localStorage` per user id — **no resume text / file bytes**

Synthetic `job_corpus` rows are **never** shown as real vacancies. Full detail: [`docs/ai-job-assistant.md`](docs/ai-job-assistant.md).

Manual verification checklist: [`docs/assessment-2-verification.md`](docs/assessment-2-verification.md).

## Assessment 4 — Memory Layer (before / after)

HireHub remembers across sessions via durable **Path B** (`agent_sessions`) plus **episodic** (`agent_memory_events`) and **semantic** (`agent_semantic_memories` + `match_agent_semantic_memories`, gte-small 384-d). Memory is written only through the Supervisor (never the browser). Settings → **Forget my agent memory** clears all three layers for the signed-in user.

**Capstone proof — measured before/after** (reproducible offline harness; last run reflected below):

| Metric | Before (cold / raw) | After (warm / compact) |
|--------|--------------------:|-----------------------:|
| Clarifying signals | 2 | 1 |
| Personalization lift | — | **50%** fewer clarify signals |
| Context tokens (session blob) | 412 | 251 (**39.1%↓**) |
| Fact fidelity after compact | — | **pass** (4/4 key facts kept) |
| Ideal-term overlap (role/skills/location) | 0.00 | 0.24 |

Reproduce:

```sh
npm run a4:memory-eval      # writes scripts/rag/out/a4-memory-eval.json + prints this table
npm run a4:recall-trace     # Session1 → Session2 cold vs warm side-by-side JSON
npm test -- src/test/a4-memory-layer.test.ts
```

Decision Log: [`docs/ASSESSMENT_4_DECISION_LOG.md`](docs/ASSESSMENT_4_DECISION_LOG.md). Related notes: [`docs/ASSESSMENT_4_PHASE3_COMPACTION.md`](docs/ASSESSMENT_4_PHASE3_COMPACTION.md), [`docs/ASSESSMENT_4_PHASE4_GOVERNANCE.md`](docs/ASSESSMENT_4_PHASE4_GOVERNANCE.md).

## RAG (measured)

Rechecked against the live project during documentation (service-role count queries):

| Metric | Value |
|--------|------:|
| Corpus-only rows (`job_id` IS NULL) | **5000** |
| Populated `embedding_gte` (384-d, gte-small) | **5000** |
| Populated legacy `embedding` (768-d) | **1015** |
| App provider | **`EMBEDDING_PROVIDER=gte`** |

Retrieval uses `match_job_corpus_gte` when provider is `gte`. Dimensions must never be mixed or padded.

### RAG evaluation (reproducible)

```sh
npm run rag:eval -- --provider=gte
```

Latest local run writes:

- `scripts/rag/out/eval-report.json` — full case results + `cleanVsNoisy` object
- `scripts/rag/out/clean-vs-noisy.md` — **with vs without noise** table (paired clean matching queries vs typo twins)

Re-run eval after pulling and paste the clean-vs-noisy table into submission notes. Prior aggregate category hit rate was ~0.83 on matching-only cases; the paired report is the Assessment 2 noise comparison artifact.

**Limitation:** successful retrieval and corpus size do **not** prove perfect relevance. Some queries (e.g. frontend/React) can still surface weaker categories in top-k because the corpus is synthetic and dense. The UI must continue to treat corpus hits as practice context only. **Do not reseed or overwrite the 5,000 `embedding_gte` vectors** to chase scores.

## Job-category classifier (offline)

```sh
npm run rag:classify
```

Implementation: `src/lib/ai/job-classifier.ts` (multinomial Naive Bayes).

Latest held-out run (`scripts/rag/out/classifier-eval.json`):

| Metric | Value |
|--------|------:|
| Random seed | **42** |
| Train fraction | **0.8** (stratified) |
| Train size | **3992** |
| Test size | **1008** |
| Held-out accuracy | **100%** (`meetsTarget` vs 70% target) |
| Macro F1 | **1.0** |
| Confusion matrix | `scripts/rag/out/classifier-eval.json` |

**Honesty note:** Labels and text come from the **synthetic** Track-1 corpus generator. Perfect held-out accuracy on this data can **overstate** real-world performance on genuine vacancies. Do not tune against the held-out split to inflate the score.

## Automated tests & build (latest local run)

```sh
npm test
npm run build
```

Latest measured this session: **52 test files / 372 passed**; production **build succeeded**; Playwright E2E **skipped** without credentials (expected). Re-run before submission and update the evidence table below.

### Playwright E2E (optional)

- **Config:** `playwright.config.ts`, `e2e/assistant-smoke.spec.ts`
- **Command:** `npm run test:e2e` (skips when `E2E_SEEKER_EMAIL` / `E2E_SEEKER_PASSWORD` unset)
- **Never commit** seeker passwords. Prefer manual checklist if credentials are unavailable.

## Automations

### Automation A — Application status notification (Edge Function) — live

- **Code:** `supabase/functions/notify-application-status`, `src/lib/notify-application-status.ts`
- **Trigger:** Recruiter/admin updates an application status through the app (calls the Edge Function after a valid status transition).
- **Auth:** Caller JWT required. Ownership/admin role resolved from the **database**, not the request body. Identity fields in the body are rejected.
- **Action:** Inserts an in-app `notifications` row for the seeker (job title + status context).
- **Idempotency:** `dedupe_key` format `application_status:{applicationId}:{status}` — retries do not duplicate.
- **Tests:** `src/test/notify-application-status.test.ts`

### Automation B — Database notification triggers (not a cron job) — live

- **Migration:** `drizzle/migrations/PROPOSED_0005_notifications.sql` (+ follow-ons in 0006 where review/reject reasons apply)
- **Trigger events (examples):**
  - `companies` INSERT pending → notify admins; status → approved → notify recruiter
  - `jobs` INSERT pending → notify admins; status approved/closed → notify recruiter
  - `applications` INSERT / status changes → notify recruiter and/or seeker via `notify_user`
- **Action:** `SECURITY DEFINER` `notify_user(...)` inserts notification rows with dedupe keys.
- **Verify:** Submit a pending company or job → admin notification appears; approve → recruiter notification appears.

### Automation C — Smart job skill-match notification — **proposed (PROPOSED_0012)**

- **Code:** `src/lib/job-skill-match-notify.ts`, `drizzle/migrations/PROPOSED_0012_job_skill_match_notifications.sql`
- **Trigger:** Job status transitions **into** `approved` only.
- **Action:** Notify seekers whose `profiles.skills` share known skills with the job title/description/location/salary/type/company.
- **Privacy:** Matching runs in a `SECURITY DEFINER` trigger — clients cannot list other seekers’ skills; RLS unchanged.
- **Idempotency:** `job_skill_match:{jobId}:{seekerId}`
- **Tests:** `src/test/job-skill-match-notify.test.ts`
- **Do not apply** until explicitly approved. Demo needs seekers with non-empty skills.

### Automation D — Auto-close expired jobs — **proposed (PROPOSED_0013)**

- **Code:** `src/lib/job-auto-close.ts`, `supabase/functions/close-expired-jobs`, `PROPOSED_0013_auto_close_expired_jobs.sql`
- **Action:** RPC closes `approved` jobs with `application_deadline` before Asia/Dhaka today; existing trigger notifies recruiter (`job_closed`).
- **Auth:** cron secret header → service_role JWT → `protect_job_status` allows **only** `approved → closed` when the deadline has already passed (not a forgeable GUC).
- **Schedule:** Edge Function cron / external POST with `x-hirehub-cron-secret` (`CRON_SECRET`). **`pg_cron` is not installed** on HireHub.
- **Tests:** `src/test/job-auto-close.test.ts`
- **Do not apply / schedule** until explicitly approved.
- **Recruiter reopen after expiry:** `PROPOSED_0014` adds `closed_reason`; auto-close stamps `expired_deadline`; job details offers explicit “Extend deadline & reopen” (RPC). Manual closes stamp `recruiter` / `admin` and are not recruiter-reopenable.

Full demo steps: [`docs/assessment-2-verification.md`](docs/assessment-2-verification.md).

Deploy / apply order: [`docs/deploy-assessment-2.md`](docs/deploy-assessment-2.md).

## Manual browser verification

See the checklist in [`docs/assessment-2-verification.md`](docs/assessment-2-verification.md). Do not mark browser items passed unless you actually ran them.

## Submission evidence placeholders

Fill these before submission (do not invent URLs):

| Evidence | Value |
|----------|--------|
| Deployed demo URL | `_TODO: paste Vercel/Lovable URL_` |
| Seeker test account (email only) | `_TODO_` |
| Screenshot: AI assistant general Q | `_TODO: path or Drive link_` |
| Screenshot: AI assistant job cards | `_TODO_` |
| Screenshot: Automation A notification | `_TODO_` |
| Screenshot: Automation B notification | `_TODO_` |
| Screenshot: skill-match (0012) | `_TODO_` |
| Screenshot: auto-close (0013) | `_TODO_` |
| Clean-vs-noisy table | `_TODO: paste from scripts/rag/out/clean-vs-noisy.md_` |
| Loom / video walkthrough | `_TODO_` |
| `npm test` output date | `_TODO_` |
| `npm run build` output date | `_TODO_` |
| Git tag `assessment-2` | `_TODO_` |

## Security reminders

- Never put `GEMINI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in `VITE_*` variables.
- Live approved jobs use the signed-in user’s JWT (RLS). Corpus matching uses the service role on the server only.
- Do not delete corpus rows or overwrite legacy 768 embeddings when using the gte path.
