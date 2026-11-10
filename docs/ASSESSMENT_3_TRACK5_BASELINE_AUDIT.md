# Assessment 3 — Track 5 Baseline Audit (Task 5A)

**Status:** Inspection only (no training, no code changes, no commits)  
**Date:** 2026-11-09  
**Scope:** Existing job-category classifier / datasets / evaluation vs Track 5 options  
**Final package:** See [`ASSESSMENT_3_TRACK5_REPORT.md`](./ASSESSMENT_3_TRACK5_REPORT.md)  
**Track 5 requirement (either):**

1. Improve an existing classifier to **F1 ≥ 0.85** with proper precision/recall evaluation, **or**
2. Build a **Shortlist Likelihood Model**

---

## 1. Inventory — training & evaluation scripts

| Role | Path | Notes |
|------|------|-------|
| Train + evaluate CLI | `scripts/rag/train-job-classifier.mjs` | `npm run rag:classify` |
| Baseline model (NB) | `src/lib/ai/job-classifier.ts` | Multinomial Naive Bayes + splits + metrics |
| Classifier dataset builder | `src/lib/ai/job-classifier-dataset.ts` | Classifier-oriented descriptions (duties + tools) |
| TF-IDF + LogReg comparator | `src/lib/ai/job-classifier-tfidf-lr.ts` | Experimental OvR logistic regression |
| Hyperparameter selection | `src/lib/ai/job-classifier-tune.ts` | Train-only group holdout → often falls back to fixed preset |
| Side-by-side comparison | `src/lib/ai/job-classifier-compare.ts` | Shared split for NB vs TF-IDF |
| Synthetic corpus generator | `src/lib/ai/corpus-generate.ts` | Source of titles/labels/groups |
| Original-description prototype eval | `src/lib/ai/classifier-original-prototype.ts` + `classifier-original-eval.ts` | Separate gte-small nearest-prototype check |
| Unit tests | `src/test/job-classifier*.test.ts`, `classifier-original-prototype.test.ts` | Split leakage, metrics, preprocess |

**Saved offline artifacts (local, under `scripts/rag/out/` — typically gitignored):**

| Artifact | Generated | Contents |
|----------|-----------|----------|
| `classifier-eval.json` | 2026-10-28 | NB baseline report (P/R/F1, confusion matrix, diagnostics) |
| `classifier-compare.json` | 2026-10-28 | NB + TF-IDF + tuning + historical reference |
| `original-description-eval.json` | 2026-10-27 | Prototype eval on n=12 hand-written rows |

**Not found:** Shortlist Likelihood training scripts, labeled shortlist datasets, model checkpoints beyond in-memory train-on-eval, or fine-tuning notebooks.

---

## 2. Existing model architecture & features

### 2.1 Primary baseline — Multinomial Naive Bayes

- **Kind:** `multinomial_nb` (`TrainedJobClassifier`)
- **Task:** Predict 1 of **12** job categories from text
- **Features:** Token counts from **title + description only** (gold `category` never used as a feature)
- **Preprocess (features only):**
  1. Strip synthetic shortcuts (skill-list line, category-revealing opener, shared boilerplate, variant-seed footer)
  2. Mask explicit category names/slugs (and a few aliases)
  3. Lowercase tokenize (`[^a-z0-9_+#]+`, length ≥ 2)
- **Training:** Additive smoothing (α=1); class log-priors with Laplace; vocabulary fitted on train only
- **Prediction:** Argmax of class log-prior + Σ log P(token \| class)

### 2.2 Experimental comparator — TF-IDF + one-vs-rest LogReg

- Word n-grams (up to 2–3) + char n-grams + title repeat emphasis
- Vectorizer / weights fit on **train only**
- Hyperparams often selected via `FIXED_TFIDF_LOGREG_HYPERPARAMS` because train-only template-group holdout is non-discriminative (~0% for all candidates)

### 2.3 Separate offline check — gte-small class prototypes

- Not the NB classifier; nearest prototype cosine ≥ 0.5
- Tiny hand-labeled original-description set (12 rows)
- Does **not** write to `embedding_gte`

---

## 3. Dataset details

| Property | Value |
|----------|-------|
| Source | **Synthetic** (`generateSyntheticJobCorpus` → `generateClassifierLabeledExamples`) |
| Size | **5000** labeled examples (default pipeline) |
| Classes | **12** (`JOB_CORPUS_CATEGORIES`) |
| Unique IDs | 5000 / 5000 (no duplicate `corpus_key`) |
| Missing title/description/category/id | **0** |
| Template groups (`category::baseTitle`) | **55** (one per base title across classes) |
| Real vacancy labels | **None** in the classifier training set |

### 3.1 Full-corpus class distribution (n=5000)

| Class | Count |
|-------|------:|
| engineering | 417 |
| data | 417 |
| design | 417 |
| product | 417 |
| marketing | 417 |
| sales | 417 |
| operations | 417 |
| finance | 417 |
| healthcare | 416 |
| education | 416 |
| customer_support | 416 |
| hr | 416 |

Nearly balanced (round-robin over 12 categories).

### 3.2 Classifier feature text vs RAG corpus text

Classifier examples **replace** generator boilerplate descriptions with occupational duty + toolkit language (`job-classifier-dataset.ts`) so NB still has signal after masking/stripping.  
Track-1 RAG corpus rows / `embedding_gte` are **not** overwritten by this path.

### 3.3 Split used for baseline metrics

| Item | Value |
|------|-------|
| Mode | `template_group` stratified 80/20 |
| Seed | 42 |
| Train / test | **3814 / 1186** |
| ID overlap train∩test | 0 (asserted) |
| Template-group overlap | 0 (asserted) |
| Same-class near-dup rate (Jaccard ≥ 0.9) | **0** |

**Test support (group split):** mostly ~104/class; `data` / `design` / `marketing` = 83; `product` = 105.

---

## 4. Baseline metrics (held-out)

Source: `scripts/rag/out/classifier-eval.json` (2026-10-28), regenerated via `npm run rag:classify`.

### 4.1 Multinomial NB (headline baseline)

| Metric | Value |
|--------|------:|
| Accuracy | **0.9528 (95.28%)** |
| Macro F1 | **0.9366** |
| Weighted F1 (computed from per-class F1 × support; **not stored in report**) | **≈ 0.9467** |
| Target in code | accuracy ≥ 0.70 (`CLASSIFIER_TARGET_ACCURACY`) |
| Meets Track 5 F1 ≥ 0.85 (on this synthetic split) | **Yes (macro & weighted)** |

**Per-class P / R / F1 (NB):**

| Class | Precision | Recall | F1 | Support |
|-------|----------:|-------:|---:|--------:|
| engineering | 1.000 | 1.000 | 1.000 | 104 |
| data | 1.000 | 1.000 | 1.000 | 83 |
| design | 1.000 | 0.325 | **0.491** | 83 |
| product | 1.000 | 1.000 | 1.000 | 105 |
| marketing | 0.597 | 1.000 | 0.748 | 83 |
| sales | 1.000 | 1.000 | 1.000 | 104 |
| operations | 1.000 | 1.000 | 1.000 | 104 |
| finance | 1.000 | 1.000 | 1.000 | 104 |
| healthcare | 1.000 | 1.000 | 1.000 | 104 |
| education | 1.000 | 1.000 | 1.000 | 104 |
| customer_support | 1.000 | 1.000 | 1.000 | 104 |
| hr | 1.000 | 1.000 | 1.000 | 104 |

**Confusion highlight:** 56/83 `design` rows predicted as `marketing` (only material NB error).

### 4.2 TF-IDF + LogReg (same split)

| Metric | Latest compare (2026-10-28) | Historical ref (2026-10-27) |
|--------|----------------------------:|----------------------------:|
| Accuracy | 0.7184 | 0.7538 |
| Macro F1 | **0.6873** | 0.7412 |

Below Track 5 F1 bar. Tuning notes say holdout could not discriminate candidates (`fixed_preset`).

### 4.3 Original-description prototype (separate)

| Metric | Value |
|--------|------:|
| n | 12 |
| Accuracy | 0.75 |
| Macro F1 | **0.681** |

Too small to claim Assessment 3 generalization; useful only as a honesty check.

### 4.4 Ablation diagnostics (synthetic)

| Check | Value |
|-------|------:|
| Title-only accuracy (masked path) | ~15.9% |
| Description-only accuracy | **100%** |
| Full masked accuracy | 95.3% |

Description-only perfection is a **credibility red flag**: remaining generator/tooling signal, not proof of real-job robustness.

---

## 5. Evaluation methodology — strengths & weaknesses

### Strengths

- Reproducible seed + stratified **template-group** split
- Explicit ID and group leakage asserts
- Per-class precision / recall / F1 + full confusion matrix
- Category-slug masking + synthetic shortcut stripping
- Near-duplicate diagnostic
- Side-by-side NB vs TF-IDF on identical preprocess/split
- Unit tests covering leakage and metrics

### Weaknesses (Assessment 3 reliability)

1. **Synthetic-only labels** — not real HireHub vacancies.
2. **Description-only = 100%** — residual leakage / template signal after masking.
3. **Only 55 template groups** — limited role diversity; “unseen template” still comes from the same small title bank.
4. **Weighted F1 not emitted** by `evaluatePredictions` (macro only) — Track 5 asks for proper P/R; weighted F1 should be reported explicitly.
5. **Target gate is accuracy ≥ 0.70**, not F1 ≥ 0.85.
6. **Weak class ignored by headline** — `design` F1 0.49 while macro still 0.94.
7. **No nested CV / multiple seeds** in the published headline report.
8. **Original-description set is tiny** (n=12).
9. TF-IDF “tuning” often does not tune (fixed preset after 0% holdout).

**Verdict:** Methodology is **good for Assessment 2 offline evidence**, but **not fully Assessment-3-grade** without hardening (weighted F1, multi-seed, harder OOD / less description signal, and/or real-ish labels). Claiming “F1 ≥ 0.85” from the current NB report alone is numerically true and methodologically incomplete if assessors expect improvement work + tougher eval.

---

## 6. Data leakage risks

| Risk | Status | Notes |
|------|--------|-------|
| Gold category as feature | Mitigated | Never passed into feature builders |
| Category name/slug in text | Partially mitigated | Masked; occupational stems kept intentionally |
| Synthetic boilerplate / skill-list | Partially mitigated | Stripped from features; classifier descriptions rewritten |
| Row ID overlap train/test | Mitigated | `assertNoSplitLeakage` |
| Seniority/location twin templates | Mitigated | `template_group` split + `assertNoTemplateGroupLeakage` |
| Near-duplicate wording across split | Low on Jaccard≥0.9 | Rate = 0 in last run |
| **Shared class lexicon / duty phrases** | Residual | Class-level toolkit language can still make description-only trivial |
| **Hyperparameter selection on test** | Mitigated for TF-IDF | Test unused; fixed preset documented |
| Live RAG / embeddings contamination | N/A for offline classify | Classifier path does not reseed `embedding_gte` |

---

## 7. Existing baseline & prior experiments

| Experiment | Result | Takeaway |
|------------|--------|----------|
| Early NB on raw synthetic (pre-mask) | ~100% held-out (flagged by mentor) | Label/template leakage |
| Masked + template-group NB | Acc 0.953 / macro F1 **0.937** | Current A2/A3-relevant baseline |
| Classifier-oriented descriptions | Used by compare pipeline | Keeps signal after stripping RAG boilerplate |
| TF-IDF LogReg (historical) | Acc 0.754 / macro F1 0.741 | Weaker than NB |
| TF-IDF LogReg (latest fixed preset) | Acc 0.718 / macro F1 0.687 | Still below 0.85; regresses vs historical |
| Title-only / description-only ablation | 15.9% / 100% | Description carries almost all signal |
| Original prototype eval | Acc 0.75 / macro F1 0.68 (n=12) | Soft OOD check only |

Historical reference is embedded in `CLASSIFIER_HISTORICAL_REFERENCE` (`job-classifier-compare.ts`).

---

## 8. Is F1 ≥ 0.85 realistic?

**On the current synthetic template-group protocol: already achieved** (macro F1 ≈ 0.937, weighted ≈ 0.947).

**On a hardened Assessment 3 bar (recommended):** still realistic **if** work stays in the NB + leakage-resistant synthetic lane and focuses on:

- Fixing `design` ↔ `marketing` confusion
- Reducing description-only triviality (harder feature text / ablations)
- Emitting weighted F1 + multi-seed stability
- Optional small real/hand-written OOD set scored with NB (not only prototypes)

**Less realistic** if assessors require F1 ≥ 0.85 on genuine multi-employer vacancy text without expanding labeled data — current OOD signal is weak (n=12, macro F1 0.68).

Improving **TF-IDF LogReg** from ~0.69 → 0.85 is possible but higher effort and historically weaker than NB on this dataset; not the preferred primary vehicle.

---

## 9. Route comparison — Classifier improvement vs Shortlist Likelihood

| Dimension | Route 1: Improve classifier to F1 ≥ 0.85 | Route 2: Shortlist Likelihood Model |
|-----------|------------------------------------------|-------------------------------------|
| Existing code | Strong (train/eval/tests/artifacts) | None for ML training |
| Labels | 5k synthetic categories ready | Need outcome labels (`shortlisted` / not) from `applications.status` or synthetic proxy |
| Product fit | Category tagging / offline evidence | Recruiter ranking / pipeline priority |
| Track 5 bar | Numerically met already; need credible *improvement + eval* story | Net-new model; clearer “built for A3” narrative |
| Project-protection risk | Low (offline, no schema/RAG overwrite) | Medium if tempted to change schema/RLS or pull production PII into features carelessly |
| Data risk | Synthetic credibility | Sparse live shortlists; class imbalance; leakage from post-decision fields |
| Effort to demable evidence | Low–medium | Medium–high |
| Dependency on live DB | None for core metrics | Likely needs export or synthetic applications dataset |

### Recommendation

**Prefer Route 1 — classifier improvement / fine-tuning package** for Track 5, because:

1. Infrastructure and baseline already exist and already clear F1 ≥ 0.85 on the established protocol.
2. Honest Assessment 3 work remains: harden metrics, fix the weak class, reduce residual leakage, document experiments vs baseline.
3. Route 2 is valuable product-wise but is a greenfield ML track with unlabeled/uncertain volume and higher schedule risk under project-protection constraints.

Use Route 2 only if mentors explicitly prefer a recruiter-facing likelihood model over classifier hardening, or if Route 1 is rejected for “already done in Assessment 2.”

---

## 10. Recommended Track 5 approach (post-5A)

**Primary:** Classifier Improvement Plan (keep NB as baseline; do not delete prior artifacts).

1. **Freeze baseline** — cite `classifier-eval.json` / `classifier-compare.json` as immutable reference (copy into a Track 5 report folder later; do not overwrite without versioning).
2. **Harden evaluation** — add weighted F1; multi-seed summary; keep per-class P/R/F1 + confusion matrix; keep group-split asserts.
3. **Targeted improvement** — reduce `design`→`marketing` errors; rebalance/clarify design vs marketing lexicon without injecting gold labels into features.
4. **Leakage stress tests** — keep description-only / title-only ablations; aim to lower description-only triviality without collapsing full-model F1 below 0.85.
5. **Optional OOD** — expand hand-written/original descriptions and score with the **same NB pipeline** (in addition to prototype eval).
6. **Report** — Assessment 3 Track 5 report showing baseline → experiments → final F1 ≥ 0.85 with precision/recall.

**Secondary (parked):** Shortlist Likelihood design spike only if Route 1 is blocked — offline dataset from applications + jobs + skill overlap features; logistic / gradient-boosted binary model; never weaken RLS.

---

## 11. Proposed implementation steps (next tasks — do not start in 5A)

| Step | Task | Outcome |
|------|------|---------|
| **5B** | Evaluation hardening design + metric gaps | Spec for weighted F1, multi-seed, report schema |
| **5C** | Experiment plan for design/marketing + leakage stress | Hypotheses, feature changes allowed/forbidden |
| **5D** | Implement eval upgrades (no model train yet or minimal) | Code emits Track-5-complete metrics |
| **5E** | Run improvement experiments; versioned `scripts/rag/out/track5-*` | New reports without deleting old ones |
| **5F** | Write `docs/ASSESSMENT_3_TRACK5_REPORT.md` | Final evidence package |

If Route 2 is chosen instead: **5B-SL** dataset feasibility audit (counts of `shortlisted` vs other statuses; feature inventory) before any training.

---

## 12. Expected files that may need changes later

**Likely (Route 1):**

- `src/lib/ai/job-classifier.ts` — weighted F1; optional multi-seed helpers
- `src/lib/ai/job-classifier-dataset.ts` — design/marketing feature lexicon / duties
- `src/lib/ai/job-classifier-compare.ts` — Track 5 comparison report fields
- `scripts/rag/train-job-classifier.mjs` — emit weighted F1 / Track 5 artifact names
- `src/test/job-classifier*.test.ts` — coverage for new metrics / experiments
- New docs: `docs/ASSESSMENT_3_TRACK5_*.md`
- New versioned outs: `scripts/rag/out/track5-*.json` (do not overwrite `classifier-eval.json` blindly)

**Unlikely / forbidden without explicit approval:**

- `.env*`
- Supabase schema / migrations / RLS
- Overwriting `embedding_gte` / RAG corpus seed
- CRM / agent workflow rewrites
- Deleting historical `classifier-*.json` artifacts

**Route 2 additions (if chosen later):**

- New `src/lib/ai/shortlist-likelihood*.ts`
- New `scripts/rag/train-shortlist-likelihood.mjs`
- Offline dataset builder (synthetic or exported anonymized features)
- Tests + Track 5 shortlist report

---

## 13. Task 5A conclusion

| Question | Finding |
|----------|---------|
| Existing classifier? | Yes — Multinomial NB (+ TF-IDF comparator) |
| Dataset? | 5k synthetic, 12 classes, nearly balanced, no missing/duplicate IDs |
| Baseline F1? | Macro **0.937**, weighted **≈0.947**, accuracy **0.953** |
| Eval reliable for A3? | Partially — strong offline hygiene, weak real-world/OOD claim |
| F1 ≥ 0.85 realistic? | Yes on current protocol; harden before treating as A3-complete |
| Best route? | **Classifier improvement / eval hardening** over Shortlist Likelihood for now |

**Best next task:** **Task 5B — Evaluation hardening + Track 5 experiment design** (still no production/schema changes; optionally still no training until metrics/report schema are agreed).

---

*End of Task 5A. Stop here.*
