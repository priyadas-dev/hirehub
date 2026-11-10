# HireHub — Assessment 3 Implementation Roadmap

**Status:** Permanent planning reference. Implementation starts only after explicit phase approval.  
**Source brief:** `.pdf_extract.txt` (SJ Innovation Assessment 3).  
**Binding rules:** `docs/ASSESSMENT_3_ENGINEERING_RULES.md`  
**Pre-flight:** `docs/ASSESSMENT_3_PRE_IMPLEMENTATION_CHECKLIST.md`

## Roadmap identity (do not reorder silently)

This document **preserves** the latest dependency-aware roadmap from the final Assessment 3 technical review:

| Order | Phase (unchanged) |
|------:|-------------------|
| 0 | Freeze A2 metrics + live corpus counts + freeze RAG eval-set design |
| 1 | Security proofs (idempotent apply + resume denial tests) |
| 2 | CI skeleton (unit tests on push/PR) |
| 3 | Integration contracts (Resend/HubSpot/webhook shapes + idempotency) |
| 4 | Implement integrations + signed webhook |
| 5 | Thin CRM aligned to HubSpot field map / Recruiter agent outputs |
| 6 | Guardrails + supervisor + discovery |
| 7 | Application agent (confirm) + recruiter agent |
| 8 | RAG Stages A→F (eval frozen before D/E) |
| 9 | Model report (existing NB F1) |
| 10 | Sentry + AI rate-limit/cache + advisor pass |
| 11 | Docs / demo / release / DCT |

**Note on “11-phase” naming:** The review ordered work as **Phase 0 through Phase 11** (baseline + eleven subsequent stages). This file keeps that **exact order**. Do not invent a new sequence without documenting why and obtaining approval.

**Official vs optional:** Each phase marks work as **Official (marks / brief)** or **Optional (bonus / polish)**. Optional items must not block Definition of Done for official marks unless you explicitly expand scope.

---

## How Assessment 2 / Assessment 3 engineering rules must be followed

Before **any** phase implementation:

1. Read `docs/ASSESSMENT_3_ENGINEERING_RULES.md`.  
2. Complete `docs/ASSESSMENT_3_PRE_IMPLEMENTATION_CHECKLIST.md` for that phase.  
3. Reuse working A2 functionality; do not rebuild auth, RLS cores, assistant shell, hybrid RAG, or classifier without a written reason.  
4. Never modify `.env`, apply/repair migrations, or generate/delete/overwrite RAG embeddings without explicit approval.  
5. Never weaken authentication, RLS, or application workflows.  
6. Treat unresolved decisions as **pending** — recommendations are not approvals.  
7. Add tests with meaningful changes; verify before claiming completion.  
8. Update engineering rules when a lasting decision is made.  
9. Stop at each phase **Approval checkpoint** until you approve the next phase.

---

## Official marking map → phases

| Official criterion | Max | Primary phase(s) | Supporting phase(s) |
|---|---:|---|---|
| Third-party integration (≥2 services, 1 outbound + 1 inbound signed webhook) | 20 | **3** (contracts), **4** (implement) | 5 (uses email/webhook), 11 (demo evidence) |
| Campaign / CRM module (segments, campaigns, tracking) | 15 | **5** | 3–4 (email/webhook), 7 (recruiter agent alignment), 11 |
| Multi-agent orchestration + guardrails + memory | 20 | **6**, **7** | 1 (safe apply), 11 (diagram/demo) |
| Agent & RAG evaluation harness (hybrid + re-rank, metrics vs A2) | 15 | **0** (freeze), **8** (scale + eval) | 6–7 (agent scenarios), 11 (eval report) |
| Model improvement (F1 reported, target ≥0.85; fine-tune optional) | 10 | **9** | 11 (model metrics in submit pack) |
| CI/CD + observability + security (RLS advisor) + AI rate-limit/cache | 15 | **2** (CI early), **10** (Sentry/advisor/limit) | 1 (security tests in CI), 11 (CI link) |
| Architecture docs, demo & Dev Control Tower submission | 5 | **11** | All prior phases supply artifacts |
| **Total** | **100** | | |

### Hard problems (bonus / raise-the-bar) — tracked separately

| Hard problem | Max contribution | Primary phase(s) | Official note |
|---|---|---|---|
| 1. Idempotent applications + parallel test | Part of **+10** bonus set | **1** | Also submission security evidence |
| 2. Secure resume storage + wrong-recruiter denial test | Part of **+10** bonus set | **1** | Also submission security evidence |
| 3. Fair matching guardrail | Part of **+10** bonus set | **6** | Required with multi-agent guardrails |
| 4. Search relevance at ≥20k (hybrid + re-rank, vs A2) | Part of **+10** bonus set | **0**, **8** | Tied to Track 4 metrics |
| 5. Agent applies end-to-end with confirmation | Part of **+10** bonus set | **7** (depends on **1**) | Must respect idempotency + resume ACL |
| Live production integration / fine-tuned local model | Optional bonus paths | 4 / 9 | **Optional** — do not block 100-point path |

Bonus ceiling in brief: **+10** for the hard-problems set, a live production integration, **or** a fine-tuned/local model used by the agent.

---

## Decisions still requiring your approval

Do **not** treat these as finalized until you explicitly approve:

1. **Integration pair** — Recommended: Resend + HubSpot + Resend Svix webhook; fallback Resend + Stripe test webhook.  
2. **CRM model** — Recommended: lightweight HireHub CRM as in-app source of truth + optional HubSpot sync ids (not two competing CRMs).  
3. **Live corpus baseline re-count** — Read-only inventory before Phase 0 write artifacts / before Phase 8 scale.  
4. **Eval artifact policy** — Whether sanitized metric summaries may be committed under `docs/` (`scripts/rag/out/` is gitignored).  
5. **Migration 0019** — Apply `claim_oauth_recruiter_role` only with separate approval.  
6. **Migration 0018 history** — Marker/`repair` only if approved; **never** re-run live FTS DDL.  
7. **Phase start** — Explicit approval required before Phase 0 and before each subsequent phase.  
8. **Optional scope** — Fine-tune / Stripe / Calendar / Slack / UI redesign — off by default.

---

## Phase 0 — Freeze A2 baseline + RAG eval-set design

**Objective:** Preserve honest Assessment 2 numbers and freeze evaluation methodology before any scale or feature risk.

**Marks:** Enables Track 4 honesty (15) and Hard problem 4; no direct mark alone.

**Official / optional:** **Official prerequisite** (methodology freeze). Optional: prettier baseline charts.

### Tasks
1. Re-read A2 report metrics (classifier NB vs TF-IDF comparator vs RAG category-hit@k).  
2. With approval: read-only live counts for corpus rows, `embedding_gte`, legacy `embedding`, category histogram.  
3. Document baseline table into an A3 baseline note (paths TBD on approval).  
4. Design/freeze independent eval-set requirements (no template-copied queries; retrieval vs answer metrics separated).  
5. Confirm no generate/delete/overwrite of corpus or embeddings in this phase.

### Existing files to reuse
- `docs/assessment-2-report.md`, `docs/assessment-2-verification.md`
- `src/lib/ai/corpus-eval.ts`, `scripts/rag/eval-corpus-rag.mjs`
- `src/lib/ai/job-classifier-compare.ts` (`CLASSIFIER_HISTORICAL_REFERENCE`)
- `docs/ASSESSMENT_3_ENGINEERING_RULES.md` §4–6

### Expected new files
- `docs/assessment-3-baseline.md` (or equivalent) — **only when Phase 0 is approved to write it**
- Eval-set design note / frozen query bank path (when approved)

### Database changes
- **None.** Read-only inventory only if approved.

### Dependencies
- None (first phase). Blocks Phase 8 scale.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Trusting stale doc counts | Live re-count before scale (approved read-only) |
| Starting 20k before freeze | Hard gate: no Stage D/E without frozen eval design |
| Mixing classifier scores into RAG baseline | Keep separate tables |

### Required tests
- None mandatory beyond documenting how `npm run rag:eval` / `rag:classify` reproduce baselines.

### Measurable acceptance criteria
- [ ] A2 classifier headline recorded as NB ~95.3% / F1 ~0.937 (not description-only 100%, not TF-IDF as primary).  
- [ ] A2 RAG headline recorded as ~72.5% / 77.4% / 63.2% category-hit@k.  
- [ ] Frozen eval-set **design** written (queries independent; metrics families separated).  
- [ ] Explicit statement: no corpus/embedding mutation occurred.

### Definition of Done
Baseline artifact + frozen eval methodology design exist; Phase 0 checkpoint signed.

### Approval checkpoint — Phase 0
**STOP.** Do not begin Phase 1 until you approve Phase 0 complete and authorize Phase 1.

---

## Phase 1 — Security proofs (idempotent apply + resume denial)

**Objective:** Prove no double-apply and resume ACL denial before agents can apply.

**Marks:** Hard problems 1–2; DCT security evidence; unblocks Phase 7.

**Official / optional:** **Official** for bonus evidence + submission item 5. Shared apply helper is **Official** prerequisite for agent apply.

### Tasks
1. Extract/share idempotent apply helper from seeker job apply path (reuse UNIQUE + 23505 handling).  
2. Parallel duplicate-apply test → exactly one row.  
3. Wrong-recruiter resume access denial test (RLS/storage 403 or equivalent denial).  
4. Document evidence commands for DCT.

### Existing files to reuse
- `src/routes/_app.seeker.jobs.$jobId.tsx`
- `drizzle/migrations/0000_hirehub_core_schema.sql` (`UNIQUE (job_id, seeker_id)`)
- `src/lib/resume-upload.ts`, `src/lib/hirehub-storage.ts`
- `drizzle/migrations/PROPOSED_0008_secure_resume_portfolio_company_logos.sql`

### Expected new files
- `src/lib/apply-to-job.ts` (or equivalent shared helper)
- `src/test/idempotent-apply*.ts`
- `src/test/resume-access-rls*.ts` (or integration equivalent)

### Database changes
- **None** if PROPOSED_0008 already live. Do not redesign RLS. No 0018/0019 work here.

### Dependencies
- After Phase 0 (or parallel only if you approve skipping baseline write — **default: after Phase 0**).  
- Blocks Phase 7 agent apply; feeds Phase 2 CI.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Weakening RLS to make test pass | Fail the test; fix policy only with approval |
| Service-role apply in tests masking bugs | Prefer user-JWT paths |
| Race not covered | True parallel duplicate test |

### Required tests
- Parallel idempotent apply  
- Other-recruiter resume denial  

### Measurable acceptance criteria
- [ ] Duplicate parallel applies → exactly one `applications` row.  
- [ ] Different recruiter cannot read resume; assertion documented.  
- [ ] Helper used (or ready) for future Application agent.

### Definition of Done
Both security tests green; evidence notes ready; no auth/RLS regressions.

### Approval checkpoint — Phase 1
**STOP.** Await approval before Phase 2.

---

## Phase 2 — CI skeleton

**Objective:** Run the full unit test suite on every push/PR early (Track 6 foundation).

**Marks:** Part of Track 6 (15); enables green CI link for Phase 11.

**Official / optional:** **Official** CI on push/PR. Optional: coverage badges, matrix OS.

### Tasks
1. Add GitHub Actions workflow running `npm test` (and lint/build if already reliable).  
2. Ensure Phase 1 tests are included when present.  
3. Document how E2E skips without secrets (existing pattern).

### Existing files to reuse
- `package.json` scripts (`test`, `lint`, `build`)
- Playwright skip-without-secrets pattern
- Auth unit regression file lists if present

### Expected new files
- `.github/workflows/ci.yml` (or equivalent)

### Database changes
- None.

### Dependencies
- Phase 1 tests should exist (or CI lands then expands). Default order: **after Phase 1**.

### Risks and prevention
| Risk | Prevention |
|---|---|
| CI red from env secrets | Don’t require `.env` secrets for unit CI |
| Late CI | Do not defer entire Track 6 to Phase 10 |

### Required tests
- Workflow must run existing Vitest suite successfully on PR.

### Measurable acceptance criteria
- [ ] Push/PR triggers CI.  
- [ ] Green run link obtainable.  
- [ ] No secret values in workflow logs.

### Definition of Done
CI green on main/PR with unit suite; documented.

### Approval checkpoint — Phase 2
**STOP.** Await approval before Phase 3.

---

## Phase 3 — Integration contracts (no vendor coding yet)

**Objective:** Finalize shapes for outbound calls, inbound webhooks, idempotency, and env names **before** implementation.

**Marks:** Enables Track 1 (20) and Track 2 tracking.

**Official / optional:** **Official** contract work. Vendor choice remains **pending approval**.

### Tasks
1. Confirm approved integration pair (or stop if still pending).  
2. Write contract: Resend application-status email payload; HubSpot sync fields; Resend webhook events; signature header verification; idempotency keys.  
3. Map CRM tracking states `sent|opened|replied|applied` to webhook/app events.  
4. Unsigned webhook → reject test plan.  
5. Env var **names only** (no values; no `.env` edits).

### Existing files to reuse
- `src/lib/submit-contact.ts`, `src/lib/resend-errors.ts`, `src/lib/send-account-mail.ts`
- `supabase/functions/notify-application-status`
- Cron auth timing-safe compare patterns

### Expected new files
- `docs/assessment-3-integration-contracts.md` (or equivalent)

### Database changes
- None in Phase 3 (design only). Note candidate additive tables for Phase 4/5.

### Dependencies
- Your approval of integration/CRM decisions.  
- Blocks Phase 4–5 coding.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Coding before contract | Hard stop without approved pair + written contract |
| Cron secret as “webhook” | Contract must require vendor signature |

### Required tests
- Test plan written (implemented in Phase 4).

### Measurable acceptance criteria
- [ ] Approved vendors named in writing.  
- [ ] Outbound + inbound + idempotency specified.  
- [ ] Unsigned rejection planned.  
- [ ] Single CRM source-of-truth stated.

### Definition of Done
Contract doc approved by you.

### Approval checkpoint — Phase 3
**STOP.** Await approval before Phase 4.

---

## Phase 4 — Implement integrations + signed webhook

**Objective:** Deliver ≥2 real services, one outbound action, one inbound signature-verified webhook.

**Marks:** Track 1 **20**.

**Official / optional:** **Official** Resend + second approved service + signed webhook. Optional: live HubSpot production portal polish beyond sync.

### Tasks
1. Resend: application-status email alongside existing in-app notify (do not remove in-app).  
2. Second service outbound (HubSpot sync **if approved**, else approved fallback).  
3. Inbound webhook endpoint with signature verification + idempotent event store.  
4. Wire minimal delivery/open events for CRM Phase 5.  
5. Tests for signature failure and idempotent replay.

### Existing files to reuse
- Resend helpers; notify-application-status EF; Phase 3 contract

### Expected new files
- `src/lib/email/application-status-mail.ts` (or equivalent)
- `src/lib/hubspot/*` (if approved)
- `supabase/functions/resend-webhook/` or server route webhook
- Tests for webhook verify/idempotency

### Database changes
- **Additive only** if approved: e.g. `email_delivery_events` (provider event id unique).  
- No rewrite of applications/notifications RLS. No 0018/0019 unless separately approved.

### Dependencies
- Phase 3 contract + vendor approval.  
- Enables Phase 5 open tracking.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Forged webhooks | Verify Svix/vendor signature |
| Replay duplicates | Upsert on event id |
| Resend free-tier failure | Graceful errors; keep in-app notify |
| Secret leakage | Server-only env; never `VITE_` |

### Required tests
- Unsigned/invalid signature rejected  
- Replay does not duplicate side effects  
- Outbound path unit-tested with mocked provider  

### Measurable acceptance criteria
- [x] ≥2 external services used in product paths.  
- [x] One outbound demo.  
- [x] One inbound signed webhook demo.  
- [x] Unsigned rejected.

### Definition of Done
Track 1 demos reproducible; tests green; secrets not committed.  
**Phase 4 code complete (2026-11-02)** — see `docs/ASSESSMENT_3_PHASE_4_REPORT.md`. Live secret setup + `PROPOSED_0020` apply + EF deploy remain manual/approved steps.

### Approval checkpoint — Phase 4
**STOP.** Await approval before Phase 5.

---

## Phase 5 — Thin CRM (segments, campaigns, tracking)

**Objective:** Recruiter talent-pool / outreach module with segments, campaign send, and tracking.

**Marks:** Track 2 **15**.

**Official / optional:** **Official** segments (`new|active|placed`), campaign builder, tracking (`sent|opened|replied|applied`). Optional: full HubSpot UI mirror, IMAP reply parsing (prefer manual “replied” if needed).

### Tasks
1. Additive CRM tables + recruiter-owned RLS (approved schema).  
2. Recruiter UI under existing shell; add nav item only.  
3. Send via Resend; mark sent; ingest opened via Phase 4 webhook.  
4. Align field map with future Recruiter agent outputs.  
5. Keep single source of truth per approved CRM decision.

### Existing files to reuse
- `_app.recruiter.applicants.tsx`, `src/components/shell/nav.ts`
- Phase 4 Resend/webhook
- Application status enum / applicants pipeline

### Expected new files
- `_app.recruiter.campaigns*.tsx` (or equivalent)
- `src/lib/crm/*`
- CRM RLS SQL as `PROPOSED_00xx` (**apply only with approval**)

### Database changes
- Additive campaigns/segments/recipients tables + RLS.  
- Optional HubSpot id columns.  
- Do not overload `notifications` CHECK for all campaign events.

### Dependencies
- Phase 4. Align interfaces for Phase 7 recruiter agent.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Dual CRM truth | One in-app SoT; HubSpot sync optional |
| Recruiter sees all seekers | Ownership/consent-scoped queries only |
| RLS recursion | Definer helpers; policy review |

### Required tests
- Segment → send → sent/opened path (unit/integration)  
- RLS: recruiter cannot read another recruiter’s campaigns  

### Measurable acceptance criteria
- [x] Segments available.  
- [x] Campaign can send.  
- [x] Tracking shows sent/opened (and applied linkage when possible).  
- [x] UI matches existing HireHub identity (no redesign).

### Definition of Done
Track 2 demo path works end-to-end on approved stack.  
**Phase 5 code complete (2026-11-02)** — see `docs/ASSESSMENT_3_PHASE_5_REPORT.md`. Live persistence requires approved apply of `PROPOSED_0020` + `PROPOSED_0021` and Resend/HubSpot secrets.

### Approval checkpoint — Phase 5
**STOP.** Await approval before Phase 6.

---

## Phase 6 — Guardrails + supervisor + discovery agent

**Objective:** Supervised multi-agent foundation with shared memory and fairness; discovery reuses live/corpus recommend.

**Marks:** Track 3 **20** (partial until Phase 7); Hard problem 3.

**Official / optional:** **Official** supervisor, discovery, guardrails (validation, PII, low-confidence, fairness), shared memory. Optional: rich trace UI polish.

### Tasks
1. Supervisor/router over specialists.  
2. Guardrail layer: validation, PII redaction, low-confidence refusal, structured outputs, **fairness before rank**.  
3. Discovery agent wrapping `live-recommend` + corpus retrieve.  
4. Server shared memory keyed by user + conversation.  
5. Fairness test: biased prompt refused/neutralized.  
6. Evolve — do not replace — seeker assistant entrypoints.

### Existing files to reuse
- `ask-job-assistant.ts`, `job-assistant.ts`, `assistant-intent.ts`
- `live-recommend.ts`, `corpus-retrieve.ts`, `skill-match.ts`
- `/seeker/assistant` UI

### Expected new files
- `src/lib/ai/agents/supervisor.ts`
- `src/lib/ai/agents/discovery.ts`
- `src/lib/ai/guardrails/*`
- `src/lib/ai/memory/*`
- Fairness unit tests

### Database changes
- Optional additive `agent_sessions` / memory table with user-scoped RLS — only if approved; may start in-memory/JSON.

### Dependencies
- Phase 1 recommended before any apply tools (Phase 7).  
- Fairness before shipping discovery recommendations.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Service-role tools | User JWT only for user actions |
| Bias in ranking | Hard fairness gate pre-rank |
| Rebuilding assistant | Wrap existing pipeline |

### Required tests
- Fairness refusal/neutralization  
- Supervisor routes discovery without inventing jobs  
- Role gate: seeker-only where required  

### Measurable acceptance criteria
- [x] Supervisor → discovery path works.  
- [x] Guardrails invoked.  
- [x] Biased prompt test passes.  
- [x] Shared memory readable across turns for specialists.

### Definition of Done
Discovery + guardrails + memory demonstrable; fairness evidence recorded.  
**Phase 6 code complete (2026-11-02)** — see `docs/ASSESSMENT_3_PHASE_6_REPORT.md`. Live Resend/HubSpot/webhook remain a separate ops track. Phase 7 approved and completed separately.

### Approval checkpoint — Phase 6
Cleared by user request to start Phase 7.

---

## Phase 7 — Application agent + recruiter agent

**Objective:** Real tool-taking agents: confirm-to-apply; recruiter shortlist/outreach draft under ownership.

**Marks:** Completes Track 3 **20**; Hard problem 5.

**Official / optional:** **Official** application agent with confirmation + idempotency/resume ACL; recruiter agent shortlist/draft. Optional: fully autonomous multi-step without user confirm (forbidden by brief — not optional to skip confirm).

### Tasks
1. Application agent tools: pick job, attach resume, **confirm**, submit via Phase 1 helper.  
2. Status/save checks as tools.  
3. Recruiter agent: shortlist + draft outreach; respect company/job ownership; align with CRM fields.  
4. Structured handoff errors.  
5. Agent task scenarios drafted for Phase 8 eval.

### Existing files to reuse
- Phase 1 apply helper; resume paths  
- Phase 5 CRM types/APIs  
- Phase 6 supervisor/memory/guardrails  

### Expected new files
- `src/lib/ai/agents/application.ts`
- `src/lib/ai/agents/recruiter.ts`
- Confirm-apply UI affordance in assistant  
- Tests for confirm required; unconfirmed does not insert  

### Database changes
- None required beyond Phase 1/6; no service-role inserts.

### Dependencies
- Phase 1 (mandatory), Phase 6 (mandatory), Phase 5 (interface alignment).

### Risks and prevention
| Risk | Prevention |
|---|---|
| Accidental apply | Explicit confirmation step |
| Double apply | UNIQUE + helper + tests |
| Cross-company recruiter actions | Ownership checks + RLS |

### Required tests
- Unconfirmed apply → zero rows  
- Confirmed apply → one row; duplicate safe  
- Recruiter tool denied for non-owned job  

### Measurable acceptance criteria
- [x] E2E agent apply with confirm works. *(unit + supervisor + seeker confirm chip; live browser UNVERIFIED)*  
- [x] Idempotency + resume ACL respected.  
- [x] Recruiter agent demo on owned job. *(unit + `askRecruiterAgent` server fn; dedicated recruiter chat UI not added)*

### Definition of Done
Hard problem 5 + Track 3 specialists complete.  
**Phase 7 code complete (2026-11-03)** — see `docs/ASSESSMENT_3_PHASE_7_REPORT.md`.

### Approval checkpoint — Phase 7
**STOP.** Await approval before Phase 8.

---

## Phase 8 — RAG Stages A→F (scale + eval harness)

**Objective:** Preserve 5k, scale to ≥20k safely, report retrieval + answer metrics vs A2 on a frozen eval set; agent task-success %.

**Marks:** Track 4 **15**; Hard problem 4.

**Official / optional:** **Official** hybrid+rerank (already exists), ≥20k, hit-rate/precision@k/faithfulness vs A2, agent task-success. Optional: nDCG dashboards, extra visualization.

### Tasks
1. Execute Stages A→F per engineering rules (freeze → sample → leakage checks → 10k → 20k → compare).  
2. Append-only keys; embed pending `embedding_gte` only; confirm bulk flags.  
3. Independent labelled eval set (frozen in Phase 0 design).  
4. Agent scenario eval using Phase 6–7 tools.  
5. Write side-by-side A2 vs A3 evaluation report.

### Existing files to reuse
- `corpus-generate.ts`, `corpus-retrieve.ts`, `corpus-rerank.ts`, `corpus-embed.ts`
- `scripts/rag/seed-job-corpus.mjs`, `embed-job-corpus.mjs`, `eval-corpus-rag.mjs`
- Phase 0 baseline

### Expected new files
- Frozen eval set under `scripts/rag/eval-sets/` (or approved path)
- Faithfulness / precision@k helpers
- `scripts/rag/eval-agent-scenarios.mjs`
- `docs/assessment-3-evaluation-report.md`

### Database changes
- More `job_corpus` rows only (append).  
- No provider/dimension mix.  
- No delete of baseline 5k.  
- No migration 0018 re-apply.

### Dependencies
- Phase 0 freeze; Phases 6–7 for meaningful agent eval.  
- Your approval before any seed/embed.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Wipe embeddings | Omit embeddings on upsert; no reset without approval |
| Eval leakage | Independent labelled set; suspicion protocol if >90%/100% |
| Mixing metrics | Retrieval vs generation tables separate |

### Required tests
- Leakage/dup checks on generator sample  
- Eval script runs at each scale checkpoint  
- Agent scenario harness produces task-success %  

### Measurable acceptance criteria
- [ ] ≥20k corpus-only rows with gte vectors for new rows.  
- [ ] Same frozen eval compared at 5k/10k/20k.  
- [ ] Precision@k / hit-rate / faithfulness (and answer relevance) reported vs A2.  
- [ ] Agent task-success % reported.  
- [ ] No baseline destruction.

### Definition of Done
Evaluation report complete and honest; Stage F table exists.

### Approval checkpoint — Phase 8
**STOP.** Await approval before Phase 9.

---

## Phase 9 — Model report (existing classifier F1)

**Objective:** Satisfy Track 5 with reported precision/recall/F1 (target ≥0.85).

**Marks:** Track 5 **10**.

**Official / optional:** **Official** report existing NB masked template_group metrics. **Optional:** LoRA/Ollama fine-tune, shortlist-likelihood model — only after marks locked / explicit approval.

### Tasks
1. Re-run `npm run rag:classify` / compare as needed.  
2. Publish P/R/F1 + caveats (synthetic; description-only 100% is diagnostic).  
3. Optionally note TF-IDF comparator (~75.38% / 0.741) as baseline — not primary claim.

### Existing files to reuse
- `job-classifier.ts`, `job-classifier-compare.ts`, `scripts/rag/train-job-classifier.mjs`
- A2 report tables

### Expected new files
- Section in A3 model/eval docs

### Database changes
- None.

### Dependencies
- None hard; place after Phase 8 so submit pack is coherent.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Claiming real-world perfection | Keep synthetic caveats |
| Spending time on fine-tune early | Defer optional fine-tune |

### Required tests
- Existing classifier unit tests remain green.

### Measurable acceptance criteria
- [ ] Macro F1 ≥ 0.85 reported with method.  
- [ ] Per-class P/R/F1 included.  
- [ ] Optional fine-tune clearly marked optional/absent.

### Definition of Done
Track 5 evidence ready for DCT.

### Approval checkpoint — Phase 9
**STOP.** Await approval before Phase 10.

---

## Phase 10 — Sentry + AI rate-limit/cache + advisor pass

**Objective:** Complete Track 6 beyond CI: observability, AI hardening, security advisor follow-ups.

**Marks:** Completes Track 6 **15** (with Phase 2 CI).

**Official / optional:** **Official** Sentry (or equivalent error tracking), structured logs note, advisor pass (esp. resumes), rate-limit + cache on AI match/assistant. Optional: full APM dashboards.

### Tasks
1. Add Sentry (server/client carefully; no secret leakage).  
2. Rate-limit + short cache on `askJobAssistant` / AI match path.  
3. Supabase advisor review; additive fixes only with approval.  
4. Ensure Phase 1 security tests still in CI.

### Existing files to reuse
- Phase 2 workflow  
- `submit-contact.ts` rate-limit pattern  
- Gemini retry/rate_limit handling  

### Expected new files
- Sentry init modules  
- `src/lib/ai/rate-limit-cache.ts` (or equivalent)  
- Short observability/security note for DCT  

### Database changes
- Only if advisor requires additive policy fixes — separate approval.

### Dependencies
- Phase 2 CI; Phase 1 tests; AI routes stable from Phases 6–7.

### Risks and prevention
| Risk | Prevention |
|---|---|
| PII in Sentry | Scrub bodies; don’t log resume bytes |
| Cache leaking across users | Key by userId + input hash |

### Required tests
- Rate-limit behavior test  
- CI still green  

### Measurable acceptance criteria
- [ ] Sentry event proof (non-secret).  
- [ ] AI endpoint throttles/caches as designed.  
- [ ] Advisor findings addressed or explicitly deferred with rationale.  
- [ ] CI green link still valid.

### Definition of Done
Track 6 complete.

### Approval checkpoint — Phase 10
**STOP.** Await approval before Phase 11.

---

## Phase 11 — Docs, demo, release, Dev Control Tower

**Objective:** Submit Assessment 3 with all required evidence.

**Marks:** Track 7 **5** (+ package all prior marks).

**Official / optional:** **Official** DCT items below. Optional: extra marketing video length beyond 3–5 min.

### Tasks
1. Architecture diagram (agents, integrations, apply/resume security).  
2. Evaluation report vs A2; model metrics; security evidence; CI link; observability note.  
3. 3–5 min demo.  
4. `assessment-3` git tag + GitHub Release.  
5. Live URL + role credentials via private channel (not in public PDF).  
6. File on Dev Control Tower.

### Existing files to reuse
- A2 report structure; all phase artifacts

### Expected new files
- `docs/assessment-3-*.md` submit pack pieces  
- Diagram asset  

### Database changes
- None.

### Dependencies
- Phases 0–10 artifacts as applicable to claimed marks.

### Risks and prevention
| Risk | Prevention |
|---|---|
| Secrets in report | Emails only; passwords via DCT/DM |
| Claiming unverified live state | Re-run verification checklist |

### Required tests
- No new feature tests required; confirm CI green and security tests still pass.

### Measurable acceptance criteria
- [ ] All six DCT submission bullets covered.  
- [ ] Release tagged.  
- [ ] Demo recorded/ready.  

### Definition of Done
Submission filed; roadmap complete for claimed scope.

### Approval checkpoint — Phase 11
**STOP.** Post-submit changes are out of this roadmap unless you open a new approved task.

---

## Dependency graph (summary)

```text
Phase 0 (baseline + eval freeze)
    ↓
Phase 1 (security proofs) ───────────────┐
    ↓                                    │
Phase 2 (CI)                             │
    ↓                                    │
Phase 3 (integration contracts) ←── your vendor/CRM approval
    ↓                                    │
Phase 4 (integrations + webhook)         │
    ↓                                    │
Phase 5 (CRM) ───────────────────────────┼──→ Phase 7 recruiter agent alignment
    ↓                                    │
Phase 6 (guardrails + supervisor + discovery)
    ↓                                    │
Phase 7 (application + recruiter agents) ←┘
    ↓
Phase 8 (RAG A→F + agent/RAG eval) ←── Phase 0 freeze
    ↓
Phase 9 (model report)
    ↓
Phase 10 (Sentry + rate-limit + advisor)
    ↓
Phase 11 (docs / demo / release / DCT)
```

---

## Final submission evidence checklist (DCT)

Official brief requirements:

- [ ] Updated live URL + GitHub (`assessment-3` tag / Release)  
- [ ] Architecture diagram (agents, integrations, application/resume-security flow)  
- [ ] Evaluation report — agent task-success + RAG metrics, side-by-side vs Assessment 2  
- [ ] Model metrics (precision/recall/F1; fine-tune comparison only if attempted)  
- [ ] Security evidence — idempotent-application test + resume-access denial test  
- [ ] CI run link (green)  
- [ ] Note on observability/security added  
- [ ] 3–5 min demo  
- [ ] Updated role credentials (private channel — not public secrets)

Hard-problem / bonus evidence (separate):

- [ ] Fair matching guardrail demo/test  
- [ ] ≥20k hybrid+rerank relevance vs A2  
- [ ] Agent confirm-to-apply E2E  
- [ ] Optional: fine-tune or extra live production integration — only if approved

---

## Official requirements vs optional improvements

| Item | Class |
|---|---|
| Tracks 1–7 as scored in brief | **Official** |
| Hard problems 1–5 | **Official raise-the-bar / bonus set** (strongly expected for standing out) |
| Resend + HubSpot + Svix webhook | **Recommended official path** — pending approval |
| Lightweight CRM + optional HubSpot sync | **Recommended official path** — pending approval |
| Hybrid RAG + re-rank | **Official** (already largely implemented; scale/eval remain) |
| Classifier F1 report ≥0.85 | **Official** (largely satisfied by A2 NB) |
| CI + Sentry + AI rate-limit/cache + advisor | **Official** |
| LoRA/Ollama fine-tune | **Optional** |
| Shortlist-likelihood model | **Optional** (alternative Track 5 path; not needed if F1 reported) |
| Stripe / Calendar / Slack | **Optional fallback/extra** — not default |
| UI redesign / new design system | **Out of scope** |
| IMAP auto “replied” detection | **Optional**; manual replied allowed if documented |
| Dual HubSpot-primary + full custom CRM | **Forbidden** (two sources of truth) |

---

## Current freeze

- This roadmap document is saved for planning only.  
- **Do not start Phase 0** until you explicitly approve.  
- Do not modify engineering rules/checklist in lockstep unless you request an update.  
- Unresolved decisions remain pending (see section above).
```