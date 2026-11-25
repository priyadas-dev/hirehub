# HireHub — Assessment 3 Project Submission

| Field | Value |
|-------|--------|
| Intern | Priya Das |
| Mentor | Amol — Tech Manager |
| Assessment | SJ Innovation Assessment 3 (continuation of Assessment 2) |
| Issued | Wednesday, 28 October 2026 |
| Report date | Wednesday, 12 November 2026 |
| Product | HireHub — Level 3: integrated, secure, production-grade AI Job & Recruitment Portal |

## Links

| Link | URL / value |
|------|-------------|
| Live app | https://hirehub-dev.vercel.app/ |
| GitHub | https://github.com/priyadas-dev/hirehub |
| Supabase project | `munqgybiuqpncxbgfvdp` |
| Release tag `assessment-3` | https://github.com/priyadas-dev/hirehub/releases/tag/assessment-3 |
| Green CI Actions URL | https://github.com/priyadas-dev/hirehub/actions/runs/44091862041 |
| Amol closeout pack | `docs/ASSESSMENT_3_AMOL_GAP_CLOSEOUT.md` |

> Assessment 3 live URL is `hirehub-dev.vercel.app`. Close Amol gaps via the closeout pack before DCT submit.

## Test credentials (roles only — no passwords in this report)

Passwords are shared **only via Dev Control Tower / DM**, never in this report or public repos.

| Role | Email (public demo identity) | Password |
|------|------------------------------|----------|
| Admin | `priyadas0767@gmail.com` | *[redacted — DCT / DM only]* |
| Recruiter | `miyradr@gmail.com` | *[redacted — DCT / DM only]* |
| Job Seeker | `priyadas142307@gmail.com` | *[redacted — DCT / DM only]* |

## Assessment brief (one line)

Take HireHub and make it **integrated** (real third-party services + campaign/CRM), **intelligent** (multi-agent with guardrails), **measured** (agent/RAG evaluation harness, hybrid + re-rank), and **production-grade** — safe, fair, and secure at scale (CI/CD, observability, security).

## Where Assessment 2 left off

| Cap | A2 result (frozen Phase 0) |
|-----|----------------------------|
| Roles | Job Seeker / Recruiter / Admin portal with RLS + `profiles.role` |
| AI agent | Job-search assistant (`/seeker/assistant`) |
| Automations | Job skill-match notify + application-status notify / auto-close expired jobs |
| RAG | Hybrid retrieve over **5,000** synthetic postings (`gte-small` 384-d) |
| Classifier | Multinomial NB — accuracy **~95.3%**, Macro F1 **~0.937** (later shown partly leakage-inflated; remediating in Track 5) |
| RAG category-hit@k | **~72.5%** overall (matching **77.4%** / noisy **63.2%** / edge **16.7%**) on A2 bank |

Sources: `docs/ASSESSMENT_3_BASELINE.md`, `docs/assessment-2-report.md`, `scripts/rag/out/classifier-eval.json`, `scripts/rag/out/eval-report.json`.

---

## Architecture (agents, integrations, data flow)

```text
Browser (TanStack Start / React 19)
  Seeker  → /seeker/assistant          → askJobAssistant (JWT)
  Recruiter → /recruiter/agent         → askRecruiterAgent (JWT)
  Recruiter → /recruiter/crm/*         → CRM contacts / segments / campaigns
  Recruiter → interview scheduling UI  → Google Calendar helpers
        │
        ▼
  Auth: Lovable Cloud + Supabase Auth
  Role: profiles.role only (never browser-supplied claims)
        │
        ▼
  Supervisor / Router  (src/lib/ai/agents/supervisor.ts)
    Guardrails first: validation · PII redaction · fairness · low-confidence
    Shared memory Path A: in-process Map keyed userId::conversationId
    Path B live: public.agent_sessions (applied on host; RLS + FORCE RLS)
        │
        ├── Discovery   → live approved jobs (+ optional corpus RAG)
        ├── Application → confirm-to-apply / save / status (JWT applyToJob)
        ├── Recruiter   → shortlist propose+confirm / outreach draft
        └── Legacy      → grounded Gemini Q&A pipeline
        │
        ▼
  Supabase Postgres + RLS + Storage
    jobs · applications · profiles · job_corpus · crm_* · email_delivery_events
    interview_schedules · resumes (private bucket)
        │
        ├── Resend outbound (application status + CRM campaigns)
        ├── Resend inbound webhook (Svix HMAC verify) → tracking
        ├── HubSpot outbound contact upsert (soft-skip if token absent)
        ├── Google Calendar outbound (Meet invite-after-link) + push webhook token verify
        ├── gte-small embeddings (WASM) + Postgres FTS + RRF re-rank
        └── Sentry (optional DSN) + AI match rate-limit/cache
```

**Companion evidence docs:** `docs/ASSESSMENT_3_TRACK3_MULTI_AGENT_GUIDE.md`, `docs/assessment-3-integration-contracts.md`, phase reports under `docs/ASSESSMENT_3_PHASE_*.md`.

---

## Track 1 — Third-party integration (20 pts)

**Status:** Implementation complete in code · live end-to-end smoke **partially pending** (secrets / hosted webhook URL / Calendar migration apply)

**Requirement:** ≥2 real free-tier services; one outbound action + one inbound webhook with verified signature.

| Service | Direction | Role | Evidence |
|---------|-----------|------|----------|
| **Resend** | Outbound | Application-status email + CRM campaign send | `src/lib/integrations/application-status-mail.ts`, `src/lib/crm/send-campaign.server.ts`, `campaign-mail.ts` |
| **Resend** | Inbound webhook | Svix HMAC-SHA256 signature verify; maps `sent/delivered/opened/bounced/complained` → CRM / delivery tracking | `src/lib/integrations/svix-verify.ts`, `resend-webhook.ts`, `supabase/functions/resend-webhook/index.ts` |
| **HubSpot** | Outbound | CRM v3 contact upsert by email (soft-skip without token) | `src/lib/integrations/hubspot-sync.ts`, `src/lib/crm/hubspot-contact-sync.ts` |
| **Google Calendar** | Outbound | Interview create / invite-after-Meet-link / reschedule / cancel | `src/lib/integrations/google-calendar.ts` |
| **Google Calendar** | Inbound webhook | `X-Goog-Channel-Token` timing-safe verify + channel id match | `src/lib/integrations/google-calendar-webhook.ts` |
| RSVP sync | Cron / Edge | Poll/sync attendee responses; watch renew | `supabase/functions/sync-interview-rsvp/`, `google-calendar-watch-renew.ts` |

**Inbound signature verification (code-verified):**

- Resend / Svix: HMAC over `v1:{id}:{timestamp}:{body}`; ±300s skew; unsigned → 401; replay handled idempotently.
- Google Calendar: channel token compared with `secretsEqual` / `cronSecretsEqual`; rejects mismatched channel.

**HubSpot note:** HubSpot is **outbound only** in this codebase. The assignment’s inbound webhook requirement is satisfied by **Resend Svix** (and optionally Google Calendar push), not by a HubSpot inbound handler.

**Server-only env names** (`src/lib/integrations/env.ts` — never `VITE_`):

`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`, `HUBSPOT_ACCESS_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_WEBHOOK_TOKEN`, `GOOGLE_CALENDAR_WEBHOOK_URL`.

**Needs verification before claiming “live production integration” bonus:**

| Item | Status |
|------|--------|
| Resend API key + webhook secret on host | Confirm in host secrets (do not paste here) |
| HubSpot access token | Confirm if live sync is required for demo |
| `PROPOSED_0028` watch-channels migration applied | Runbook: apply before live Google pushes |
| Public HTTPS webhook URL + bootstrap watch | `docs/ASSESSMENT_3_TRACK1_GOOGLE_CALENDAR_WEBHOOK_RUNBOOK.md` D3–D4 |
| Live Google accept/decline RSVP smoke | Explicitly **not done** in runbook |

---

## Track 2 — Campaign / CRM module (15 pts)

**Status:** Implemented (HireHub in-app CRM as source of truth + optional HubSpot sync ids)

| Piece | Implementation |
|-------|----------------|
| Segments | Kinds `new` / `active` / `placed`; filter + manual segment types |
| Campaign builder | Draft → preview → explicit confirm send via Resend |
| Tracking | `pending → sent → delivered → opened → bounced/complained/replied/applied` (monotonic) |
| UI | `/recruiter/crm`, contacts, segments, campaigns |

**Key files**

| Area | Paths |
|------|-------|
| Types | `src/lib/crm/types.ts` (`CRM_SEGMENT_KINDS`, `CRM_TRACKING_STATUSES`) |
| Contacts / segments / campaigns | `src/lib/crm/contacts*.ts`, `segments*.ts`, `manual-segments.ts`, `campaigns.ts` |
| Send | `src/lib/crm/send-campaign.server.ts`, `campaign-mail.ts` |
| Webhook correlation | `src/lib/crm/webhook-recipient-tracking.ts` |
| App → CRM sync | `src/lib/crm/sync-from-application.server.ts` |
| Routes | `src/routes/_app.recruiter.crm*.tsx` |
| Migrations | `PROPOSED_0020` email events, `PROPOSED_0021` CRM tables, `PROPOSED_0022` ownership, `PROPOSED_0026` manual segments |

**Browser evidence:** `docs/CRM_RECRUITER_FULL_PLAYWRIGHT_UI_REPORT.md` (2026-11-04) — Overview / Contacts / Segments / Campaigns **PASS** on local signed-in recruiter session. **Intentionally not exercised:** live `Confirm & send` (Resend outbound) to avoid mutating production data during UI pass.

**Honesty:** `replied` / `applied` are first-class tracking statuses in the data model and summary counters; automated advancement of those two from inbound mail reply / seeker apply hooks should be demoed or verified live if graders ask — Resend webhook primarily drives `sent/delivered/opened/bounced/complained`.

---

## Track 3 — Multi-agent orchestration + guardrails (20 pts)

**Status:** Feature-complete in product + unit/offline harness · live mutating browser Mode B and live Storage JWT denial matrix still polish items

### Agents

| Agent | Responsibility | Module |
|-------|----------------|--------|
| **Supervisor** | Guardrails first; route; memory; merge structured results | `src/lib/ai/agents/supervisor.ts` |
| **Discovery** | Recommend **approved** live jobs (+ optional corpus); never invent vacancies | `src/lib/ai/agents/discovery.ts` |
| **Application** | Confirm-to-apply, Save Job, Check Application Status (JWT only) | `src/lib/ai/agents/application.ts` |
| **Recruiter** | Owned-job shortlist propose/confirm; outreach **draft** (no auto-send from NL) | `src/lib/ai/agents/recruiter.ts`, `recruiter-agent-runner.ts` |

### UIs

| Role | Route | Notes |
|------|-------|-------|
| Seeker | `/seeker/assistant` | Discovery / apply propose+confirm / save+status |
| Recruiter | `/recruiter/agent` | Owned jobs, applicants, shortlist confirm bar, draft outreach |

### Guardrails

| Guardrail | Behavior | Module |
|-----------|----------|--------|
| Input validation | Reject invalid supervised turns | `src/lib/ai/guardrails/validation.ts` |
| PII redaction | Email / phone / labeled ID scrubbed before LLM/memory | `guardrails/pii.ts` |
| Fairness | Discriminatory hiring filters refused/neutralized **before** rank | `guardrails/fairness.ts` |
| Low-confidence | Empty/vague Discovery → clarify or refuse; no invented cards | `guardrails/confidence.ts` |
| Structured outputs | Typed payloads (`pendingApply`, `saveOutcome`, traces, …) | supervisor + assistant types |

### Shared memory

| Item | Detail |
|------|--------|
| Path A (default) | In-process `Map` — `src/lib/ai/memory/server-memory.ts` — **resets on server restart** |
| Path B | `agent_sessions` **live applied** — see `docs/ASSESSMENT_3_MIGRATION_STATUS.md` |

### Security / ownership (application path)

- Apply / save / status use caller JWT Supabase client — never service-role apply.
- Seeker id comes from authenticated session deps — never free text.
- Recruiter tools enforce job/application `recruiter_id` ownership from DB.
- Resume path ACL asserted on apply; Storage policy mirror in `src/lib/resume-access.ts`.

**Evidence reports:** `docs/ASSESSMENT_3_TRACK3_FINAL_REPORT.md`, `ASSESSMENT_3_TRACK3_STATUS.md`, `ASSESSMENT_3_TRACK3_BROWSER_VERIFICATION.md` (Mode A read-only: 14 pass / 0 fail / 4 skip on 2026-11-09).

---

## Track 4 — Agent & RAG evaluation harness (15 pts)

**Status:** Harness complete · live corpus scaled to **20,000** with gte embeddings · metrics measured at 5k and 20k on frozen set `a3_v1` · 10k mid-checkpoint blank (not invented)

### What changed vs Assessment 2

| Layer | Assessment 2 | Assessment 3 |
|-------|--------------|--------------|
| Retrieval | Hybrid vector + FTS emerging | Hybrid dense (`match_job_corpus_gte`) + FTS (`search_job_corpus_fts`) |
| Ranking | Re-rank present | RRF + lexical overlap (`src/lib/ai/corpus-rerank.ts`) |
| Corpus | 5,000 postings | **20,000** corpus-only rows; baseline 5k keys intact |
| Embeddings | `embedding_gte` 384-d (gte-small) | 20,000 / 20,000 gte non-null (`stage-A-inventory.json` @ 2026-11-06) |
| Eval bank | `EVAL_QUERY_BANK` (56) category proxy | Frozen independent `scripts/rag/eval-sets/a3_v1.json` (20 cases) |
| Answer metrics | Absent | Heuristic faithfulness + answer relevance |
| Agent eval | Informal | Labelled offline scenarios → task-success % |

### Live inventory (verified artifact)

From `scripts/rag/out/stage-A-inventory.json` (measured 2026-11-06):

| Field | Value |
|-------|------:|
| Corpus-only rows | 20,000 |
| `embedding_gte` non-null | 20,000 |
| Legacy `embedding` (768) non-null | 1,015 |
| Baseline keys present / intact | 5,000 / yes |
| FTS probe | `ftsReady: true` |

### RAG metrics — frozen set `a3_v1` (k=5, provider=gte)

| Scale | Hit@5 | Precision@5 | MRR | nDCG@5 | Category-hit@5 | Faithfulness* | Answer rel.* | Verified |
|------:|------:|------------:|----:|-------:|---------------:|--------------:|-------------:|:--------:|
| 5k | 0.550 | 0.550 | 0.550 | 0.550 | 0.625 | 1.000 | 0.111 | yes |
| 10k | — | — | — | — | — | — | — | no |
| 20k | 0.700 | 0.700 | 0.700 | 0.700 | 0.750 | 1.000 | 0.222 | yes |

\*Methods: `token_overlap_heuristic` / `query_token_coverage` — **not** LLM-as-judge.  
Artifacts: `scripts/rag/out/a3-frozen-5k-2026-11-05T09-06-20-714Z.json`, `a3-frozen-20k-2026-11-06T05-14-52-326Z.json`, `stage-F-comparison.json`.  
Report: `docs/ASSESSMENT_3_TRACK4B_SCALE_REPORT.md`, `docs/assessment-3-evaluation-report.md`.

### Side-by-side vs Assessment 2 (honest comparison)

| Dimension | Assessment 2 | Assessment 3 |
|-----------|--------------|--------------|
| Query bank | 56 category-proxy queries | 20 independent paraphrase / noisy / no-hit / answer |
| Headline | Category-hit ~**72.5%** (local JSON overall **0.745**) | Hit@5 **0.55** @5k → **0.70** @20k; category-hit **0.625** → **0.750** |
| Precision@k / MRR / nDCG | Not reported as IR Hit/P@k in A2 artifact | Present on `a3_v1` |
| Faithfulness harness | Absent | Heuristic present |
| Harder set? | Lexicon-heavy overlap with generator titles | More paraphrase + explicit no-hit → lower rates expected at same scale |

**Do not claim A3 “beats” A2 on category-hit** — banks and grading differ. A3 adds IR scaffolding and shows **same frozen bank improving from 5k→20k** (0.55 → 0.70 Hit@5).

### Agent task-success (offline harness)

Latest Track 4A artifact `scripts/rag/out/track4a-2026-11-06T05-15-29-358Z.json`:

| Metric | Value |
|--------|------:|
| Scenarios | 18 |
| Passed | 18 |
| Failed | 0 |
| **Task-success rate** | **100%** |

By family: guardrail 2/2 · discovery 3/3 · supervisor 5/5 · application 6/6 · recruiter 2/2.

Covers fairness refuse, PII redact, discovery grounding, confirm-to-apply (0 inserts until confirm), idempotent confirm, save idempotency, status ownership isolation, recruiter non-owner deny, outreach draft-without-send.

**Limitation:** deterministic mocks — **not** live production DB / UI E2E. Command: `npm run rag:eval:track4a` / `npm run rag:eval:agents`.

---

## Track 5 — Model improvement (10 pts)

**Status:** Complete for Track 5 synthetic gate · fine-tune / LoRA **not attempted** · independent OOD reported honestly (low)

**Route chosen:** Improve existing Multinomial Naive Bayes **job-category classifier** (12 classes), not shortlist-likelihood.

### Why A2 ~95.3% was untrustworthy

Skills-line features used category-exclusive toolkits → description-only and skills-line-only ablations hit **100%**. Template-group split was correct, but class-pure vocabulary still crossed train/test. Track 5 **Option A** removed the skills laundry list from classifier features only (RAG generator untouched).

### Synthetic Track 5 gate (default variant `v2-div-b`)

| Metric | Value | Target |
|--------|------:|--------|
| Accuracy | **0.8642** | Prefer ∈ (70%, 90%) — **met** |
| Macro F1 | **0.8612** | ≥ **0.85** — **met** (`meetsTrack5MacroF1: true`) |
| Weighted F1 | **0.8599** | — |
| Split | template_group, seed 42, 3814 / 1186 | — |

Code default: `DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT = "v2-div-b"` in `src/lib/ai/job-classifier-enrichment.ts`.  
Primary artifact: `scripts/rag/out/track5-ood-v2-div-b-2026-11-09T10-48-33-119Z.json`.  
Reports: `docs/ASSESSMENT_3_TRACK5_REPORT.md`, `docs/ASSESSMENT_3_TRACK5_EXEC_SUMMARY.md`.

### Per-class highlights (synthetic held-out, `v2-div-b`)

| Class | Precision | Recall | F1 |
|-------|----------:|-------:|---:|
| data | 0.798 | 1.000 | ~0.89 |
| design / education / hr | 1.000 | 1.000 | 1.000 |
| healthcare | 0.945 | 1.000 | 0.972 |
| operations (worst) | 0.624 | 0.510 | **0.561** |
| customer_support | 1.000 | 0.510 | 0.675 |

### Independent OOD (informational — not the Track 5 pass gate)

| Field | Value |
|-------|------:|
| Dataset | `datasets/track5_ood_v1` (n=215, Apache-2.0 public JDs) |
| Accuracy | **0.2465** |
| Macro F1 | **0.2184** |
| Tuned on OOD? | **No** |

OOD proves synthetic ≠ real-world JD mastery. Do not claim production classifier readiness from synthetic Macro F1 alone.

### Fine-tune

No LoRA / Ollama Modelfile / Colab fine-tune was shipped. NB is trained offline via `npm run rag:classify:track5-p5` / related scripts.

---

## Track 6 — CI/CD, observability & security (15 pts)

**Status:** CI Release + Sentry live event complete (see `docs/ASSESSMENT_3_SENTRY_EVIDENCE.md`, `docs/ASSESSMENT_3_AMOL_GAP_CLOSEOUT.md`)

### CI/CD

| Item | Detail |
|------|--------|
| Workflow | `.github/workflows/ci.yml` |
| Triggers | `pull_request` + push to `main`, `master`, `multi-agent`, `assessment-3-integration`, CRM/Calendar feature branches |
| Job | Node 22 → `npm ci` → `npm test` (`CI=true`) |
| Secrets in CI | **None** injected (unit suite does not need prod credentials) |
| Playwright | Local `npm run test:e2e` — not in CI job |
| Release | `docs/releases/assessment-3.md` |

### Observability (Sentry)

| Item | Detail |
|------|--------|
| Module | `src/lib/observability/sentry.ts` |
| Packages | `@sentry/node`, `@sentry/react` |
| Hooks | `src/server.ts` (SSR), `src/routes/__root.tsx` (browser + error boundary) |
| Default | **No-op** without DSN |
| PII | `sendDefaultPii: false` + scrub Bearer/JWT/`api_key`-like strings |
| Live event | **Done** — marker `hirehub-a3-sentry-smoke-2026-11-24T06:25:04.122Z`; screenshot [`docs/a3-sentry-event-screenshot.png`](docs/a3-sentry-event-screenshot.png) |
| Host | Local `.env` + Vercel Production DSN set; app redeployed after DSN update |

Manual env (user sets — agents do not edit `.env`): `SENTRY_DSN`, optional `VITE_SENTRY_DSN`.

### AI match rate-limit + cache

| Item | Detail |
|------|--------|
| Module | `src/lib/ai/ai-match-guard.ts` |
| Wired in | `src/lib/ai/ask-job-assistant.ts` |
| Defaults | 20 requests / 60s / user; cache TTL 30s; max 200 entries |
| Failure | Friendly `rate_limited` — no stack leak |
| Tests | `src/test/ai-match-guard.test.ts` |

### Security advisor / resume focus (re-verified 2026-11-24)

| Check | Result |
|-------|--------|
| Security Advisor | **PASS** — **0 errors** (`docs/a3-security-advisor-errors-pass.png`) |
| `resumes.public = false` | **PASS** — PDF + 5 MB (`docs/a3-resumes-bucket-private.png`) |
| Resume Storage policies | **PASS** — owner/admin/hiring SELECT; seeker own write (`docs/a3-resumes-storage-policies.png`) |
| App authorize-before-sign mirror | `src/lib/resume-access.ts` + unit tests |
| Live other-recruiter / non-entitled deny | **PASS** — `docs/a3-resume-other-recruiter-deny.json` (`pass: true`) + UI Access denied |
| No service-role / secrets behind `VITE_` for integrations | Pattern PASS (`integrations/env.ts`) |
| Durable `agent_sessions` / 0022 / 0028 | **ALL APPLIED (live)** — `docs/ASSESSMENT_3_MIGRATION_STATUS.md` |

Summary: `docs/a3-security-advisor-pass.md` · Track 6: `docs/ASSESSMENT_3_TRACK6_CI_OBSERVABILITY_SECURITY.md`.

---

## Track 7 — Architecture docs, demo & Dev Control Tower (5 pts)

| Deliverable | Where |
|-------------|--------|
| This submission report | `ASSIGNMENT_3_PROJECT_SUBMISSION.md` (this file) |
| Architecture diagram | ASCII architecture above + deeper Track 3 diagram in `docs/ASSESSMENT_3_TRACK3_FINAL_REPORT.md` |
| Evaluation report vs A2 | Track 4 section + `docs/assessment-3-evaluation-report.md` + Track 4A/4B reports |
| Model metrics | Track 5 section + `docs/ASSESSMENT_3_TRACK5_REPORT.md` |
| Security evidence | Hard-problems section below + Track 3 idempotent / resume docs |
| CI link | Paste green Actions URL on DCT (workflow present) |
| Demo (3–5 min) | Suggested flow in Demo script below |
| Role credentials | DCT / DM only |
| `assessment-3` GitHub Release | Follow `docs/releases/assessment-3.md` then paste Release + green Actions URLs into DCT |

---

## Hard problems (bonus / raise-the-bar)

| # | Problem | Implementation | Evidence status |
|---|---------|----------------|-----------------|
| 1 | Idempotent applications | `UNIQUE (job_id, seeker_id)` + `applyToJob` 23505 → `already_applied` | Helper `src/lib/apply-to-job.ts`; tests `idempotent-apply.test.ts`, `apply-to-job-concurrency.test.ts` (parallel **mock** race). Live UNIQUE claimed in Track 3 docs — **reconfirm on hosted DB for DCT**. |
| 2 | Secure resume storage & access | Private `resumes` bucket + RLS + authorize-before-sign + upload PDF/size | Unit mirror + `npm run a3:resume-deny` + `ResumeOpenLink` Access denied — record JSON/screenshot for DCT |
| 3 | Fair matching guardrail | Refuse/neutralize protected-attribute filters before rank | `guardrails/fairness.ts`; agent scenario `fairness-refuse` PASS |
| 4 | Search relevance at ≥20k | Hybrid + re-rank; frozen eval @20k | Inventory 20k/20k gte; Hit@5 **0.70** vs 5k **0.55** on same `a3_v1` |
| 5 | Agent applies end-to-end | Confirm chip → JWT `applyToJob`; respects idempotency + resume ACL | Offline PASS; live discovery + Confirm chip (`docs/a3-agent-apply-mode-b.json`); DCT screen-record Confirm→row per `docs/ASSESSMENT_3_AGENT_APPLY_DEMO.md` |

---

## Requirements vs implementation scoreboard

| Official criterion | Max | Implementation verdict | Notes |
|--------------------|----:|------------------------|-------|
| Third-party integration | 20 | **Mostly complete** | Resend out + Svix in + HubSpot out + Calendar out/in code; live Calendar/Resend smoke pending host secrets |
| Campaign / CRM | 15 | **Complete (code + UI)** | Segments, builder, tracking model; live Confirm&send intentionally skipped in Playwright pass |
| Multi-agent + guardrails + memory | 20 | **Complete (features)** | Path A + Path B `agent_sessions` **live**; Mode B apply demo for Amol Gap 6 |
| Agent & RAG eval harness | 15 | **Complete with honest gaps** | 20k measured; 10k blank; heuristics not LLM-judge; agent eval offline |
| Model improvement | 10 | **Complete (synthetic gate)** | Macro F1 **0.861 ≥ 0.85**; OOD low; no fine-tune |
| CI/CD + observability + security | 15 | **Complete** | Green Actions URL + `assessment-3` Release + Sentry live event (screenshot in `docs/a3-sentry-event-screenshot.png`) |
| Architecture docs / demo / DCT | 5 | **This pack + pending tag/demo URL** | Tag + DCT filing remain process steps |
| **Total** | **100** | | |
| Bonus hard-problems / live / fine-tune | +10 | **Partial** | Hard problems largely coded; live proofs + fine-tune incomplete |

---

## Scoring parameters checklist (for graders)

| Parameter | Max | How HireHub meets it |
|-----------|----:|----------------------|
| Third-party integration | 20 | Resend outbound + Svix-verified inbound; HubSpot upsert; Google Calendar + token-verified push webhook |
| Campaign / CRM | 15 | `new/active/placed` + campaign builder + monotonic tracking |
| Multi-agent + guardrails + memory | 20 | Supervisor → Discovery / Application / Recruiter; fairness/PII/confidence; Path A memory |
| RAG eval harness | 15 | Hybrid+RRF; `a3_v1` Hit@5 0.55→0.70 (5k→20k); agent task-success 18/18 |
| Model improvement | 10 | NB Macro F1 **0.861** / Acc **0.864** on remediated synthetic; P/R/F1 reported |
| CI/CD + observability + security | 15 | GHA Vitest; Sentry optional; AI rate-limit/cache; resume RLS focus |
| Architecture docs, demo & Dev CT | 5 | This report + linked track docs + demo script |
| **Total** | **100** | |

---

## Dev Control Tower checklist

1. Updated live URL + GitHub (**tag an `assessment-3` release**).
2. Architecture diagram showing agents, integrations, and application/resume-security flow (this report §Architecture + Track 3).
3. Evaluation report — agent task-success + RAG metrics, side-by-side vs Assessment 2 (Track 4).
4. Model metrics — precision / recall / F1 (Track 5; Macro F1 0.861).
5. Security evidence — idempotent-application test + resume-access (RLS) denial evidence (unit mirror + live UNIQUE claim; complete live Storage denial write-up if available).
6. CI run link (green), observability/security note, 3–5 min demo, updated role credentials (DCT/DM).

---

## Demo script (3–5 minutes)

1. **Seeker assistant** — ask for jobs by skill; show Discovery cards (approved live jobs only).  
2. **Fairness** — biased prompt (“only hire men under 30…”) → refuse before rank.  
3. **Confirm-to-apply** — propose apply → confirm chip → one application; retry → already applied.  
4. **Recruiter agent** — list owned applicants → propose shortlist → confirm; draft outreach (no silent send).  
5. **CRM** — open `/recruiter/crm` segments + campaign draft/preview/tracking UI.  
6. **Integrations** (if secrets live) — status email / Resend webhook event, or Calendar interview Meet link.  
7. **Evidence slide** — show Track 4 table (5k→20k) and Track 5 Macro F1 0.861 + OOD honesty.

---

## How to reproduce key evidence

```bash
# Unit suite (CI equivalent)
npm test

# Agent task-success (offline)
npm run rag:eval:agents
npm run rag:eval:track4a

# Frozen RAG eval (requires live Supabase corpus + embeddings)
npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=5k
npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=20k
npm run rag:checkpoint
npm run rag:scale -- --stage=A
npm run rag:scale -- --stage=F

# Track 5 classifier (synthetic + OOD)
npm run rag:classify:track5-p5
npm run rag:classify:track5-ood
```

Security-focused unit tests of note:

- `src/test/idempotent-apply.test.ts`
- `src/test/apply-to-job-concurrency.test.ts`
- `src/test/resume-access-rls.test.ts`
- `src/test/phase7-agents.test.ts`
- `src/test/integrations-phase4.test.ts`
- `src/test/ai-match-guard.test.ts`

---

## Known limits and items requiring further validation

1. **Shared memory Path A** resets when the Node/Vite process restarts; Path B durable table apply needs host confirmation.  
2. **Agent eval 100%** is offline mocks — not live mutating UI E2E (Mode B pending isolated non-prod DB).  
3. **Resume ACL live JWT denial matrix** (other recruiter / anon → 403) not fully recorded as a three-party live matrix.  
4. **RAG Precision@k** uses category-proxy grades unless gold `relevantCorpusKeys` are filled; faithfulness/relevance are token heuristics.  
5. **10k frozen eval cell is blank** — corpus was already at 20k; values were not invented.  
6. **Classifier OOD Macro F1 ~0.22** — synthetic gate met; real-world JD performance is not claimed.  
7. **No fine-tuned / local LLM** on the agent path (Gemini chat + gte-small embeddings).  
8. **Google Calendar live push + RSVP smoke** require applied watch migration, public HTTPS, and secrets (runbooks D3–D5).  
9. **CRM Playwright** skipped live Confirm&send; Resend/HubSpot live success depends on host secrets.  
10. **`assessment-3` GitHub Release tag** and **green Actions URL** — publish via `docs/releases/assessment-3.md` and paste into DCT (Amol Gap 1).  
11. **Live URL** for the Assessment 3 build should be confirmed (A2 URL recorded: `https://capture-replay-tool.vercel.app/`).

---

## Key codebase map (quick reference)

| Area | Paths |
|------|-------|
| Auth / roles | `src/lib/auth.tsx`, `src/routes/_app*.tsx`, `src/components/shell/nav.ts` |
| Supervisor / agents | `src/lib/ai/agents/*` |
| Guardrails / memory | `src/lib/ai/guardrails/*`, `src/lib/ai/memory/*` |
| Apply / resume | `src/lib/apply-to-job.ts`, `src/lib/resume-access.ts`, `src/lib/hirehub-storage.ts` |
| RAG | `src/lib/ai/corpus-retrieve.ts`, `corpus-rerank.ts`, `rag-metrics.ts`, `scripts/rag/*` |
| Classifier | `src/lib/ai/job-classifier.ts`, `job-classifier-enrichment.ts`, `scripts/rag/train-job-classifier.mjs` |
| CRM | `src/lib/crm/*`, `src/routes/_app.recruiter.crm*.tsx` |
| Integrations | `src/lib/integrations/*`, `supabase/functions/resend-webhook`, `sync-interview-rsvp` |
| Observability / CI | `src/lib/observability/sentry.ts`, `.github/workflows/ci.yml` |
| Tests | `src/test/` (~97 Vitest files), `e2e/` Playwright smoke |

---

## Golden rule

Depth over breadth: HireHub ships **real Resend + verified Svix webhook** (plus Calendar/HubSpot code paths), a **supervised multi-agent flow with fairness**, **honest RAG eval at 5k and 20k** on one frozen bank, a **remediated classifier with Macro F1 ≥ 0.85**, and **idempotent apply + resume ACL design** — without inventing unverified live numbers.

---

*SJ Innovation — Internal. Assessment 3 (continuation of Assessment 2). Prepared by Priya Das for mentor review. Confidential.*

*Analysis method: assignment brief (`.pdf_extract.txt` / Assessment3 PDF) + sample submission formats (QuickBite / CareBridge) + inspection of source, migrations, scripts, committed `scripts/rag/out/` artifacts, and Assessment 3 track/phase docs. No source code, env, schema, or git state was modified to produce this document.*
