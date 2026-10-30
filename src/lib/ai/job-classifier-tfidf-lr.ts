/**
 * Experimental offline TF-IDF + one-vs-rest logistic regression for Assessment 2.
 * Uses the same preprocess / template-group split as multinomial NB.
 * Fit vocabulary and model on training data only — never on the held-out test set.
 */
import { JOB_CORPUS_CATEGORIES, type JobCorpusCategory } from "@/lib/ai/corpus";
import {
  CLASSIFIER_RANDOM_SEED,
  buildClassifierFeatureText,
  evaluatePredictions,
  tokenizeJobText,
  type ClassifierEvalReport,
  type ClassifierSplit,
  type LabeledJobExample,
} from "@/lib/ai/job-classifier";

export const TFIDF_WORD_NGRAM_MAX = 2 as const;
export const TFIDF_CHAR_NGRAM_MIN = 3 as const;
export const TFIDF_CHAR_NGRAM_MAX = 4 as const;
export const TFIDF_MIN_DF = 2 as const;
export const TFIDF_MAX_FEATURES = 6000 as const;
export const LOGREG_L2 = 1 as const;
export const LOGREG_EPOCHS = 60 as const;
export const LOGREG_LEARNING_RATE = 0.25 as const;
export const TFIDF_TITLE_REPEAT = 3 as const;

export type TfidfVectorizer = {
  vocabulary: string[];
  idf: number[];
  wordNgramMax: number;
  charNgramMin: number;
  charNgramMax: number;
  minDf: number;
  fittedOn: number;
};

export type TfidfLogRegModel = {
  kind: "tfidf_logreg";
  categories: JobCorpusCategory[];
  vectorizer: TfidfVectorizer;
  /** weight matrix [classIndex][featureIndex] */
  weights: number[][];
  bias: number[];
  trainedOn: number;
  seed: number;
  titleRepeat: number;
};

/** Emphasize title tokens relative to description (same preprocess as NB). */
export function buildTfidfFeatureText(
  example: Pick<LabeledJobExample, "title" | "description">,
  options?: { titleRepeat?: number },
): string {
  const repeat = options?.titleRepeat ?? TFIDF_TITLE_REPEAT;
  const base = buildClassifierFeatureText(example);
  const titleLine = base.split("\n")[0] ?? "";
  const description = base.split("\n").slice(1).join("\n");
  const titleBlock = Array.from({ length: Math.max(1, repeat) }, () => titleLine).join("\n");
  return description.trim() ? `${titleBlock}\n${description}` : titleBlock;
}

function wordNgrams(tokens: string[], maxN: number): string[] {
  const out: string[] = [];
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      out.push(`w${n}:${tokens.slice(i, i + n).join("_")}`);
    }
  }
  return out;
}

function charNgrams(text: string, minN: number, maxN: number): string[] {
  const normalized = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const out: string[] = [];
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i + n <= normalized.length; i++) {
      out.push(`c${n}:${normalized.slice(i, i + n)}`);
    }
  }
  return out;
}

/** Extract TF-IDF feature strings from already-preprocessed title+description text. */
export function extractTfidfFeatureStrings(
  featureText: string,
  options?: { wordNgramMax?: number; charNgramMin?: number; charNgramMax?: number },
): string[] {
  const wordNgramMax = options?.wordNgramMax ?? TFIDF_WORD_NGRAM_MAX;
  const charNgramMin = options?.charNgramMin ?? TFIDF_CHAR_NGRAM_MIN;
  const charNgramMax = options?.charNgramMax ?? TFIDF_CHAR_NGRAM_MAX;
  const tokens = tokenizeJobText(featureText, "");
  return [
    ...wordNgrams(tokens, wordNgramMax),
    ...charNgrams(featureText, charNgramMin, charNgramMax),
  ];
}

function countFeatures(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const feats of docs) {
    for (const f of new Set(feats)) {
      df.set(f, (df.get(f) ?? 0) + 1);
    }
  }
  return df;
}

/** Fit TF-IDF vocabulary + IDF on training feature strings only. */
export function fitTfidfVectorizer(
  trainFeatureTexts: string[],
  options?: {
    wordNgramMax?: number;
    charNgramMin?: number;
    charNgramMax?: number;
    minDf?: number;
    maxFeatures?: number;
  },
): TfidfVectorizer {
  if (trainFeatureTexts.length === 0) throw new Error("Cannot fit TF-IDF on an empty training set.");
  const minDf = options?.minDf ?? TFIDF_MIN_DF;
  const maxFeatures = options?.maxFeatures ?? TFIDF_MAX_FEATURES;
  const docs = trainFeatureTexts.map((text) =>
    extractTfidfFeatureStrings(text, {
      wordNgramMax: options?.wordNgramMax,
      charNgramMin: options?.charNgramMin,
      charNgramMax: options?.charNgramMax,
    }),
  );
  const df = countFeatures(docs);
  const candidates = [...df.entries()]
    .filter(([, count]) => count >= minDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFeatures)
    .map(([feat]) => feat)
    .sort();

  const nDocs = trainFeatureTexts.length;
  const idf = candidates.map((feat) => {
    const count = df.get(feat) ?? 0;
    return Math.log((1 + nDocs) / (1 + count)) + 1;
  });

  return {
    vocabulary: candidates,
    idf,
    wordNgramMax: options?.wordNgramMax ?? TFIDF_WORD_NGRAM_MAX,
    charNgramMin: options?.charNgramMin ?? TFIDF_CHAR_NGRAM_MIN,
    charNgramMax: options?.charNgramMax ?? TFIDF_CHAR_NGRAM_MAX,
    minDf,
    fittedOn: nDocs,
  };
}

/** Transform texts with a vectorizer fitted on training data only. */
export function transformTfidf(vectorizer: TfidfVectorizer, featureTexts: string[]): number[][] {
  const index = new Map(vectorizer.vocabulary.map((feat, i) => [feat, i]));
  return featureTexts.map((text) => {
    const feats = extractTfidfFeatureStrings(text, {
      wordNgramMax: vectorizer.wordNgramMax,
      charNgramMin: vectorizer.charNgramMin,
      charNgramMax: vectorizer.charNgramMax,
    });
    const tf = new Map<string, number>();
    for (const f of feats) tf.set(f, (tf.get(f) ?? 0) + 1);
    const row = new Array(vectorizer.vocabulary.length).fill(0);
    const length = Math.max(feats.length, 1);
    for (const [feat, count] of tf) {
      const i = index.get(feat);
      if (i === undefined) continue;
      row[i] = (count / length) * vectorizer.idf[i]!;
    }
    // L2 normalize
    let norm = 0;
    for (const v of row) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < row.length; i++) row[i] = row[i]! / norm;
    return row;
  });
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function trainBinaryLogReg(
  X: number[][],
  y: number[],
  options: { l2: number; epochs: number; learningRate: number },
): { weights: number[]; bias: number } {
  const dim = X[0]?.length ?? 0;
  const weights = new Array(dim).fill(0);
  let bias = 0;
  const n = X.length || 1;

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    const gradW = new Array(dim).fill(0);
    let gradB = 0;
    for (let i = 0; i < X.length; i++) {
      const x = X[i]!;
      let z = bias;
      for (let j = 0; j < dim; j++) z += weights[j]! * x[j]!;
      const p = sigmoid(z);
      const err = p - y[i]!;
      for (let j = 0; j < dim; j++) gradW[j] += err * x[j]!;
      gradB += err;
    }
    for (let j = 0; j < dim; j++) {
      gradW[j] = gradW[j]! / n + options.l2 * weights[j]!;
      weights[j]! -= options.learningRate * gradW[j]!;
    }
    bias -= options.learningRate * (gradB / n);
  }
  return { weights, bias };
}

/** Train OvR logistic regression on TF-IDF features (training rows only). */
export function trainTfidfLogisticRegression(
  train: LabeledJobExample[],
  options?: {
    seed?: number;
    l2?: number;
    epochs?: number;
    learningRate?: number;
    minDf?: number;
    maxFeatures?: number;
    wordNgramMax?: number;
    charNgramMin?: number;
    charNgramMax?: number;
    titleRepeat?: number;
  },
): TfidfLogRegModel {
  if (train.length === 0) throw new Error("Cannot train TF-IDF logreg on an empty set.");
  const seed = options?.seed ?? CLASSIFIER_RANDOM_SEED;
  const titleRepeat = options?.titleRepeat ?? TFIDF_TITLE_REPEAT;
  const trainTexts = train.map((example) => buildTfidfFeatureText(example, { titleRepeat }));
  const vectorizer = fitTfidfVectorizer(trainTexts, {
    minDf: options?.minDf,
    maxFeatures: options?.maxFeatures,
    wordNgramMax: options?.wordNgramMax,
    charNgramMin: options?.charNgramMin,
    charNgramMax: options?.charNgramMax,
  });
  const X = transformTfidf(vectorizer, trainTexts);
  const weights: number[][] = [];
  const bias: number[] = [];

  for (const category of JOB_CORPUS_CATEGORIES) {
    const y = train.map((example) => (example.category === category ? 1 : 0));
    const binary = trainBinaryLogReg(X, y, {
      l2: options?.l2 ?? LOGREG_L2,
      epochs: options?.epochs ?? LOGREG_EPOCHS,
      learningRate: options?.learningRate ?? LOGREG_LEARNING_RATE,
    });
    weights.push(binary.weights);
    bias.push(binary.bias);
  }

  return {
    kind: "tfidf_logreg",
    categories: [...JOB_CORPUS_CATEGORIES],
    vectorizer,
    weights,
    bias,
    trainedOn: train.length,
    seed,
    titleRepeat,
  };
}

export function predictTfidfLogReg(
  model: TfidfLogRegModel,
  example: Pick<LabeledJobExample, "title" | "description">,
): JobCorpusCategory {
  const [row] = transformTfidf(model.vectorizer, [
    buildTfidfFeatureText(example, { titleRepeat: model.titleRepeat }),
  ]);
  const x = row!;
  let best: JobCorpusCategory = model.categories[0]!;
  let bestScore = -Infinity;
  for (let c = 0; c < model.categories.length; c++) {
    let score = model.bias[c]!;
    const w = model.weights[c]!;
    for (let j = 0; j < w.length; j++) score += w[j]! * x[j]!;
    if (score > bestScore) {
      bestScore = score;
      best = model.categories[c]!;
    }
  }
  return best;
}

/** Evaluate experimental TF-IDF logreg on an existing split (train-only fit). */
export function evaluateTfidfLogRegOnSplit(
  split: ClassifierSplit,
  options?: {
    seed?: number;
    l2?: number;
    epochs?: number;
    learningRate?: number;
    minDf?: number;
    maxFeatures?: number;
    wordNgramMax?: number;
    charNgramMin?: number;
    charNgramMax?: number;
    titleRepeat?: number;
  },
): { model: TfidfLogRegModel; report: ClassifierEvalReport } {
  const seed = options?.seed ?? split.seed;
  const model = trainTfidfLogisticRegression(split.train, { seed, ...options });
  const predictions = split.test.map((example) => predictTfidfLogReg(model, example));
  const report = evaluatePredictions(
    split.test,
    predictions,
    {
      trainSize: split.train.length,
      seed,
      trainFraction: split.trainFraction,
      model: "tfidf_logreg",
    },
    {
      notes: [
        "Experimental TF-IDF (word 1–2 grams + char 3–4 grams) + one-vs-rest L2 logistic regression.",
        "Vectorizer vocabulary/IDF and model weights were fit on the training split only.",
        "Uses the same preprocess (category-slug mask + skill/boilerplate strip) and template-group split as Naive Bayes.",
        "Synthetic skill lists are not restored as features. Not a production assistant/RAG path.",
        "This experimental score is not a real-world accuracy claim unless separately validated.",
      ],
    },
  );
  return { model, report };
}
