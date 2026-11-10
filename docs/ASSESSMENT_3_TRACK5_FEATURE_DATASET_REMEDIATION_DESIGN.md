# Assessment 3 — Track 5 Task 5C  
## Classifier Feature / Dataset Remediation Design

**Status:** Design only — **no implementation, no training, no architecture change, no commits**  
**Date:** 2026-11-09  
**Final package:** See [`ASSESSMENT_3_TRACK5_REPORT.md`](./ASSESSMENT_3_TRACK5_REPORT.md)  
**Depends on:**  
- [`ASSESSMENT_3_TRACK5_BASELINE_AUDIT.md`](./ASSESSMENT_3_TRACK5_BASELINE_AUDIT.md) (Task 5A)  
- [`ASSESSMENT_3_TRACK5_EVAL_HARDENING_LEAKAGE.md`](./ASSESSMENT_3_TRACK5_EVAL_HARDENING_LEAKAGE.md) (Task 5B)

**Track 5 preference (honest, not forced):** natural accuracy in **(70%, 90%)** + Macro F1 **≥ 0.85**, with synthetic and independent benchmarks reported separately.

---

## 1. Executive decision

### 1.1 What is wrong with current classifier features

The offline classifier path (`generateClassifierLabeledExamples` → `buildClassifierOrientedDescription` in `job-classifier-dataset.ts`) builds every description as:

```text
Opening based in {location}.
{duty by base title}.
Hands-on tools frequently used: {skills_text}.   ← PROBLEM
Expect written updates, stakeholder demos, and measurable outcomes each sprint.
```

`skills_text` is produced by `skillsFor(category, …)` from **`SKILLS_BY_CATEGORY`** in `corpus-generate.ts`. Those pools are nearly class-exclusive (TypeScript/React vs HIPAA/EMR vs Zendesk/SLA, etc.).

Task 5B proved:

| Ablation | Accuracy |
|----------|---------:|
| Skills line only | **100%** |
| Description only | **100%** |
| Full title+description | **~95.3%** |
| Duty only | ~11% |
| Title only | ~16% |

So the headline score is **not** trustworthy as realistic unseen-JD performance. Template-group ID separation is correct, but **class-pure toolkit vocabulary still crosses train/test**.

Secondary issues (do not fix by cheating):

- Only ~340 unique description strings / 5000 examples (heavy reuse).  
- `design` ↔ `marketing` confusion under full features (Brand Designer duty mentions campaigns/growth).  
- `CLASSIFIER_CLASS_LEXICON` is unused in features today (coverage assert only) — do **not** wire it in as a new label channel.

### 1.2 Why RAG corpus behavior can stay separate

| Layer | File / path | Role |
|-------|-------------|------|
| RAG / corpus seed text | `corpus-generate.ts` → `descriptionFor`, `skills_text`, `buildCorpusContent` | Diversify synthetic retrieval docs; already labeled `is_synthetic` |
| Classifier offline features | `job-classifier-dataset.ts` | **Already a separate rewrite** of descriptions for classify experiments |
| Live compare pipeline | `job-classifier-compare.ts` → `generateClassifierLabeledExamples` | Uses classifier rewrite, not raw RAG prose |
| Legacy helper | `job-classifier.ts` → `corpusDocsToLabeledExamples` / `runJobClassifierPipeline` | Still maps raw generator docs; must be aligned later so Track 5 does not silently reintroduce skills |

**Decision:** Remediate **classifier feature construction only**. Do **not** change `SKILLS_BY_CATEGORY`, do **not** reseed `job_corpus`, do **not** regenerate `embedding_gte`. RAG product behavior stays intact.

### 1.3 What we will / will not change later (post-5C)

| Will change (Task 5D+) | Will not change |
|------------------------|-----------------|
| `buildClassifierOrientedDescription` (and related classifier-only helpers/tests) | `.env*`, Supabase schema/RLS/auth |
| Compare/pipeline wiring so Track 5 always uses remediated features | Overwriting RAG corpus / embeddings |
| Eval report fields (weighted F1, skills-only ablation, dual benchmarks) | Deleting `classifier-eval.json`, `classifier-compare.json`, `original-description-eval.json` |
| Optional expansion of **base-title duty prose** (still not gold-category tool dumps) | Noise injection, label flips, deliberate model weakening |
| Versioned `scripts/rag/out/track5-*` artifacts | Calling synthetic data “real-world” |
| OOD dataset **sourcing process** (human/legal), when approved | Shortlist Likelihood track; architecture swap away from NB without cause |

**This task (5C) stops at documentation.**

---

## 2. Remediation options comparison

### Option A — Remove category-tied skills line from classifier features (recommended)

**Idea:** Delete `Hands-on tools frequently used: ${doc.skills_text}` from classifier descriptions. Keep title + location opener + base-title duty (+ optional richer **role prose** still keyed by base title). Leave RAG generator unchanged.

| Dimension | Assessment |
|-----------|------------|
| HireHub safety | **Highest** — classifier-only; no DB/RAG/embedding touch |
| Realism | Removes the proven 100% shortcut; forces model to use occupational prose + titles |
| Track 5 fit | Best chance of **natural** accuracy drop out of the inflated 95% band without sabotage; F1 may need duty enrichment to stay ≥ 0.85 |
| Effort | **Low** — localized to `job-classifier-dataset.ts` + tests + eval notes |
| RAG/product risk | **Minimal** |

### Option B — Dilute skills via a shared cross-class tool pool (classifier-only)

**Idea:** Keep a tools line, but sample from a **global** shared pool (or force ≥50% tools from other classes) so purity ≪ 1.

| Dimension | Assessment |
|-----------|------------|
| HireHub safety | High (still classifier-only) |
| Realism | Better than today, but still an unnatural “tools laundry list” JD pattern |
| Track 5 fit | May leave accuracy high if residual class-correlated tools remain; harder to justify as “clean” |
| Effort | Medium (new sampling rules + purity diagnostics) |
| RAG/product risk | Minimal |

**Risk:** Easy to under-dilute and still inflate metrics, or over-dilute into nonsense JDs.

### Option C — Change `SKILLS_BY_CATEGORY` / generator descriptions in `corpus-generate.ts`

**Idea:** Fix “at the source” so RAG and classifier share less exclusive pools.

| Dimension | Assessment |
|-----------|------------|
| HireHub safety | **Lower** — invites corpus regen pressure, RAG eval drift, embedding reseed temptation |
| Realism | Helps both paths, but couples Assessment tracks |
| Track 5 fit | Unnecessary if classifier already rewrites text |
| Effort | High (corpus quality, Track 4 artifacts, regression surface) |
| RAG/product risk | **High** under project-protection rules |

**Rejected** as primary path.

### Option D — Stop using classifier rewrite; train on masked raw generator text only

**Idea:** Use `corpusDocsToLabeledExamples` + existing strip/mask of `Core skills…` / category openers.

| Dimension | Assessment |
|-----------|------------|
| HireHub safety | Medium |
| Realism | Raw generator is still highly templated; after stripping, signal may collapse or leftover stems may leak |
| Track 5 fit | Unclear; 5B already showed classifier rewrite’s skills line is the smoking gun — raw path has its own boilerplate history |
| Effort | Medium, with higher regression risk on Assessment 2 stories |
| RAG/product risk | Low directly, but confuses “which text is the Track 5 dataset?” |

**Rejected** as primary path.

### Primary recommendation: **Option A**

**Rationale:**

1. Attacks the **measured** failure mode (skills-only = 100%) with the smallest blast radius.  
2. Preserves RAG/corpus/embeddings and prior eval JSON.  
3. Keeps gold category out of feature selection.  
4. Aligns with project protection and “no forcing metrics.”  
5. If accuracy remains ≥ 90% after A, we diagnose residual ease (title banks, duty reuse) **honestly** — then consider limited Option B dilution or duty diversification in a later task, still without sabotage.

---

## 3. Concrete feature design (Option A)

### 3.1 How to remove category-pure skill shortcuts

**In `buildClassifierOrientedDescription` (later implementation):**

1. **Stop appending** `Hands-on tools frequently used: ${doc.skills_text}.`  
2. **Do not** substitute `CLASSIFIER_CLASS_LEXICON` or any `Record<JobCorpusCategory, skills[]>` into the description.  
3. **Do not** call `skillsFor` / read `doc.skills_text` for classifier feature text (may still exist on the `GeneratedCorpusDoc` for RAG — ignore for classify).  
4. Keep using `doc.title` → `syntheticBaseTitle` → `CLASSIFIER_DUTY_BY_BASE_TITLE[base]` (title-derived, not label-column-derived).  
5. Optionally keep a short location opener and one **shared** non-discriminative closer **or** replace the closer with mild role-neutral variation that does not encode class.

**Target classifier description shape (illustrative):**

```text
Opening based in {location}.
{primary duty sentence for base title}.
{optional secondary responsibility sentence for base title — still title-keyed}.
```

No tools laundry list. No `Core skills for this document`. No category slug opener.

### 3.2 What remains allowed

| Allowed | Notes |
|---------|-------|
| Title (with existing category-slug **masking** at tokenize time) | Occupational stems (engineer, designer, …) may remain per current mask policy |
| Base-title duty sentences | Map keyed by **base title string**, not by `category` enum when selecting text |
| Location phrase | Weak signal; OK |
| Shared / cross-class boilerplate | OK if non-discriminative |
| Existing preprocess | `stripSyntheticClassifierShortcuts`, `maskClassifierCategoryKeywords`, group split, train-only vocab |
| NB / TF-IDF architectures as-is | No architecture change required for remediation |

### 3.3 Forbidden practices

| Forbidden | Why |
|-----------|-----|
| Gold `category` as a feature or to pick feature text | Label leakage |
| Re-injecting `SKILLS_BY_CATEGORY` / `doc.skills_text` into classifier text | Restores 100% skills-only path |
| Wiring `CLASSIFIER_CLASS_LEXICON[category]` into features | Same failure mode under a new name |
| Random noise, typo bombs, label flips, shuffling test labels | Metric sabotage |
| Using final test set for vocab, feature selection, or model selection | Test peeking |
| Weakening the model (fewer classes, crippled tokenizer) **only** to land in 70–90% | Dishonest |
| Editing prior `classifier-eval.json` / compare / original-description JSON | Destroys baseline evidence |
| Relabeling synthetic rows as “real-world” | False claim |
| Changing RAG generator / reseeding embeddings to “help” Track 5 | Project-protection violation |

### 3.4 design ↔ marketing confusion — without cheating

Today Brand Designer duty includes campaign/growth language that overlaps marketing. **Allowed fixes (later):**

1. Rewrite **design** base-title duties toward visual/UX/systems language (layout, visual hierarchy, usability validation, interface consistency) — **avoid** acquisition, SEO, ads, nurture, campaign performance.  
2. Rewrite **marketing** duties toward channel/message/measurement language — **avoid** wireframe/prototype/accessibility-library phrasing.  
3. Keep selection keyed by **base title**, never `if (category === "design")`.  
4. Do **not** add design-only exclusive tools (e.g. dumping “Figma” into every design row) to force separation — that recreates skills leakage.  
5. Judge success with per-class P/R/F1 on the remediated synthetic split + confusion matrix — not by hand-fixing labels.

### 3.5 Expected residual difficulty (honesty)

Removing skills will likely **collapse** the trivial 100% description-only path. Full-model accuracy may fall sharply (duty+title alone were weak in 5B ablations). That is **desired honesty**, not a bug.

If Macro F1 falls **below 0.85**, later tasks may:

- Enrich **base-title** prose (more sentences, still no class tool dumps), and/or  
- Slightly diversify titles/duties to reduce the 340-unique-description bottleneck,

…then re-evaluate. **Do not** add noise to “aim” at 80%.

If after clean enrichment accuracy is still **≥ 90%**, report it and state the synthetic task remains too easy.

### 3.6 Pipeline alignment note (for 5D)

`job-classifier-compare.ts` already uses `generateClassifierLabeledExamples` — primary Track 5 path.  
`runJobClassifierPipeline` in `job-classifier.ts` still uses raw `corpusDocsToLabeledExamples`. Implementation must either switch that helper to the remediated builder or clearly deprecate it for Track 5 reporting so raw skills text cannot sneak back into “official” metrics.

---

## 4. Dataset / eval plan

### 4.1 Synthetic benchmark (remediated features)

| Item | Plan |
|------|------|
| Generator | Keep `generateSyntheticJobCorpus(5000)` for titles, labels, groups, locations |
| Feature text | Remediated `buildClassifierOrientedDescription` (Option A) |
| Split | Keep **`stratifiedGroupTrainTestSplit`**, seed **42**, 80/20; assert ID + template-group leakage = 0 |
| Model | Same Multinomial NB (no architecture change required for remediation proof) |
| Metrics | accuracy, **macro F1**, **weighted F1**, per-class P/R/F1, confusion matrix |
| Required ablations | titleOnly, descriptionOnly, **skillsOnly (expect ~chance / N/A if line removed)**, dutyOnly |
| Near-dup | Report Jaccard **0.9 and 0.5** |
| Artifacts | **Preserve** existing `classifier-eval.json`, `classifier-compare.json`, `original-description-eval.json` |
| New outputs (later) | Versioned only, e.g. `scripts/rag/out/track5-remediated-YYYYMMDD.json` — never silent overwrite of A2 baselines |

Label remediated synthetic results explicitly: **`syntheticBenchmark`** — still synthetic, not real-world.

### 4.2 Independent / OOD eval (sourcing plan only — not executed in 5C)

**No suitable real labeled JD dataset exists in-repo today** (only 12 hand-written `ORIGINAL_JOB_DESCRIPTIONS`).

**Allowed future sources (pick one documented path):**

1. Licensed / public job-posting dataset with category labels mappable to HireHub’s 12 classes, **or**  
2. Documented anonymized export of approved HireHub `jobs` + **human** category labels (no scraping of private seeker data).

**Requirements:**

| Requirement | Detail |
|-------------|--------|
| Target size | Prefer **≥ 200–500** labeled rows (≥15–20 per class); n=12 remains a micro-check only |
| Disjointness | No reuse of generator title banks / skill pools / duty template strings |
| Provenance | License, date, label guide stored with `datasets/track5_ood_v1` (or equivalent) |
| Protocol | Freeze model trained on **synthetic train only**; score OOD once; **never tune on OOD** |
| Naming | Report under **`independentBenchmark`** only |

### 4.3 Explicit limitation (until OOD exists)

> HireHub Track 5 can demonstrate leakage-resistant **synthetic** improvement and honest ablations, but **cannot** claim real-world JD classification competence until a properly sourced independent labeled set is available. The 12-row original set is insufficient for Macro F1 claims.

### 4.4 Separate reporting schema (align with Task 5B)

```text
track5Report
├── syntheticBenchmark
│   ├── provenance: "hirehub-synthetic-classifier-features-remediated-v1"
│   ├── split, seed, sizes
│   ├── accuracy, macroF1, weightedF1
│   ├── perClass, confusionMatrix
│   ├── ablations (title/desc/skills/duty)
│   └── nearDuplicateRates
└── independentBenchmark
    ├── datasetId, n, provenance, license
    ├── accuracy, macroF1, weightedF1 (if n allows)
    ├── perClass / confusion (sparse OK)
    └── disclaimer if n < statistical threshold
```

Never blend the two into one headline number.

---

## 5. Success criteria & honesty gates

### 5.1 “Good enough for Track 5” (aspirational, not forced)

| Gate | Criterion |
|------|-----------|
| Leakage | Skills-only path removed or non-informative; no gold label features; group/ID overlap = 0 |
| Metrics | Macro F1 **≥ 0.85** with full P/R tables on **syntheticBenchmark** |
| Accuracy band | Prefer **(70%, 90%)** if obtained naturally |
| Reporting | Dual benchmarks; prior JSON preserved; new versioned outs |
| Honesty | Synthetic never called real; OOD limitation stated if dataset missing |
| Process | No test peeking; no sabotage |

### 5.2 If accuracy remains ≥ 90% after clean remediation

1. Publish the **actual** accuracy and F1.  
2. State: “Synthetic task remains too easy under remediated features.”  
3. Inspect residual channels (title banks, repeated duties, thin unique-text count).  
4. Plan further **legitimate** diversification — still no noise/label attacks.  
5. Do not hide the number to satisfy the preferred band.

### 5.3 If Macro F1 < 0.85 after skills removal

1. Report the true drop (proves shortcut removal worked).  
2. In Task 5E experiments: enrich title-keyed duties / diversity — measure again.  
3. Only claim Track 5 met when Macro F1 ≥ 0.85 under the clean protocol.

### 5.4 Deferred — do **not** do in 5C

| Task | Scope |
|------|-------|
| **5D** | Implement Option A feature changes + eval field upgrades + tests (still may defer full train until ready) |
| **5E** | Run training/eval; write versioned `track5-*` artifacts; duty enrichment experiments if needed |
| **5F** | Final Assessment 3 Track 5 report (synthetic + independent, honesty narrative) |
| Later | OOD dataset procurement / labeling (separate approval) |

---

## 6. Out of scope / stop conditions

**Out of scope for this design and for immediate follow-on unless explicitly reopened:**

- Shortlist Likelihood Model  
- Production schema, RLS, auth, CRM, agent workflow changes  
- `.env` edits  
- Regenerating embeddings / overwriting RAG corpus  
- Deleting or rewriting historical `classifier-eval.json`, `classifier-compare.json`, `original-description-eval.json`  
- Model architecture replacement “for its own sake”  
- Any code execution that retrains models as part of 5C  

**Stop condition:** This design document is complete. **Do not start coding the remediation in Task 5C.**

---

## 7. Implementation sketch (reference only for 5D — not executed now)

1. Edit `buildClassifierOrientedDescription` to drop skills line.  
2. Optionally add secondary title-keyed duty sentences; fix design/marketing wording overlaps.  
3. Ensure `generateClassifierLabeledExamples` is the only Track 5 data path; align or gate `runJobClassifierPipeline`.  
4. Extend eval report: weighted F1, skillsOnly ablation, dual-benchmark placeholders.  
5. Add/adjust unit tests: no `Hands-on tools frequently used` in classifier features; group leakage asserts unchanged.  
6. Run classify → write **new** `track5-*` JSON; leave old outs untouched.  
7. Document results against Section 5 gates.

---

## 8. Task 5C decision summary

| Question | Decision |
|----------|----------|
| Primary remediation | **Option A** — remove category-tied skills line from **classifier** feature text only |
| RAG / embeddings | Unchanged |
| Real data | Not in repo; source later; never fake it |
| Metrics policy | No forcing; dual reporting; honesty if still ≥ 90% |
| Coding in 5C | **None** |

---

*End of Task 5C. Stop here.*
