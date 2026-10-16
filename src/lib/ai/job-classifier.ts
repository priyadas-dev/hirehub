import {
  JOB_CORPUS_CATEGORIES,
  type JobCorpusCategory,
} from "@/lib/ai/corpus";
import { generateSyntheticJobCorpus, type GeneratedCorpusDoc } from "@/lib/ai/corpus-generate";

export const CLASSIFIER_RANDOM_SEED = 42 as const;
export const CLASSIFIER_TRAIN_FRACTION = 0.8 as const;
export const CLASSIFIER_TARGET_ACCURACY = 0.7 as const;

export type LabeledJobExample = {
  id: string;
  title: string;
  description: string;
  category: JobCorpusCategory;
};

export type ClassifierSplit = {
  train: LabeledJobExample[];
  test: LabeledJobExample[];
  seed: number;
  trainFraction: number;
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

export type ClassifierEvalReport = {
  generatedAt: string;
  model: "multinomial_nb";
  seed: number;
  trainFraction: number;
  trainSize: number;
  testSize: number;
  categories: JobCorpusCategory[];
  accuracy: number;
  meetsTarget: boolean;
  targetAccuracy: number;
  confusionMatrix: ConfusionMatrix;
  perClass: Record<JobCorpusCategory, ClassMetrics>;
  macroF1: number;
  notes: string[];
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

/** Features for classification: title + description only (never the label column). */
export function exampleToTokens(example: Pick<LabeledJobExample, "title" | "description">): string[] {
  return tokenizeJobText(example.title, example.description);
}

export function corpusDocsToLabeledExamples(docs: GeneratedCorpusDoc[]): LabeledJobExample[] {
  return docs.map((doc) => ({
    id: doc.corpus_key,
    title: doc.title,
    description: doc.description,
    category: doc.category,
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

  return { train, test, seed, trainFraction };
}

export function assertNoSplitLeakage(split: ClassifierSplit): void {
  const trainIds = new Set(split.train.map((e) => e.id));
  for (const example of split.test) {
    if (trainIds.has(example.id)) {
      throw new Error(`Data leakage: test id ${example.id} also appears in training set.`);
    }
  }
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
 * Evaluate only on the provided examples (must be the held-out test set).
 * Never pass the training set here.
 */
export function evaluateClassifier(
  model: TrainedJobClassifier,
  test: LabeledJobExample[],
  meta: { trainSize: number; seed: number; trainFraction: number },
): ClassifierEvalReport {
  if (test.length === 0) throw new Error("Cannot evaluate on an empty test set.");

  const confusionMatrix = emptyConfusionMatrix(model.categories);
  let correct = 0;

  for (const example of test) {
    const predicted = predictJobCategory(model, example);
    confusionMatrix[example.category][predicted] += 1;
    if (predicted === example.category) correct += 1;
  }

  const accuracy = correct / test.length;
  const perClass = {} as Record<JobCorpusCategory, ClassMetrics>;
  let macroF1Sum = 0;

  for (const category of model.categories) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const actual of model.categories) {
      for (const predicted of model.categories) {
        const n = confusionMatrix[actual][predicted];
        if (actual === category && predicted === category) tp += n;
        if (actual !== category && predicted === category) fp += n;
        if (actual === category && predicted !== category) fn += n;
      }
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const support = model.categories.reduce((sum, predicted) => sum + confusionMatrix[category][predicted], 0);
    perClass[category] = { precision, recall, f1, support };
    macroF1Sum += f1;
  }

  return {
    generatedAt: new Date().toISOString(),
    model: "multinomial_nb",
    seed: meta.seed,
    trainFraction: meta.trainFraction,
    trainSize: meta.trainSize,
    testSize: test.length,
    categories: [...model.categories],
    accuracy,
    meetsTarget: accuracy >= CLASSIFIER_TARGET_ACCURACY,
    targetAccuracy: CLASSIFIER_TARGET_ACCURACY,
    confusionMatrix,
    perClass,
    macroF1: macroF1Sum / model.categories.length,
    notes: [
      "Trained and evaluated offline on HireHub synthetic corpus labels (Track 1 generator).",
      "Features: job title + description only. Category label is never used as a feature.",
      "Metrics are computed only on the held-out 20% test split (no train evaluation).",
      "Synthetic descriptions may mention category words by construction — treat absolute accuracy as optimistic vs real vacancies.",
      "Separate from live job recommendations, auth, and RLS.",
    ],
  };
}

/** End-to-end: generate labeled synthetic corpus → split → train → held-out eval. */
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
  const split = stratifiedTrainTestSplit(examples, { seed, trainFraction });
  assertNoSplitLeakage(split);
  const model = trainMultinomialNaiveBayes(split.train, { seed });
  const report = evaluateClassifier(model, split.test, {
    trainSize: split.train.length,
    seed,
    trainFraction,
  });

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
