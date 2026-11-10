# HireHub Assessment 3 — Phase 0 Baseline

**Phase:** 0 only (freeze baseline + eval design; no feature implementation)  
**Completed:** 2026-11-02  
**Branch:** `feature/auth-module-phases-1-7` @ `95b5637`  
**Binding rules:** `docs/ASSESSMENT_3_ENGINEERING_RULES.md`  
**Roadmap:** `docs/ASSESSMENT_3_IMPLEMENTATION_ROADMAP.md`  
**Checklist used:** `docs/ASSESSMENT_3_PRE_IMPLEMENTATION_CHECKLIST.md`

**Phase 0 mutation statement:** No application code, migrations, RLS, `.env`, corpus rows, or embeddings were inserted, updated, deleted, reseeding, re-embedded, or overwritten during this phase. Only documentation was added (`docs/ASSESSMENT_3_BASELINE.md`).

---

## 1. Phase 0 completion summary

| Acceptance criterion (roadmap) | Status |
|---|---|
| A2 classifier headline frozen as NB ~95.3% / F1 ~0.937 (not description-only 100%; not TF-IDF as primary) | **Met** |
| A2 RAG headline frozen (~72.5% / 77.4% / 63.2% category-hit@k per A2 report) | **Met** (see §4 for local JSON nuance) |
| Frozen eval-set **design** written (independent queries; metrics families separated; 5k→10k→20k protocol) | **Met** (§6) |
| Explicit: no corpus/embedding mutation | **Met** |
| Live RAG inventory | **Partially met** — exact counts + RPC probes verified live; full category histogram limited by API page size (SQL provided) |

**Phase 0 Definition of Done:** Baseline artifact + frozen eval methodology design exist. **Ready for your Phase 0 approval checkpoint.** Phase 1 is **not** started.

---

## 2. Current Git and working-tree state

| Item | Value |
|---|---|
| Branch | `feature/auth-module-phases-1-7` (tracks `origin/feature/auth-module-phases-1-7`) |
| HEAD | `95b5637` — *Ignore local IDE folders and capture-replay-tool dump.* |
| Tracked modifications | **None** at Phase 0 start/end for app/config/migrations |
| Untracked (planning / prior) | `.pdf_extract.txt`, `docs/ASSESSMENT_3_ENGINEERING_RULES.md`, `docs/ASSESSMENT_3_PRE_IMPLEMENTATION_CHECKLIST.md`, `docs/ASSESSMENT_3_IMPLEMENTATION_ROADMAP.md`, `docs/new one.md`, `skills-lock.json` |
| Created this phase | `docs/ASSESSMENT_3_BASELINE.md` |
| CI workflows | **Absent** (no `.github/workflows`) |

No commit or push was performed.

---

## 3. Existing feature reuse inventory

### Verified in repository (code present — reuse for A3)

| Area | Evidence paths |
|---|---|
| Auth + role from `profiles.role` | `src/lib/auth.tsx`, `_app.seeker\|recruiter\|admin.tsx` |
| Apply UNIQUE + UI handling | `drizzle/migrations/0000_hirehub_core_schema.sql`, `_app.seeker.jobs.$jobId.tsx` |
| AI Job Assistant (single agent) | `ask-job-assistant.ts`, `job-assistant.ts`, `assistant-intent.ts`, `/seeker/assistant` |
| Live recommend + skill match | `live-recommend.ts`, `skill-match.ts` |
| Hybrid RAG + re-rank | `corpus-retrieve.ts`, `corpus-rerank.ts`, `PROPOSED_0018` (drizzle) |
| Seed/embed (safe patterns) | `scripts/rag/seed-job-corpus.mjs`, `embed-job-corpus.mjs` |
| Classifier + compare | `job-classifier.ts`, `job-classifier-compare.ts`, `job-classifier-tfidf-lr.ts` |
| Automations | `job-skill-match-notify.ts`, `notify-application-status`, `close-expired-jobs` |
| Resume validate + signed URLs | `resume-upload.ts`, `hirehub-storage.ts`, `PROPOSED_0008` |
| Resend outbound (contact/account) | `submit-contact.ts`, `send-account-mail.ts` |
| Unit tests | `src/test/*` (63 files); Playwright e2e scripts in `package.json` |

### Documented historically but not assumed live without probe

| Claim | Doc source | Live/repo verification this phase |
|---|---|---|
| 5000 corpus + 5000 gte + 1015 embedding | A2 report | **Live verified** (§5) |
| FTS / hybrid ready | A2 report / verification | **Live RPC** `search_job_corpus_fts` + `match_job_corpus_gte` callable |
| `claim_oauth_recruiter_role` | Migration 0019 files | **Live missing** (RPC not exposed) |
| Parallel apply + resume 403 tests | A3 hard problems | **Not in suite** (grep: no dedicated tests) |
| GitHub Actions CI | Track 6 | **Not present** |

---

## 4. Frozen Assessment 2 metrics and evidence

### 4.1 Classifier (official Track 4 headline)

| Field | Frozen value | Evidence class |
|---|---|---|
| Model (primary) | Multinomial Naive Bayes | Repo + docs |
| Comparator | TF-IDF + Logistic Regression (`fixed_preset` when holdout non-discriminative) | Repo |
| Dataset | 5000 synthetic classifier examples (`generateClassifierLabeledExamples`) | Repo |
| Split | 80/20 **template_group**, seed **42** → 3814 / 1186 | Repo JSON + docs |
| Accuracy (primary) | **0.952782… (~95.3%)** | `scripts/rag/out/classifier-eval.json` + `CLASSIFIER_HISTORICAL_REFERENCE` |
| Macro F1 (primary) | **0.93655… (~0.937)** | Same |
| TF-IDF accuracy / F1 | **~75.38% / ~0.741** | Historical reference + verification doc |
| Description-only ablation | **100%** | A2 report — **diagnostic only** |
| Title-only ablation | **26.4%** | A2 report — diagnostic |
| Near-dup / group overlap | 0 / 0 | A2 report |

**Per-class P/R/F1 (documented A2 report; design weak):** design recall 0.325 / F1 0.491; marketing precision 0.597 / F1 0.748; most other classes 1.000 on synthetic holdout.

**Do not use as official headline:** description-only 100%; TF-IDF as primary Track 4 proof.

### 4.2 RAG retrieval (official A2 report table — frozen narrative)

| Set | Cases | Category hit-rate@k (A2 report, 27 Oct 2026) |
|---|---:|---:|
| matching | 31 | **77.4%** (24/31) |
| noisy | 19 | **63.2%** (12/19) |
| edge | 6 | **16.7%** (1/6) |
| Overall (category-labelled) | 51 | **72.5%** (37/51) |
| Clean pairs | 16 | **75.0%** |
| Noisy pairs | 16 | **68.8%** |

| Config | Value |
|---|---|
| Provider | `gte` / gte-small |
| k | 5 |
| Hybrid + FTS + re-rank | Documented; local `eval-report.json` has `hybrid: true`, `ftsReady: true` |
| Eval bank size | **56** queries in `EVAL_QUERY_BANK` |
| Metric type | **Category hit@k** (not document-level relevance) |

### 4.3 Local eval artifact nuance (repository evidence)

File: `scripts/rag/out/eval-report.json` (`generatedAt`: 2026-10-27T13:02:57.122Z)

| Metric in JSON | Value |
|---|---|
| `categoryHitRate` | **0.745098…** (38/51) |
| `cleanCategoryHitRate` | 0.75 |
| `noisyCategoryHitRate` | 0.6875 |
| `emptyResultRate` | ~0.0179 |
| `failedCalls` | 0 |

**Implication:** Clean/noisy pair rates match the A2 report. Overall category-hit in this JSON is **~74.5%**, while the published A2 report table uses **72.5%**. Phase 0 **freezes the A2 report table as the submission narrative baseline** and records the JSON overall as a secondary local artifact. **Do not re-run eval in Phase 0** to force agreement. Before Phase 8 Stage F, re-run once on the frozen bank and record a single canonical baseline file under an approved docs path if desired.

### 4.4 Automated tests (this session)

| Check | Result | Evidence class |
|---|---|---|
| `npm test` | **63 files / 492 tests passed** (2026-11-02, ~111s) | **Verified now** |
| E2E | Not re-run (optional; skips without `E2E_*` secrets) | Not verified this phase |
| CI on push | No workflow | Verified absent |

### 4.5 Embedding / corpus provider (code + live)

| Item | Value | Status |
|---|---|---|
| App provider env | `EMBEDDING_PROVIDER=gte` | Present in env (value only; secrets not logged) |
| gte dimensions (code) | **384** (`GTE_EMBEDDING_DIMENSIONS`) | Repo |
| Gemini/legacy dimensions (code) | **768** | Repo |
| Live sample dims | gte **384**, embedding **768** (3 samples each) | Live verified |

---

## 5. Live RAG inventory

**Method:** Read-only Supabase REST `count=exact` + small samples + RPC probes. Secrets were not printed. Service role was used only for corpus inventory/RPC existence checks (no writes).

**Project context (docs):** `munqgybiuqpncxbgfvdp` (not re-printed as a secret).

### 5.1 Counts — live verified 2026-11-02

| Metric | Live count |
|---|---:|
| Total `job_corpus` rows | **5000** |
| Corpus-only (`job_id` IS NULL) | **5000** |
| `embedding_gte` populated | **5000** |
| `embedding_gte` null | **0** |
| Legacy `embedding` populated | **1015** |
| Legacy `embedding` null | **3985** |

Matches A2 report inventory.

### 5.2 Category distribution — partial / needs SQL completion

A single unpaginated select returned the API default page (**1000** rows). Sum of returned categories = 1000 ≠ 5000.

**Sample of first page only (NOT full corpus):**

| Category | Count (first 1000 rows only) |
|---|---:|
| sales | 88 |
| finance | 87 |
| engineering | 86 |
| education | 86 |
| healthcare | 85 |
| hr | 85 |
| product | 84 |
| design | 83 |
| marketing | 82 |
| data | 79 |
| operations | 78 |
| customer_support | 77 |
| **Distinct** | **12** |

**Unavailable without further approved read-only pagination or SQL Editor:** full 5000-row category histogram; exact duplicate-content statistics beyond key uniqueness on a full scan.

**Safe SQL for later verification (Dashboard SQL Editor — read-only):**

```sql
-- Corpus inventory
select
  count(*) as total_rows,
  count(*) filter (where job_id is null) as corpus_only,
  count(*) filter (where embedding_gte is not null) as gte_populated,
  count(*) filter (where embedding_gte is null) as gte_null,
  count(*) filter (where embedding is not null) as emb_populated,
  count(*) filter (where embedding is null) as emb_null
from public.job_corpus;

-- Full category histogram (corpus-only)
select category, count(*)
from public.job_corpus
where job_id is null
group by category
order by category;

-- Duplicate corpus_key check
select corpus_key, count(*)
from public.job_corpus
where job_id is null
group by corpus_key
having count(*) > 1;

-- Embedding dimension sanity (pgvector)
select
  vector_dims(embedding_gte) as gte_dims,
  count(*)
from public.job_corpus
where embedding_gte is not null
group by 1;
```

### 5.3 RPC / migration-effect probes — live verified

| RPC / object | Live result |
|---|---|
| `search_job_corpus_fts` | **Present / callable** (PROPOSED_0018 effects) |
| `match_job_corpus_gte` | **Present / callable** |
| `claim_oauth_recruiter_role` | **Missing / not exposed** (PROPOSED_0019 not applied) |

### 5.4 Duplicate notes

- Exact `corpus_key` duplicates on the first API page: **0** (incomplete for full 5k).  
- Generator design intentionally reuses base titles × seniority (many near-similar texts) — full near-dup scan deferred to Phase 8 Stage A/C with approved tooling.  
- Generator expected ~balanced 12-way split at 5k (~416–417 each); live full histogram still required via SQL above.

---

## 6. RAG evaluation readiness and 5k / 10k / 20k protocol

### 6.1 Current evaluation bank (repo — not modified)

| Property | Value |
|---|---|
| Source | `src/lib/ai/corpus-eval.ts` → `EVAL_QUERY_BANK` |
| Size | **56** |
| matching / noisy / edge | **31 / 19 / 6** |
| With `expectCategory` | **51** |
| Clean↔noisy pair ids | **16** |
| Document-level relevance labels (`relevantCorpusKeys`) | **None** |
| Independently authored vs generator | Hand-written bank, but lexicon heavily overlaps titles/skills in `corpus-generate.ts` |
| Faithfulness / answer-relevance harness | **Not present** for A2 |
| Precision@k / MRR / nDCG on graded docs | **Not present** (category-hit proxy only) |

**Risks already known:** category-proxy metric; query–template lexical overlap; no “no relevant doc” gold set with labelled negatives beyond weak edge cases.

### 6.2 What a reliable independent eval set requires (design freeze — do not build in Phase 0)

1. Separate file (e.g. future `scripts/rag/eval-sets/a3_v1.jsonl`) **not** generated by `corpus-generate.ts`.  
2. Manual graded relevance to specific `corpus_key`s (0/1/2) or explicit `none`.  
3. Mix: paraphrases, noisy, ambiguous, hard multi-skill, no-hit.  
4. No category slug dumped into query as a free hint unless testing that failure mode.  
5. Freeze **before** Stage D (10k).  
6. Same frozen set used at 5k, 10k, and 20k.  
7. Keep **retrieval** metrics separate from **answer-generation** metrics.

### 6.3 Controlled comparison protocol (Stages A–F) — design only

| Stage | Action | Acceptance (design) |
|---|---|---|
| A | Preserve 5k; live counts; freeze current bank results as A2 narrative + optional re-run artifact later | No deletes; baseline filed |
| B | Small append sample (new keys only); dry-run seed | Keys disjoint from `synthetic:v1:00000`–`04999` |
| C | Diversity / leakage / balance / dups on sample; author independent labelled set | Leakage checklist signed |
| D | Expand to 10k; embed **null `embedding_gte` only**; eval frozen set | No wipe of existing vectors |
| E | Expand to 20k; same embed rules | ≥20k corpus-only |
| F | Compare 5k/10k/20k on **same** frozen set | Side-by-side table vs A2 |

**Retrieval metrics (target for Phase 8):** Hit@K / Recall@K, Precision@K (needs doc labels), MRR, nDCG@K (needs graded relevance). Category-hit@k retained as legacy comparator only.  
**Answer metrics (separate):** faithfulness, answer relevance, context precision/recall on fixed questions.  
**Suspicion protocol:** if primary metric >90% or 100%, run leakage checks before accepting.  
**Provider rule:** keep `gte` 384 in `embedding_gte`; never mix 768 into that column.

**Phase 0 constraint honored:** evaluation bank and corpus **unchanged**.

---

## 7. Migration and security readiness

### 7.1 Migration directories

| Lane | Role | Notes |
|---|---|---|
| `supabase/migrations/` | CLI / remote history authority | Includes remote stubs + proposed_0007–0016, 0017 marker, **0019 file** |
| `drizzle/migrations/` | Full feature SQL text | `0000`–`0003`, `PROPOSED_0004`–`0019`, **includes 0018 FTS** |
| Gap | **0018** | SQL in drizzle only; **effects live** (FTS RPC callable); **no** matching `supabase/migrations` version file |
| Gap | **0019** | Files in both trees; **function missing live**; do not apply without approval |

### 7.2 Unresolved history concerns (from reconciliation doc + this probe)

- Historical Dashboard/CLI desync documented in `docs/supabase-migration-history-reconciliation.md`.  
- Stub markers for remote-only versions exist locally.  
- Do **not** `db reset`, blind `db push`, or re-run live FTS DDL.  
- 0018 history marker / 0019 apply remain **pending your approval** — not Phase 0 / not Phase 1 blockers for security-proof coding against existing schema.

### 7.3 Security / auth risks relevant to A3 (repo evidence)

| Risk | Evidence | Phase impact |
|---|---|---|
| No parallel idempotent-apply test | Missing in `src/test` | **Phase 1** |
| No wrong-recruiter resume denial test | Missing | **Phase 1** |
| UNIQUE apply exists | `0000` schema + UI 23505 handling | Reuse in Phase 1 |
| RLS recursion previously fixed | `PROPOSED_0017` + live `seeker_has_applied_to_job` pattern | Do not regress |
| OAuth recruiter claim RPC missing | Live probe | Auth polish; **not** Phase 1 blocker |
| Service-role misuse by future agents | Engineering rules | Phases 6–7 |
| No CI | No `.github/workflows` | Phase 2 |
| Fairness guardrail absent | No module | Phase 6 |

---

## 8. Known risks and unresolved decisions

### Pending approvals (not silently finalized)

| Decision | Blocks |
|---|---|
| Integration pair (Resend+HubSpot+Svix vs fallback) | Phase **3–4** (not Phase 1) |
| CRM model (thin HireHub + optional HubSpot sync) | Phase **5** (not Phase 1) |
| Eval artifact commit policy under `docs/` | Phase **8/11** packaging |
| Apply/repair 0019 | OAuth claim completeness — optional for Phase 1 |
| 0018 history marker only | Hygiene — optional for Phase 1 |
| Phase 1 start authorization | **Required before coding Phase 1** |

### Technical risks carried forward

1. Category-hit@k overstates “relevance”; independent labelled set still only **designed**.  
2. Query bank ↔ generator lexicon overlap.  
3. Description-only classifier 100% remains a synthetic-leakage warning.  
4. Dual embedding columns (384 vs 768) — do not mix.  
5. Full category histogram not completed live (API page limit) — use SQL in §5.2.  
6. A2 report overall 72.5% vs local JSON ~74.5% — freeze report narrative; reconcile on next approved eval re-run.

---

## 9. Phase 1 readiness and blocking dependencies

| Question | Answer |
|---|---|
| Can Phase 1 start after your approval? | **Yes** |
| Hard blockers from Phase 0? | **None** for security-proof work |
| Soft dependencies | Keep UNIQUE + resume RLS as-is; extract shared apply helper; add parallel + denial tests |
| Must integrations/CRM be decided first? | **No** |
| Must 0018/0019 be fixed first? | **No** for Phase 1 |
| Must 20k RAG start first? | **No** — blocked until Phase 8 + approvals |
| Must live full category SQL be run first? | **No** for Phase 1; **yes before Phase 8 Stage A sign-off** |

### Phase 1 scope reminder (do not expand)
- Idempotent apply helper + parallel duplicate test  
- Wrong-recruiter resume access denial test  
- No multi-agent, no CRM, no webhook, no corpus scale  

---

## 10. Evidence table

| Finding | Source / query | Verification status | Implications |
|---|---|---|---|
| Branch `feature/auth-module-phases-1-7` @ 95b5637 | `git` | Verified now | Worktree planning docs untracked |
| NB acc 0.95278 / F1 0.93655 | `classifier-eval.json`, `CLASSIFIER_HISTORICAL_REFERENCE` | Repo artifact | Official classifier baseline |
| TF-IDF ~75.38% / 0.741 | Historical reference + verification md | Repo/docs | Comparator only |
| RAG A2 table 72.5/77.4/63.2 | `docs/assessment-2-report.md` | Documented | Submission narrative freeze |
| Local eval overall ~74.5% | `scripts/rag/out/eval-report.json` | Repo artifact | Note nuance; don’t silently overwrite A2 table |
| Eval bank 56 (31/19/6), 16 pairs | `corpus-eval.ts` runtime count | Verified now | Category-hit proxy only |
| Corpus 5000 / gte 5000 / emb 1015 | Live count | **Live verified** | Matches A2; preserve |
| gte dim 384 / emb dim 768 | Live sample + code constants | Live + repo | No mixing |
| FTS + match_gte RPCs | Live RPC probe | **Live verified** | 0018 effects present |
| claim_oauth missing | Live RPC probe | **Live verified** | 0019 unapplied |
| Category histogram full 5k | — | **Unavailable this run** (1000-row page) | Run SQL §5.2 before scale |
| `npm test` 492 passed | Vitest this session | **Verified now** | Suite healthy |
| No CI workflows | Glob `.github/workflows` | Verified absent | Phase 2 work |
| No parallel apply / resume denial tests | Grep `src/test` | Verified absent | Phase 1 deliverables |
| No corpus mutation in Phase 0 | Process controls | Verified by scope | Safety |

---

## 11. Exact next recommended action

1. **You review and approve** this Phase 0 baseline (`docs/ASSESSMENT_3_BASELINE.md`).  
2. Optionally run the **read-only SQL** in §5.2 in Supabase SQL Editor and paste counts back (full category histogram) — recommended before Phase 8, **not required** to start Phase 1.  
3. When ready, **explicitly authorize Phase 1 only**: security proofs (shared idempotent apply helper + parallel duplicate test + wrong-recruiter resume denial test).  
4. Continue to defer: integrations/CRM vendor choice, 0018/0019 migration actions, corpus scale, multi-agent implementation.

---

## Appendix A — Phase 0 pre-implementation checklist (executed)

- [x] Read engineering rules, checklist, roadmap  
- [x] Map to Phase 0 / Track 4 enabling work  
- [x] Confirm not implementing A3 features  
- [x] Inspect existing code/docs/tests/scripts/migrations  
- [x] No `.env` edits; secrets not printed  
- [x] No migrations applied/repaired  
- [x] No RAG generate/delete/overwrite  
- [x] Live read-only inventory attempted; limits documented  
- [x] Eval design frozen without changing bank  
- [x] Unverified items explicitly listed  
- [x] Pending approvals remain pending  

## Appendix B — Reproduce commands (no mutation)

```bash
# Unit tests
npm test

# Offline classifier metrics (regenerates gitignored JSON; optional — not run to “improve” Phase 0)
npm run rag:classify

# RAG eval against live corpus (read-only retrieve; optional later)
npm run rag:eval -- --provider=gte
```

Do **not** run `rag:seed`, `rag:embed`, `rag:reset-embeddings`, or migration apply/repair for Phase 0 follow-ups unless newly approved.
```