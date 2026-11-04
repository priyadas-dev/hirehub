# HireHub — Assessment 3 Engineering Rules

**Status:** Binding reference for Assessment 3 work.  
**Mode:** Update this file when a material technical decision or lesson changes.  
**Source brief:** `.pdf_extract.txt` (SJ Innovation Assessment 3).  
**Do not** treat chat summaries as overriding this file.

**Product decisions:**
- Integration pair: **Resend + HubSpot + Resend Svix webhook** — approved as Phase 3 contract baseline; **Phase 4 implementation landed** (libs + `resend-webhook` EF + soft wire after in-app notify). Fallback Resend + Stripe test webhook only if HubSpot is blocked.
- CRM model: **lightweight HireHub CRM as in-app source of truth + optional HubSpot sync ids** — Phase 5 implementation landed under `/recruiter/crm` (not two competing CRMs).

**Still pending:**
- Live corpus baseline full category histogram SQL / eval-artifact commit policy — before Phase 8 scale.
- Migration gaps (`PROPOSED_0019` apply; `PROPOSED_0018` history marker only; `PROPOSED_0020`/`0021`/`0022` DDL may be live — **history registration markers still pending approval**; do not apply/repair without it).
- Deploy `resend-webhook` Edge Function + set `RESEND_WEBHOOK_SECRET` / `HUBSPOT_ACCESS_TOKEN` / `RESEND_FROM_EMAIL` in host secrets (never commit values).
- Phase 6 (supervisor/discovery/guardrails/memory) **implemented in code** — see `docs/ASSESSMENT_3_PHASE_6_REPORT.md`.
- Phase 7 (application + recruiter agents) **implemented in code** — see `docs/ASSESSMENT_3_PHASE_7_REPORT.md`; Phase 8 not started.

---

## 1. Project context and reusable architecture

HireHub is a TanStack Start + Supabase app with roles **seeker / recruiter / admin**. Role always comes from `profiles.role` via `src/lib/auth.tsx` and `ROLE_HOME` / `wrongRoleHome` — never from the browser as authority.

**Reuse — do not rebuild without a written reason:**
- Auth session + role gates (`src/lib/auth.tsx`, `_app.seeker|recruiter|admin.tsx`)
- Apply uniqueness `UNIQUE (job_id, seeker_id)` and seeker apply UX
- AI Job Assistant pipeline (`ask-job-assistant.ts`, `job-assistant.ts`, `assistant-intent.ts`, `/seeker/assistant`)
- Live recommend + skill match (`live-recommend.ts`, `skill-match.ts`)
- Hybrid corpus RAG + re-rank (`corpus-retrieve.ts`, `corpus-rerank.ts`, seed/embed scripts)
- Offline job-category classifier + compare/tune modules
- Automations: skill-match notify, application-status notify, close-expired-jobs
- Resume validation + signed URLs (`resume-upload.ts`, `hirehub-storage.ts`, PROPOSED_0008)
- Shell nav/visual identity (`src/components/shell/nav.ts`)

Assessment 3 adds integrations, CRM, multi-agent orchestration, stronger eval at ≥20k, CI/observability, and hard-problem proofs — as **additive** layers.

### Official Assessment 2 metrics to preserve as baseline (do not “pick the highest”)

| Experiment | Model | Headline numbers | Role in reporting |
|---|---|---|---|
| Primary classifier (Track 4) | Multinomial Naive Bayes | Acc **~95.3%**, macro F1 **~0.937** (template_group, seed 42) | Official A2 accuracy evidence |
| Comparator | TF-IDF + Logistic Regression | Acc **~75.38%**, macro F1 **~0.741** (`fixed_preset`) | Baseline comparator only |
| Ablation | NB description-only | **100%** | Diagnostic of residual synthetic signal — **not** headline |
| Ablation | NB title-only (masked) | **~26.4%** | Diagnostic |
| RAG retrieval | Hybrid gte + FTS + re-rank | Overall category hit@k **~72.5%**; matching **~77.4%**; noisy **~63.2%** | Official A2 RAG retrieval evidence |
| Early RAG bank | Same stack, 13 queries | Noisy **~20%** | Superseded methodology — do not cite as current quality |

**Fact check:** The historical “100%” problem was primarily the **classifier**, not RAG hit-rate. Live corpus counts in A2 docs (5000 rows / 5000 `embedding_gte` / 1015 legacy `embedding`) must be **re-verified** before any scale work.

---

## 2. Assessment 2 lessons and root causes

| ID | Lesson | Root cause | Preventive rule |
|----|--------|------------|-----------------|
| L1 | Classifier “100%” was suspicious | Synthetic leakage (category text, templates, easy description signal) | Leakage suite before publishing scores |
| L2 | Tiny RAG eval bank misled (e.g. noisy 20%) | Under-powered category-proxy queries | Freeze independent labelled eval before scaling |
| L3 | RLS recursion outage (0016→0017) | Cross-table EXISTS under RLS | Definer helpers + recursion test |
| L4 | Migration history desync | Dashboard/drizzle/CLI multi-lane applies | One register workflow; no blind push |
| L5 | OAuth recruiter role lost repeatedly | Role claim not durable | Freeze auth; test claim matrix |
| L6 | Score-chasing via reseed risk | Temptation to wipe embeddings | Never delete/overwrite valid gte vectors to chase metrics |
| L7 | Secrets / PII in repo history risk | `.env` once tracked; public contact churn | No secrets in git/docs; never print env values |

---

## 3. Mistakes that must never be repeated

1. Never publish ≥90–100% synthetic scores without leakage diagnostics.  
2. Never evaluate RAG only with queries derived from the same templates as indexed docs.  
3. Never add RLS that joins another RLS table without a proven non-recursive pattern.  
4. Never `db reset` or rewrite applied migration history on the linked project.  
5. Never use service role to insert applications or read resumes “for the agent.”  
6. Never mix 768-d and 384-d embeddings in one column / provider space.  
7. Never commit passwords, API keys, or webhook secrets.  
8. Never redesign the whole UI to “look more AI.”  
9. Never maintain two CRM sources of truth.  
10. Never claim “done” without the tests/acceptance criteria for that change.  
11. Never mark pending product/migration decisions as finalized without explicit user approval.  
12. Never modify `.env` or apply/repair migrations without explicit user permission.

---

## 4. RAG dataset generation rules

1. Corpus rows are synthetic practice context only — never insert into `public.jobs` or recommend as live vacancies.  
2. Preserve existing `synthetic:v1:00000`–`04999` (or current live keys); **append** new keys for 10k/20k.  
3. Do not delete corpus rows to improve evaluation scores.  
4. Improve diversity (phrasing, skills, duties); avoid identical boilerplate sentences across thousands of rows.  
5. Keep category distribution approximately balanced across `JOB_CORPUS_CATEGORIES`.  
6. Run duplicate / near-duplicate checks before large upserts.  
7. Upsert **must omit** embedding columns so existing vectors are not nullified (follow `seed-job-corpus.mjs` pattern).  
8. Tag source clearly (`hirehub-synthetic-v1` / successor); never silently change meaning of old keys.

### Staged 20k scale (implementation only after approval)

- **Stage A:** Preserve and validate existing ~5k baseline (live counts, histogram, dups, freeze current eval output).  
- **Stage B:** Test improved generation on a small sample (new keys only; dry-run seed).  
- **Stage C:** Evaluate sample diversity, leakage, balance, duplicates; freeze independent eval set v3.  
- **Stage D:** Expand to 10k; embed **pending null `embedding_gte` only**; evaluate frozen set.  
- **Stage E:** Expand to 20k with the same controls.  
- **Stage F:** Compare 5k / 10k / 20k on the **same** frozen eval set; keep retrieval metrics separate from answer-quality metrics.

---

## 5. RAG evaluation and leakage prevention

1. Keep an **independent** eval set, authored separately from `corpus-generate.ts`, with manual relevance labels where claiming Precision@k / nDCG.  
2. Freeze the eval set **before** scaling past the validated baseline.  
3. Compare 5k / 10k / 20k using **exactly the same** frozen eval set.  
4. Separate **retrieval metrics** (Hit@k, Precision@k, Recall@k, MRR, nDCG) from **answer metrics** (faithfulness, answer relevance, context precision/recall).  
5. Do not treat classifier accuracy as a RAG score.  
6. Category-hit@k is a weak proxy — label it as such; prefer document-level labels for A3.  
7. If any primary metric is >90% or 100%, run leakage checklist before accepting.  
8. If <80% on the agreed hard set, investigate retrieval/generation — do not sabotage quality to hit a band.  
9. Do not reseed or overwrite embeddings to chase scores.  
10. Attach or archive eval JSON used in reports (`scripts/rag/out/` is gitignored — submission must still evidence numbers).

---

## 6. Embedding and database safety

1. Default corpus provider remains **gte-small (384)** in `embedding_gte` unless a measured failure forces change.  
2. Gemini/local 768 vectors stay in `embedding` only — never write them into `embedding_gte`.  
3. Bulk embed requires dry-run mindset + explicit confirm flag (e.g. `--confirm-gte-bulk`) for large limits.  
4. Embed **pending nulls only**; support interrupted resume.  
5. Verify dimension length before write.  
6. Do not run `reset-corpus-embeddings` against production without written approval and a restore plan.  
7. Live inventory (counts, nulls, categories) before and after each scale stage.

---

## 7. Database and migration safety

1. **Authoritative CLI history:** `supabase/migrations/`.  
2. **Authoritative feature SQL text:** `drizzle/migrations/PROPOSED_*.sql` (and early `0000`–`0003`).  
3. New DDL is additive only; prefer new tables/columns/functions over rewriting old policies.  
4. Creating a PROPOSED file does **not** apply or register it — follow list → dry-run → apply one → verify.  
5. Never re-execute SQL that is already live but only missing from history — use markers + `repair --status applied` when approved.  
6. Finish known gap `PROPOSED_0019` only with explicit approval.  
7. Register `PROPOSED_0018` history carefully if still untracked — do not re-run FTS DDL.  
8. Before any policy on joins across RLS tables, add a recursion safety review (see 0017).  
9. App code must degrade gracefully if optional PROPOSED objects are missing (probe pattern).  
10. See `docs/supabase-migration-history-reconciliation.md` before any history sync work.

---

## 8. Multi-agent architecture rules

1. Agents: Supervisor, Discovery, Application, Recruiter + Guardrail layer only.  
2. Reuse existing assistant/retrieve/recommend code paths.  
3. Supervisor routes; specialists do not bypass guardrails.  
4. Shared memory is server-side per user/conversation; localStorage is UX cache only.  
5. Tools authorized by verified JWT + `profiles.role` + ownership checks.  
6. Application agent **must** require explicit user confirmation before insert.  
7. Fairness guardrail runs **before** ranking/filtering recommendations.  
8. Recruiter tools limited to owned company/jobs.  
9. Failed handoffs return structured errors; no silent apply/email.  
10. Do not add agents only to increase count.

### Intended responsibilities (design; implement only after approval)

| Component | Responsibility |
|---|---|
| Supervisor | Classify turn; route; enforce guardrails; merge structured result; write shared memory |
| Discovery | Recommend/filter via `live-recommend` + corpus retrieve; never invent vacancies |
| Application | save/status/apply tools; apply only after explicit confirmation |
| Recruiter | Shortlist/draft outreach for owned jobs; may draft CRM outreach |
| Guardrails | Validation, PII redaction, low-confidence refuse, structured I/O, fairness before rank |

---

## 9. Security and RLS requirements

1. Never weaken RLS to make demos easier.  
2. Never trust role/userId from request body (follow notify-application-status pattern).  
3. Resume access: seeker owner + recruiter for **that** job only; prove other recruiter denial with a test.  
4. Keep `UNIQUE (job_id, seeker_id)`; prove parallel duplicate apply yields one row.  
5. Signed URLs short TTL; do not persist long-lived signed URLs in DB.  
6. Service role only for admin/corpus/cron paths already established — not user apply.

---

## 10. Integration and webhook rules

1. **Recommended (pending approval):** Resend + HubSpot outbound + Resend Svix-signed inbound webhook.  
2. Verify vendor signatures; reject unsigned/invalid.  
3. Idempotent webhook handling on provider event id.  
4. Do not pretend cron shared secrets are vendor webhooks for Track 1.  
5. **CRM (pending approval):** HireHub lightweight tables as UX source of truth; HubSpot sync optional — one truth for campaign state shown in-app.  
6. Gracefully handle Resend free-tier/domain failures without leaking API keys in UI.  
7. Do not implement Calendar/Stripe/Slack in v1 unless the approved integration pair requires a fallback.

---

## 11. Testing standards

Required for A3 hard problems / Track 6 evidence:
- Parallel idempotent apply
- Resume RLS denial (wrong recruiter)
- Fairness refusal/neutralization
- Unsigned webhook rejected
- AI endpoint rate-limit behavior
- Regression: auth role routing (`AUTH_UNIT_REGRESSION_*` patterns)

Every meaningful feature ships with unit and/or integration coverage named in the PR/notes. E2E may skip without secrets but must not be the only proof for security claims.

Establish CI early (run unit tests on push/PR) once security proof tests exist — do not leave CI only for the final day.

---

## 12. Git and environment-variable rules

1. Do not commit `.env` or secrets.  
2. Never use `VITE_` for `GEMINI_API_KEY`, service role, Resend, HubSpot, webhook secrets.  
3. Do not print secret values in logs, docs, or chat.  
4. Do not modify `.env` without explicit user permission.  
5. Prefer small commits; no force-push of rewritten published history (Lovable constraint in `AGENTS.md`).  
6. Tag `assessment-3` only when acceptance criteria for submit pack are met.

---

## 13. Performance and scalability rules

1. Rate-limit and short-cache AI match/assistant endpoints.  
2. Avoid fan-out of multiple full LLM calls per turn without budget.  
3. Batch embeds; measure retrieve latency at 5k/10k/20k.  
4. Do not load entire 20k corpus into the app process for eval — use DB retrieval paths.

---

## 14. Deployment and verification rules

1. Use verification checklists (extend A2 sheet) before claiming live readiness.  
2. Confirm migrations/probes on the linked project before demo claims (esp. FTS, resume storage, 0019).  
3. DCT submission: live URL, GitHub release, architecture diagram, eval vs A2, model metrics, security tests, CI link, demo, credentials via private channel only.

---

## 15. Known limitations and unresolved risks

1. Classifier description-only ablation can still hit 100% on synthetic text.  
2. A2 RAG metric is primarily category-hit@k, not graded doc relevance.  
3. `scripts/rag/out/` artifacts often absent from git — reports must cite reproducible commands.  
4. Migration history still fragile around 0018/0019.  
5. Live corpus counts in docs may drift — always re-count before scale.  
6. Integration vendor choice and CRM depth remain **pending user approval**.  
7. Hard-problem automated proofs (parallel apply, resume 403) are not yet in the suite.

---

## 16. Mandatory pre-implementation checklist

Before any major A3 change, complete `docs/ASSESSMENT_3_PRE_IMPLEMENTATION_CHECKLIST.md` and record outcomes in the task notes.

---

## 17. Rules for future AI-assisted coding

1. Read this file first.  
2. Inspect existing code; reuse before rewrite.  
3. Explain approach for major changes before editing.  
4. Small controlled steps + tests.  
5. Verify before claiming completion; list what remains unverified.  
6. If a request conflicts with these rules, stop and explain the conflict.  
7. If a rule must change, update this document explicitly — never silently ignore it.  
8. Never modify `.env` or apply migrations without explicit user approval.  
9. Never generate, delete, or overwrite RAG records/embeddings without explicit approval.  
10. Never weaken authentication, RLS, or application workflows for convenience.  
11. Treat unresolved decisions as pending — do not silently mark them finalized.  
12. Stop and wait for approval when moving from documentation/planning into Assessment 3 feature implementation.
```