# Assessment 3 — Track 5 Task 5B  
## Evaluation Hardening & Data-Leakage Investigation

**Status:** Inspection / design only — **no model architecture changes, no training, no commits**  
**Date:** 2026-11-09  
**Depends on:** [`ASSESSMENT_3_TRACK5_BASELINE_AUDIT.md`](./ASSESSMENT_3_TRACK5_BASELINE_AUDIT.md) (Task 5A)  
**Final package:** See [`ASSESSMENT_3_TRACK5_REPORT.md`](./ASSESSMENT_3_TRACK5_REPORT.md)  
**Goal alignment:** Accuracy naturally in **(70%, 90%)**, Macro F1 **≥ 0.85**, realistic unseen-job behavior, **no** metric inflation or intentional degradation.

---

## 0. Executive verdict

**Is the current 95.3% held-out accuracy trustworthy as realistic performance on unseen job descriptions?**

**No.**

Evidence (reproduced offline on the same seed-42 template-group protocol, without training a new model):

| Ablation (NB, same split) | Accuracy |
|---------------------------|---------:|
| Full (title + description) | **0.9528** |
| Description only | **1.0000** |
| **Skills line only** (`Hands-on tools frequently used: …`) | **1.0000** |
| Duty sentence only | 0.1138 |
| Title only | 0.1585 |
| Shared boilerplate only | 0.0700 |
| Location opener only | 0.0523 |

The headline score is driven by **near-perfect class purity of the synthetic skill pools**, not by robust reading of varied job prose. Template-group ID separation is correctly enforced, but **class-level vocabulary still crosses the split**, so the task remains artificially easy.

Previous artifacts (`scripts/rag/out/classifier-eval.json`, `classifier-compare.json`, `original-description-eval.json`) are **preserved and not overwritten**.

---

## 1. Track 5 performance policy (binding for later tasks)

| Rule | Policy |
|------|--------|
| Accuracy target | Prefer **> 70% and < 90%**, obtained naturally |
| Macro F1 target | **≥ 0.85** with per-class precision/recall |
| Forbidden | Random noise, label corruption, test-label edits, deliberate model weakening, silent metric “tuning” to land in band |
| Required honesty | If a clean protocol still yields accuracy **≥ 90%**, report it as-is and diagnose remaining ease / synthetic structure |
| Reporting | Always separate **Synthetic benchmark** vs **Independent / OOD benchmark** |
| This task (5B) | Inspect + design only — **do not** change architecture or train |

---

## 2. Why description-only reaches 100% (root cause)

Classifier feature descriptions are built in `buildClassifierOrientedDescription` (`job-classifier-dataset.ts`):

```text
Opening based in {location}.
{duty sentence keyed by base title}.
Hands-on tools frequently used: {skills_text}.
Expect written updates, stakeholder demos, and measurable outcomes each sprint.
```

### 2.1 What actually carries the label

1. **`skills_text` comes from `SKILLS_BY_CATEGORY` in `corpus-generate.ts`**  
   Each category has a disjoint (almost) occupational toolkit (e.g. engineering → TypeScript/React/Node; healthcare → HIPAA/EMR; customer_support → Zendesk/SLA).

2. **Skills-only ablation accuracy = 100%** on the official grouped split.  
   Therefore description-only = 100% is explained almost entirely by the tools line — not by deep duty language.

3. **High-purity class markers on train descriptions** (examples; purity = fraction of train docs with that token that belong to the class):

   | Class | Example markers (purity ≈ 1.0) |
   |-------|--------------------------------|
   | engineering | typescript, postgresql, node, ci/cd, rest, apis |
   | data | dbt, tableau, bigquery, sql, pandas, etl |
   | healthcare | hipaa, emr, compliance, patient |
   | customer_support | zendesk, sla, troubleshooting, listening |
   | finance | gaap, budgeting, forecasting, modeling |
   | … | similarly for remaining classes |

4. **Duty-only ≈ 11%** and **shared closer / location ≈ chance** — those parts are weak alone. The model does not need them when skills are present.

5. **`CLASSIFIER_CLASS_LEXICON` is not used in feature text** — only coverage asserts. Runtime signal is generator `skills_text` + duty map + fixed template shell.

### 2.2 Why full accuracy is ~95.3% (not 100%)

Titles can add noise after category-slug masking, and the only material NB errors are **`design` → `marketing`** (56/83 design test rows). Skills for design vs marketing are distinct enough for skills-only perfection, but **full title+description** features introduce some cross-talk (e.g. Brand Designer duty mentions campaigns/growth; shared words like analytics/management across pools). Net: still very high, not perfect.

---

## 3. Generator & dataset inspection findings

### 3.1 Repeated templates and wording patterns

| Pattern | Finding |
|---------|---------|
| Description template shell | Fixed 4-sentence structure for all 5k classifier examples |
| Duty sentences | **55** unique duties (one per base title) |
| Unique full descriptions | **340 / 5000** — every description string is reused |
| Exact-duplicate groups | **340** groups; **all 5000 rows** sit in a duplicate group (≈11–14 copies each) |
| Raw RAG generator text | Still embeds `This is a synthetic {category} role…` in **5000/5000** docs (stripped/masked on classifier path; **not** used as classifier feature text after rewrite) |

Duplicates are mostly **same base-title × location × skill-combo** repeated across seniority/index cycles. IDs differ (`synthetic:v1:#####`); wording does not.

### 3.2 Class-specific keywords that reveal labels too easily

- Category skill pools are **intentionally class-specific** for RAG diversity, then reused as classifier features.
- Token purity ≈ 1.0 for many toolkit terms → nearest to “hidden label channel.”
- Not the gold `category` column itself, but a **deterministic function of category** (`skillsFor(category, roleCycle)`).

### 3.3 Hidden label information in descriptions / metadata

| Channel | Present? | Notes |
|---------|----------|-------|
| Gold category column as feature | No | Code never feeds it into tokens |
| Category slug in classifier feature text | Masked if present; classifier rewrite avoids slug opener | |
| Category slug in raw RAG descriptions | Yes (all rows) | Irrelevant to current classify features after rewrite |
| `templateGroupId` as feature | No | Split metadata only |
| Skills derived from category | **Yes — primary leakage channel** | |
| Duty keyed by base title (title → class) | Indirect | Weak alone (duty-only 11%) |

### 3.4 Duplicates and near-duplicates

| Check | Result |
|-------|--------|
| Duplicate `corpus_key` / ids | None (5000 unique) |
| Exact description duplicates | Severe within corpus (340 unique texts) |
| Exact description overlap **across** train/test (group split) | **0** |
| Exact masked feature-text overlap train/test | **0** |
| Same-class Jaccard ≥ 0.9 near-dup rate | **0** (existing diagnostic) |
| Same-class Jaccard ≥ 0.7 | **0** |
| Same-class Jaccard ≥ 0.5 | **1.0 (1186/1186)** |
| Any-class Jaccard ≥ 0.5 | **1.0** |

**Interpretation:** Strict exact-string and high-Jaccard (≥0.7) separation look clean, but at **0.5** every test row still shares substantial token mass with train — consistent with shared class skill vocab + shared boilerplate, not copy-paste twins.

### 3.5 Overlap between training and evaluation sources

| Source pair | Overlap |
|-------------|---------|
| Train vs test template groups | **0** (42 train / 13 test groups; asserted) |
| Train vs test example IDs | **0** |
| Synthetic train vs `ORIGINAL_JOB_DESCRIPTIONS` titles/bases | **0** title hits |
| Synthetic vs original exact descriptions | **0** |
| Live `public.jobs` labeled category dataset in repo | **Not present** as an offline eval file |

---

## 4. Group separation & train-only fitting (current status)

### Already correct

- `stratifiedGroupTrainTestSplit` keeps `category::baseTitle` wholly on one side.
- `assertNoSplitLeakage` / `assertNoTemplateGroupLeakage` in the compare pipeline.
- NB vocabulary / TF-IDF IDF+weights fitted on **train only**.
- TF-IDF hyperparameter path uses train-only holdout or documented `fixed_preset` — **not** the final 20% test set (`job-classifier-tune.ts` notes).

### Still insufficient for “realistic unseen jobs”

Group separation stops **template twins**, not **class-level skill lexicon reuse**. Unseen base titles in test still draw tools from the **same category pools** seen in train → trivial transfer.

---

## 5. Search for a real-world / independent job-description dataset

### Repository search (Task 5B)

| Candidate | Result |
|-----------|--------|
| `*.csv` / `*.jsonl` / `*.tsv` job datasets | **None** in repo |
| `data/` labeled corpus | **None** |
| Kaggle / HuggingFace / Indeed dumps checked in | **None** |
| Synthetic Track-1 corpus | Present — **must not be called real** |
| `ORIGINAL_JOB_DESCRIPTIONS` (`classifier-original-eval.ts`) | **12** hand-written, independent wording; **not** a real employer dataset; prototype macro F1 ≈ **0.68**, accuracy **0.75** |
| Live HireHub `jobs` rows | May exist in Supabase, but **no exported, labeled, versioned category-eval set** in the repository; not usable as a claimed “real benchmark” without a proper export + labeling protocol |

### Limitation (mandatory honesty)

- **No suitable real-world labeled job-category evaluation dataset exists in this repository.**
- Do **not** relabel synthetic text as real-world.
- Do **not** fabricate a dataset and call it real.

### Recommendation for a proper independent eval set (later task — not 5B)

1. Source job postings from a licensed / public dataset **or** a documented anonymized export of approved HireHub jobs with human category labels.  
2. Version as e.g. `datasets/track5_ood_v1.jsonl` with license, provenance, label guide.  
3. Keep **disjoint** from synthetic generator title banks and skill pools.  
4. Size target: preferably ≥ 200–500 labeled rows (≥15–20 per class) before claiming OOD F1.  
5. Score with the **same frozen model** trained only on synthetic train; never tune on OOD.

Until that exists, Assessment 3 must report:

- **Synthetic benchmark** (current protocol)  
- **Independent micro-benchmark** (n=12 originals only) — clearly underpowered  

---

## 6. Separate reporting schema (evaluation hardening design)

Future Track 5 reports / JSON must include **two blocks** (names illustrative):

### 6.1 `syntheticBenchmark`

| Field | Required |
|-------|----------|
| splitMode, seed, trainSize, testSize | yes |
| accuracy, macroF1, **weightedF1** | yes |
| perClass precision/recall/f1/support | yes |
| confusionMatrix | yes |
| templateGroupOverlapCount | yes |
| nearDuplicateRate at **0.9 and 0.5** | yes |
| ablations: titleOnly, descriptionOnly, **skillsOnly**, dutyOnly | yes |
| notes stating synthetic provenance | yes |

### 6.2 `independentBenchmark` (OOD)

| Field | Required |
|-------|----------|
| datasetId, n, provenance | yes |
| accuracy, macroF1, weightedF1 (if n allows) | yes |
| perClass / confusion (even if sparse) | yes |
| disclaimer when n < statistical threshold | yes |
| never blended into synthetic headline | yes |

### 6.3 Process gates (no architecture change in 5B)

1. Final test set **never** used for vocabulary, feature selection, or model selection.  
2. Multi-seed summary optional but recommended (report mean±range; do not pick best seed).  
3. Preserve prior `classifier-eval.json` / `classifier-compare.json`; write new versioned `scripts/rag/out/track5-*` files later.  
4. Code target constant today is accuracy ≥ 0.70; Track 5 narrative uses Macro F1 ≥ 0.85 **and** honesty about accuracy band — update gates only in a later implementation task.

---

## 7. Is 95.3% “wrong,” or just “too easy”?

| Claim | Supported? |
|-------|------------|
| Metrics were computed only on held-out IDs/groups | **Yes** |
| Gold labels were not fed as features | **Yes** |
| Category name masking / boilerplate stripping ran | **Yes** |
| Score reflects realistic generalization to unseen natural JDs | **No** |
| Score is inflated by generator structure (class-pure skills) | **Yes** |
| Intentional cheating (test peeking, label edits) | **No evidence** |

**Conclusion:** 95.3% is a **faithful measurement of an artificially easy synthetic task**, not a trustworthy estimate of real-world job-category classification performance.

Aiming for **70–90% accuracy with Macro F1 ≥ 0.85** must come from **harder, cleaner evaluation data / less label-correlated features**, not from damaging the model or falsifying scores. If after legitimate hardening accuracy remains ≥ 90%, **report the true number** and state that the synthetic task is still too easy.

---

## 8. Evaluation hardening plan (for Task 5C+, not executed here)

Ordered work that respects “no noise / no sabotage”:

1. **Diagnostics in eval reports** — emit skills-only + Jaccard@0.5 + weighted F1 (implementation later).  
2. **Dataset remediation design** — break deterministic category→skills purity for classifier features (e.g. shared cross-class tools, free-text duties without class-exclusive tool lists), **or** stop using category-tied skills as features; keep RAG generator behavior separate if required.  
3. **Never call remediated synthetic data “real.”**  
4. **Source a true independent eval set** (section 5).  
5. **Only then** retrain/evaluate (later task) and compare to frozen baseline artifacts.  
6. **Accept** whatever clean accuracy results; if still ≥ 90%, document residual ease.

**Explicitly out of scope for remediation:** random label flips, injecting garbage tokens to lower accuracy, shrinking the model without cause, or mixing test into training.

---

## 9. Trustworthiness checklist (Assessment 3 narrative)

Use this wording in the final Track 5 report:

> The Assessment 2/early Track 5 synthetic headline accuracy of **95.3%** (macro F1 **0.937**) was measured with correct ID/template-group holdout and without using gold labels as features. However, ablation shows **skills-only accuracy = 100%** because synthetic skill inventories are nearly class-exclusive. Therefore this figure is **not** evidence of realistic performance on unseen natural job descriptions. Independent wording currently available in-repo is limited to **12** hand-written rows (prototype macro F1 ≈ 0.68). A properly sourced external or human-labeled HireHub eval set is required before claiming real-world competence.

---

## 10. Files inspected (read-only)

- `src/lib/ai/job-classifier.ts`
- `src/lib/ai/job-classifier-dataset.ts`
- `src/lib/ai/job-classifier-compare.ts`
- `src/lib/ai/job-classifier-tune.ts`
- `src/lib/ai/job-classifier-tfidf-lr.ts`
- `src/lib/ai/corpus-generate.ts`
- `src/lib/ai/corpus.ts`
- `src/lib/ai/classifier-original-eval.ts`
- `src/lib/ai/classifier-original-prototype.ts`
- `scripts/rag/train-job-classifier.mjs`
- `scripts/rag/out/classifier-eval.json` (preserved)
- `scripts/rag/out/classifier-compare.json` (preserved)
- `scripts/rag/out/original-description-eval.json` (preserved)
- `docs/ASSESSMENT_3_TRACK5_BASELINE_AUDIT.md`

**Not modified:** `.env*`, Supabase schema/RLS, CRM, RAG embeddings/corpus, agent workflows, model architecture, training runs, git history.

---

## 11. Task 5B outcomes

| Deliverable | Status |
|-------------|--------|
| Root-cause of 95.3% / description-only 100% | Documented — **class-pure skills line** |
| Generator template / duplicate / keyword audit | Documented |
| Group-separation review | Documented — correct IDs/groups; residual class-lexicon leakage |
| Real dataset search | **None suitable in repo**; limitation + sourcing recommendation recorded |
| Separate synthetic vs OOD reporting design | Specified |
| Anti-manipulation policy | Specified |
| Model train / architecture change | **Not done** (per instructions) |

---

## 12. Recommended next task

**Task 5C — Classifier feature / dataset remediation design (still no mandatory training):**  
Specify how to remove category-exclusive skill shortcuts from classifier features while preserving RAG corpus integrity, define success criteria for a clean synthetic benchmark (hope for natural 70–90% acc with macro F1 ≥ 0.85, but **no forcing**), and outline procurement of an independent labeled eval set.

Do **not** start Shortlist Likelihood until this leakage story is resolved or explicitly deprioritized by mentors.

---

*End of Task 5B. Stop here.*
