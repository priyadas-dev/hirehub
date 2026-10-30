import {
  JOB_CORPUS_CATEGORIES,
  type JobCorpusCategory,
} from "@/lib/ai/corpus";
import {
  generateSyntheticJobCorpus,
  syntheticTemplateGroupId,
  type GeneratedCorpusDoc,
} from "@/lib/ai/corpus-generate";

export const CLASSIFIER_RANDOM_SEED = 42 as const;
export const CLASSIFIER_TRAIN_FRACTION = 0.8 as const;
export const CLASSIFIER_TARGET_ACCURACY = 0.7 as const;

export type LabeledJobExample = {
  id: string;
  title: string;
  description: string;
  category: JobCorpusCategory;
  /**
   * Template group for leakage-resistant splits (`category::baseTitle`).
   * Derived from the synthetic generator; never used as a model feature.
   */
  templateGroupId?: string;
};

export type ClassifierSplit = {
  train: LabeledJobExample[];
  test: LabeledJobExample[];
  seed: number;
  trainFraction: number;
  /** `row` = legacy per-example; `template_group` = whole role templates stay on one side. */
  mode?: "row" | "template_group";
};

export type TrainedJobClassifier = {
  kind: "multinomial_nb";
  categories: JobCorpusCategory[];
  vocabulary: string[];
  /** log P(token | class) aligned with vocabulary index */
  tokenLogProb: Record<JobCorpusCategory, number[]>;
  /** log P(class) */
  classLogPrior: Record<JobCorpusCategory, number>;
  trainedOn: number;
  seed: number;
};

export type ConfusionMatrix = Record<JobCorpusCategory, Record<JobCorpusCategory, number>>;

export type ClassMetrics = {
  precision: number;
  recall: number;
  f1: number;
  support: number;
};

/** Generalization score on wording the synthetic generator did not produce. */
export type OriginalDescriptionEval = {
  /** correct / testSize. Unscored rows stay in the denominator and are not correct. */
  accuracy: number;
  testSize: number;
  /** Rows whose nearest prototype falls below the cosine cutoff. Not a predicted category. */
  unscoredCount: number;
  macroF1: number;
  confusionMatrix: ConfusionMatrix;
  perClass: Record<JobCorpusCategory, ClassMetrics>;
  notes: string[];
};

/**
 * Offline diagnostics for Assessment 2 #2 — explain a high synthetic score without
 * changing the classifier or inventing a real-world accuracy claim.
 */
export type SyntheticSplitDiagnostics = {
  /** Held-out accuracy using title tokens only (category keywords masked). */
  titleOnlyAccuracy: number;
  /** Held-out accuracy using description tokens only (category keywords masked). */
  descriptionOnlyAccuracy: number;
  /** Same as top-level accuracy (title + description, category keywords masked). */
  fullMaskedAccuracy: number;
  /**
   * Fraction of test rows that share Jaccard similarity >= threshold with at least
   * one same-class training row (token multiset after category-keyword masking).
   */
  nearDuplicateRate: number;
  nearDuplicateCount: number;
  nearDuplicateThreshold: number;
  /** Template groups that appear in both train and test (must be 0 for group splits). */
  templateGroupOverlapCount: number;
  splitMode: "row" | "template_group";
  notes: string[];
};

export type ClassifierEvalReport = {
  generatedAt: string;
  model: "multinomial_nb" | "tfidf_logreg";
  seed: number;
  trainFraction: number;
  trainSize: number;
  testSize: number;
  categories: JobCorpusCategory[];
  /** Synthetic 80/20 score with category keywords masked. Not a real-world accuracy claim. */
  accuracy: number;
  meetsTarget: boolean;
  targetAccuracy: number;
  confusionMatrix: ConfusionMatrix;
  perClass: Record<JobCorpusCategory, ClassMetrics>;
  macroF1: number;
  notes: string[];
  /** Ablation + near-dup diagnostics for honest reporting of synthetic 100% scores. */
  syntheticDiagnostics?: SyntheticSplitDiagnostics;
  /** Optional separate eval — never mixed into the Naive Bayes headline metrics. */
  originalDescriptions?: OriginalDescriptionEval;
};

/** Seeded PRNG (Mulberry32) for reproducible splits. */
export function createSeededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function tokenizeJobText(title: string, description: string): string[] {
  const raw = `${title}\n${description}`.toLowerCase();
  return raw
    .split(/[^a-z0-9_+#]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * Explicit category labels only (enum slugs + spaced forms + a few label aliases).
 * Does NOT mask ordinary occupational stems (engineer, designer, marketer, …) — those are
 * legitimate title signal once category-name leakage is removed.
 * Gold `category` labels are never passed through this function.
 */
const CLASSIFIER_CATEGORY_LABELS: readonly string[] = Array.from(
  new Set([
    ...JOB_CORPUS_CATEGORIES.map((category) => category.replaceAll("_", " ")),
    ...JOB_CORPUS_CATEGORIES,
    "customer support",
    "human resources",
    "health care",
  ]),
).sort((a, b) => b.length - a.length);

/**
 * Mask explicit category names/slugs before tokenization.
 * Stored corpus text is unchanged; this applies only to classifier features (train + predict).
 */
export function maskClassifierCategoryKeywords(text: string): string {
  let masked = text.replace(/\bsynthetic\b.{0,40}?\brole\b/gi, " ");
  for (const label of CLASSIFIER_CATEGORY_LABELS) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    masked = masked.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
  }
  return masked;
}

/**
 * Remove synthetic generator shortcuts from classifier features only:
 * fixed skill-list line, category-revealing opener, shared boilerplate, variant-seed footer.
 * Skill-list removal must tolerate internal punctuation (e.g. Node.js) — do not stop at the
 * first period inside the skill list.
 * Stored corpus rows / gold labels are unchanged.
 */
export function stripSyntheticClassifierShortcuts(text: string): string {
  let cleaned = text;
  // End the skill clause at a sentence-final period (whitespace/EOF after ".").
  // Do not stop at abbreviation periods such as Node.js (letter follows ".").
  cleaned = cleaned.replace(
    /Core skills(?:\s+for\s+this\s+document)?\s*:[\s\S]*?\.(?=\s|$)/gi,
    " ",
  );
  cleaned = cleaned.replace(
    /This is a synthetic\b[\s\S]{0,160}?\brole titled\s+"[^"]*"\s*based in\s+[\s\S]*?\.(?=\s|$)/gi,
    " ",
  );
  cleaned = cleaned.replace(
    /You will\s+[\s\S]+?\s+while working with modern tools\.(?=\s|$)/gi,
    " ",
  );
  cleaned = cleaned.replace(
    /Day-to-day work mixes independent ownership with team reviews, written updates, and stakeholder demos\.(?=\s|$)/gi,
    " ",
  );
  cleaned = cleaned.replace(
    /Variant seed\s+\d+\s+exists only[\s\S]*?\.(?=\s|$)/gi,
    " ",
  );
  return cleaned;
}

/**
 * Same preprocess used by NB tokens and experimental TF-IDF text features.
 * Never includes the gold category column.
 */
export function buildClassifierFeatureText(
  example: Pick<LabeledJobExample, "title" | "description">,
): string {
  // Mask category slugs/names in both title and description so label words cannot
  // leak through titles (e.g. "Data Analyst", "Product Manager"). Occupational stems
  // that are not category labels (engineer, designer, analyst, …) stay as signal.
  const title = maskClassifierCategoryKeywords(stripSyntheticClassifierShortcuts(example.title));
  const description = maskClassifierCategoryKeywords(
    stripSyntheticClassifierShortcuts(example.description),
  );
  return [title, description].join("\n");
}

/** Features for classification: title + description only (never the label column). */
export function exampleToTokens(example: Pick<LabeledJobExample, "title" | "description">): string[] {
  return tokenizeJobText(
    maskClassifierCategoryKeywords(stripSyntheticClassifierShortcuts(example.title)),
    maskClassifierCategoryKeywords(stripSyntheticClassifierShortcuts(example.description)),
  );
}

export function corpusDocsToLabeledExamples(docs: GeneratedCorpusDoc[]): LabeledJobExample[] {
  return docs.map((doc) => ({
    id: doc.corpus_key,
    title: doc.title,
    description: doc.description,
    category: doc.category,
    templateGroupId: syntheticTemplateGroupId(doc.category, doc.title),
  }));
}

/**
 * Stratified 80/20 split with a fixed seed.
 * Shuffle is independent per class so class proportions are preserved.
 */
export function stratifiedTrainTestSplit(
  examples: LabeledJobExample[],
  options?: { seed?: number; trainFraction?: number },
): ClassifierSplit {
  const seed = options?.seed ?? CLASSIFIER_RANDOM_SEED;
  const trainFraction = options?.trainFraction ?? CLASSIFIER_TRAIN_FRACTION;
  if (!(trainFraction > 0 && trainFraction < 1)) {
    throw new Error("trainFraction must be between 0 and 1 (exclusive).");
  }

  const byClass = new Map<JobCorpusCategory, LabeledJobExample[]>();
  for (const category of JOB_CORPUS_CATEGORIES) byClass.set(category, []);
  for (const example of examples) {
    const bucket = byClass.get(example.category);
    if (!bucket) throw new Error(`Unknown category: ${example.category}`);
    bucket.push(example);
  }

  const train: LabeledJobExample[] = [];
  const test: LabeledJobExample[] = [];

  for (const category of JOB_CORPUS_CATEGORIES) {
    const rows = [...(byClass.get(category) ?? [])];
    const rng = createSeededRng(seed + hashString(category));
    shuffleInPlace(rows, rng);
    const trainCount = Math.floor(rows.length * trainFraction);
    // Ensure both sides get at least one row when class size >= 2.
    const splitAt =
      rows.length >= 2 ? Math.min(Math.max(trainCount, 1), rows.length - 1) : rows.length;
    train.push(...rows.slice(0, splitAt));
    test.push(...rows.slice(splitAt));
  }

  const rngFinal = createSeededRng(seed ^ 0x9e3779b9);
  shuffleInPlace(train, rngFinal);
  shuffleInPlace(test, rngFinal);

  return { train, test, seed, trainFraction, mode: "row" };
}

/**
 * Stratified 80/20 split by template group (`category::baseTitle`).
 * Every example that shares a template group is assigned entirely to train or entirely to test.
 */
export function stratifiedGroupTrainTestSplit(
  examples: LabeledJobExample[],
  options?: { seed?: number; trainFraction?: number },
): ClassifierSplit {
  const seed = options?.seed ?? CLASSIFIER_RANDOM_SEED;
  const trainFraction = options?.trainFraction ?? CLASSIFIER_TRAIN_FRACTION;
  if (!(trainFraction > 0 && trainFraction < 1)) {
    throw new Error("trainFraction must be between 0 and 1 (exclusive).");
  }

  const withGroups = examples.map((example) => ({
    ...example,
    templateGroupId:
      example.templateGroupId ?? syntheticTemplateGroupId(example.category, example.title),
  }));

  const groupsByClass = new Map<JobCorpusCategory, Map<string, LabeledJobExample[]>>();
  for (const category of JOB_CORPUS_CATEGORIES) groupsByClass.set(category, new Map());

  for (const example of withGroups) {
    const groupMap = groupsByClass.get(example.category);
    if (!groupMap) throw new Error(`Unknown category: ${example.category}`);
    const groupId = example.templateGroupId!;
    const bucket = groupMap.get(groupId) ?? [];
    bucket.push(example);
    groupMap.set(groupId, bucket);
  }

  const train: LabeledJobExample[] = [];
  const test: LabeledJobExample[] = [];

  for (const category of JOB_CORPUS_CATEGORIES) {
    const groupMap = groupsByClass.get(category) ?? new Map();
    const groupIds = Array.from(groupMap.keys());
    const rng = createSeededRng(seed + hashString(`group:${category}`));
    shuffleInPlace(groupIds, rng);

    const trainGroupCount = Math.floor(groupIds.length * trainFraction);
    const splitAt =
      groupIds.length >= 2
        ? Math.min(Math.max(trainGroupCount, 1), groupIds.length - 1)
        : groupIds.length;

    for (let i = 0; i < groupIds.length; i++) {
      const rows = groupMap.get(groupIds[i]!) ?? [];
      if (i < splitAt) train.push(...rows);
      else test.push(...rows);
    }
  }

  const rngFinal = createSeededRng(seed ^ 0x85ebca6b);
  shuffleInPlace(train, rngFinal);
  shuffleInPlace(test, rngFinal);

  return { train, test, seed, trainFraction, mode: "template_group" };
}

export function assertNoSplitLeakage(split: ClassifierSplit): void {
  const trainIds = new Set(split.train.map((e) => e.id));
  for (const example of split.test) {
    if (trainIds.has(example.id)) {
      throw new Error(`Data leakage: test id ${example.id} also appears in training set.`);
    }
  }
}

/** Fail if any template group appears on both sides of the split. */
export function assertNoTemplateGroupLeakage(split: ClassifierSplit): void {
  const trainGroups = new Set(
    split.train
      .map((e) => e.templateGroupId ?? syntheticTemplateGroupId(e.category, e.title))
      .filter(Boolean),
  );
  for (const example of split.test) {
    const groupId = example.templateGroupId ?? syntheticTemplateGroupId(example.category, example.title);
    if (trainGroups.has(groupId)) {
      throw new Error(`Template-group leakage: ${groupId} appears in both train and test.`);
    }
  }
}

export function countTemplateGroupOverlap(split: ClassifierSplit): number {
  const trainGroups = new Set(
    split.train.map((e) => e.templateGroupId ?? syntheticTemplateGroupId(e.category, e.title)),
  );
  const testGroups = new Set(
    split.test.map((e) => e.templateGroupId ?? syntheticTemplateGroupId(e.category, e.title)),
  );
  let overlap = 0;
  for (const groupId of testGroups) {
    if (trainGroups.has(groupId)) overlap += 1;
  }
  return overlap;
}

export function trainMultinomialNaiveBayes(
  train: LabeledJobExample[],
  options?: { seed?: number },
): TrainedJobClassifier {
  if (train.length === 0) throw new Error("Cannot train on an empty set.");

  const seed = options?.seed ?? CLASSIFIER_RANDOM_SEED;
  const classCounts = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((c) => [c, 0])) as Record<
    JobCorpusCategory,
    number
  >;
  const tokenCounts = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((c) => [c, new Map<string, number>()])) as Record<
    JobCorpusCategory,
    Map<string, number>
  >;
  const vocab = new Set<string>();

  for (const example of train) {
    classCounts[example.category] += 1;
    const seen = new Set<string>();
    for (const token of exampleToTokens(example)) {
      vocab.add(token);
      // Multinomial: count occurrences (not binary).
      tokenCounts[example.category].set(token, (tokenCounts[example.category].get(token) ?? 0) + 1);
      seen.add(token);
    }
    void seen;
  }

  const vocabulary = Array.from(vocab).sort();
  const totalDocs = train.length;
  const classLogPrior = {} as Record<JobCorpusCategory, number>;
  const tokenLogProb = {} as Record<JobCorpusCategory, number[]>;

  for (const category of JOB_CORPUS_CATEGORIES) {
    const docsInClass = classCounts[category];
    classLogPrior[category] = Math.log((docsInClass + 1) / (totalDocs + JOB_CORPUS_CATEGORIES.length));

    let totalTokens = 0;
    for (const count of tokenCounts[category].values()) totalTokens += count;

    const alpha = 1;
    const denom = totalTokens + alpha * vocabulary.length;
    tokenLogProb[category] = vocabulary.map((token) => {
      const count = tokenCounts[category].get(token) ?? 0;
      return Math.log((count + alpha) / denom);
    });
  }

  return {
    kind: "multinomial_nb",
    categories: [...JOB_CORPUS_CATEGORIES],
    vocabulary,
    tokenLogProb,
    classLogPrior,
    trainedOn: train.length,
    seed,
  };
}

export function predictJobCategory(
  model: TrainedJobClassifier,
  example: Pick<LabeledJobExample, "title" | "description">,
): JobCorpusCategory {
  const tokens = exampleToTokens(example);
  const index = new Map(model.vocabulary.map((token, i) => [token, i]));
  let best: JobCorpusCategory = model.categories[0]!;
  let bestScore = -Infinity;

  for (const category of model.categories) {
    let score = model.classLogPrior[category];
    for (const token of tokens) {
      const i = index.get(token);
      if (i === undefined) continue;
      score += model.tokenLogProb[category][i]!;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

export function emptyConfusionMatrix(categories: readonly JobCorpusCategory[] = JOB_CORPUS_CATEGORIES): ConfusionMatrix {
  const matrix = {} as ConfusionMatrix;
  for (const actual of categories) {
    matrix[actual] = {} as Record<JobCorpusCategory, number>;
    for (const predicted of categories) matrix[actual][predicted] = 0;
  }
  return matrix;
}

/**
 * Score a held-out labeled set from parallel predictions (same length/order as `test`).
 * Shared by Naive Bayes and experimental TF-IDF logistic regression.
 */
export function evaluatePredictions(
  test: LabeledJobExample[],
  predictions: readonly JobCorpusCategory[],
  meta: {
    trainSize: number;
    seed: number;
    trainFraction: number;
    model: ClassifierEvalReport["model"];
  },
  options?: { notes?: readonly string[] },
): ClassifierEvalReport {
  if (test.length === 0) throw new Error("Cannot evaluate on an empty test set.");
  if (predictions.length !== test.length) {
    throw new Error("Predictions length must match the test set.");
  }

  const categories = [...JOB_CORPUS_CATEGORIES];
  const confusionMatrix = emptyConfusionMatrix(categories);
  let correct = 0;

  for (let i = 0; i < test.length; i++) {
    const example = test[i]!;
    const predicted = predictions[i]!;
    confusionMatrix[example.category][predicted] += 1;
    if (predicted === example.category) correct += 1;
  }

  const accuracy = correct / test.length;
  const perClass = {} as Record<JobCorpusCategory, ClassMetrics>;
  let macroF1Sum = 0;

  for (const category of categories) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const actual of categories) {
      for (const predicted of categories) {
        const n = confusionMatrix[actual][predicted];
        if (actual === category && predicted === category) tp += n;
        if (actual !== category && predicted === category) fp += n;
        if (actual === category && predicted !== category) fn += n;
      }
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const support = categories.reduce((sum, predicted) => sum + confusionMatrix[category][predicted], 0);
    perClass[category] = { precision, recall, f1, support };
    macroF1Sum += f1;
  }

  return {
    generatedAt: new Date().toISOString(),
    model: meta.model,
    seed: meta.seed,
    trainFraction: meta.trainFraction,
    trainSize: meta.trainSize,
    testSize: test.length,
    categories,
    accuracy,
    meetsTarget: accuracy >= CLASSIFIER_TARGET_ACCURACY,
    targetAccuracy: CLASSIFIER_TARGET_ACCURACY,
    confusionMatrix,
    perClass,
    macroF1: macroF1Sum / categories.length,
    notes: [
      ...(options?.notes ?? [
        "Trained and evaluated offline on HireHub synthetic corpus labels (Track 1 generator).",
        "Features: job title + description only. The gold category column is never used as a feature.",
        "Metrics are computed only on the held-out 20% test split (no train evaluation).",
        "Explicit category names/slugs are masked in both title and description; occupational stems such as engineer/designer/analyst are kept.",
        "Synthetic skill-list lines and category-revealing boilerplate are stripped from classifier features only (punctuation-safe; corpus text and gold labels unchanged).",
        "Separate from live job recommendations, auth, RLS, and the gte-small prototype evaluation.",
      ]),
    ],
  };
}

/**
 * Evaluate only on the provided examples (must be the held-out test set).
 * Never pass the training set here.
 */
export function evaluateClassifier(
  model: TrainedJobClassifier,
  test: LabeledJobExample[],
  meta: { trainSize: number; seed: number; trainFraction: number },
  options?: { notes?: readonly string[] },
): ClassifierEvalReport {
  const predictions = test.map((example) => predictJobCategory(model, example));
  return evaluatePredictions(
    test,
    predictions,
    { ...meta, model: "multinomial_nb" },
    options,
  );
}

/** Default Jaccard threshold for same-class train/test near-duplicate reporting. */
export const SYNTHETIC_NEAR_DUPLICATE_JACCARD = 0.9 as const;

export function tokenJaccard(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Share of test rows that have at least one same-class training neighbor at/above
 * the Jaccard threshold on masked feature tokens. IDs may still be disjoint.
 */
export function measureSameClassNearDuplicateRate(
  split: ClassifierSplit,
  options?: { threshold?: number; tokenize?: (example: LabeledJobExample) => string[] },
): { rate: number; count: number; threshold: number; testSize: number } {
  const threshold = options?.threshold ?? SYNTHETIC_NEAR_DUPLICATE_JACCARD;
  const tokenize = options?.tokenize ?? exampleToTokens;
  const trainByClass = new Map<JobCorpusCategory, string[][]>();
  for (const category of JOB_CORPUS_CATEGORIES) trainByClass.set(category, []);
  for (const example of split.train) {
    trainByClass.get(example.category)!.push(tokenize(example));
  }

  let count = 0;
  for (const example of split.test) {
    const testTokens = tokenize(example);
    const peers = trainByClass.get(example.category) ?? [];
    const hit = peers.some((peer) => tokenJaccard(testTokens, peer) >= threshold);
    if (hit) count += 1;
  }

  return {
    rate: split.test.length === 0 ? 0 : count / split.test.length,
    count,
    threshold,
    testSize: split.test.length,
  };
}

/**
 * Retrain NB on the same split using an alternate tokenizer (ablation only).
 * Does not mutate the primary model used for the headline accuracy.
 */
export function scoreHeldOutWithTokenizer(
  split: ClassifierSplit,
  tokenize: (example: Pick<LabeledJobExample, "title" | "description">) => string[],
): number {
  if (split.test.length === 0) throw new Error("Cannot score an empty test set.");

  const classCounts = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((c) => [c, 0])) as Record<
    JobCorpusCategory,
    number
  >;
  const tokenCounts = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((c) => [c, new Map<string, number>()])) as Record<
    JobCorpusCategory,
    Map<string, number>
  >;
  const vocab = new Set<string>();

  for (const example of split.train) {
    classCounts[example.category] += 1;
    for (const token of tokenize(example)) {
      vocab.add(token);
      tokenCounts[example.category].set(token, (tokenCounts[example.category].get(token) ?? 0) + 1);
    }
  }

  const vocabulary = Array.from(vocab).sort();
  const totalDocs = split.train.length;
  const classLogPrior = {} as Record<JobCorpusCategory, number>;
  const tokenLogProb = {} as Record<JobCorpusCategory, number[]>;

  for (const category of JOB_CORPUS_CATEGORIES) {
    classLogPrior[category] = Math.log(
      (classCounts[category] + 1) / (totalDocs + JOB_CORPUS_CATEGORIES.length),
    );
    let totalTokens = 0;
    for (const count of tokenCounts[category].values()) totalTokens += count;
    const denom = totalTokens + vocabulary.length;
    tokenLogProb[category] = vocabulary.map((token) => {
      const count = tokenCounts[category].get(token) ?? 0;
      return Math.log((count + 1) / denom);
    });
  }

  const index = new Map(vocabulary.map((token, i) => [token, i]));
  let correct = 0;
  for (const example of split.test) {
    const tokens = tokenize(example);
    let best: JobCorpusCategory = JOB_CORPUS_CATEGORIES[0]!;
    let bestScore = -Infinity;
    for (const category of JOB_CORPUS_CATEGORIES) {
      let score = classLogPrior[category];
      for (const token of tokens) {
        const i = index.get(token);
        if (i === undefined) continue;
        score += tokenLogProb[category][i]!;
      }
      if (score > bestScore) {
        bestScore = score;
        best = category;
      }
    }
    if (best === example.category) correct += 1;
  }

  return correct / split.test.length;
}

export function buildSyntheticSplitDiagnostics(
  split: ClassifierSplit,
  fullMaskedAccuracy: number,
): SyntheticSplitDiagnostics {
  const near = measureSameClassNearDuplicateRate(split);
  const titleOnlyAccuracy = scoreHeldOutWithTokenizer(split, (example) =>
    exampleToTokens({ title: example.title, description: "" }),
  );
  const descriptionOnlyAccuracy = scoreHeldOutWithTokenizer(split, (example) =>
    exampleToTokens({ title: "", description: example.description }),
  );
  const templateGroupOverlapCount = countTemplateGroupOverlap(split);
  const splitMode = split.mode ?? "row";

  return {
    titleOnlyAccuracy,
    descriptionOnlyAccuracy,
    fullMaskedAccuracy,
    nearDuplicateRate: near.rate,
    nearDuplicateCount: near.count,
    nearDuplicateThreshold: near.threshold,
    templateGroupOverlapCount,
    splitMode,
    notes: [
      "Explicit category-slug masking and punctuation-safe synthetic skill/boilerplate stripping are applied to features only; gold labels are untouched.",
      "Offline evaluation uses template-group splits (category::baseTitle) so seniority/location variants of the same role do not appear on both sides.",
      "A high synthetic score is still not a real-world accuracy claim; gte-small prototype evaluation remains a separate offline check.",
    ],
  };
}

/** End-to-end: generate labeled synthetic corpus → group split → train → held-out eval. */
export function runJobClassifierPipeline(options?: {
  count?: number;
  seed?: number;
  trainFraction?: number;
}): {
  split: ClassifierSplit;
  model: TrainedJobClassifier;
  report: ClassifierEvalReport;
} {
  const count = options?.count ?? 5000;
  const seed = options?.seed ?? CLASSIFIER_RANDOM_SEED;
  const trainFraction = options?.trainFraction ?? CLASSIFIER_TRAIN_FRACTION;

  const docs = generateSyntheticJobCorpus(count);
  const examples = corpusDocsToLabeledExamples(docs);
  const split = stratifiedGroupTrainTestSplit(examples, { seed, trainFraction });
  assertNoSplitLeakage(split);
  assertNoTemplateGroupLeakage(split);
  const model = trainMultinomialNaiveBayes(split.train, { seed });
  const base = evaluateClassifier(model, split.test, {
    trainSize: split.train.length,
    seed,
    trainFraction,
  });
  const syntheticDiagnostics = buildSyntheticSplitDiagnostics(split, base.accuracy);

  const report: ClassifierEvalReport = {
    ...base,
    syntheticDiagnostics,
    notes: [
      ...base.notes,
      ...syntheticDiagnostics.notes,
      `Split mode=${syntheticDiagnostics.splitMode}; template-group overlap=${syntheticDiagnostics.templateGroupOverlapCount}.`,
      `Ablation (masked+stripped): title-only accuracy=${(syntheticDiagnostics.titleOnlyAccuracy * 100).toFixed(2)}%; description-only=${(syntheticDiagnostics.descriptionOnlyAccuracy * 100).toFixed(2)}%.`,
      `Same-class near-duplicate rate (Jaccard>=${syntheticDiagnostics.nearDuplicateThreshold}): ${(syntheticDiagnostics.nearDuplicateRate * 100).toFixed(2)}% (${syntheticDiagnostics.nearDuplicateCount}/${base.testSize} test rows).`,
    ],
  };

  return { split, model, report };
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
