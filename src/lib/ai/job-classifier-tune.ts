/**
 * Train-only hyperparameter selection for offline TF-IDF + logistic regression.
 *
 * Investigation (synthetic template-group data, train split only):
 * - Validation holds out entire role templates (`category::baseTitle`) from innerTrain.
 * - That matches the difficulty of the official 20% test split (unseen templates).
 * - On ~3.8k train rows, inner-val accuracy stays ~0% even with full training epochs,
 *   because tool/duty features do not transfer reliably to unseen templates with OvR logreg.
 * - A low epoch cap during tuning made this worse but was not the root cause.
 *
 * When holdout cannot discriminate candidates, we use FIXED_TFIDF_LOGREG_HYPERPARAMS
 * (offline preset from a prior train-only grid comparison — never chosen using test labels).
 */
import { JOB_CORPUS_CATEGORIES, type JobCorpusCategory } from "@/lib/ai/corpus";
import { syntheticTemplateGroupId } from "@/lib/ai/corpus-generate";
import { createSeededRng, type LabeledJobExample } from "@/lib/ai/job-classifier";
import { predictTfidfLogReg, trainTfidfLogisticRegression } from "@/lib/ai/job-classifier-tfidf-lr";

export type TfidfLogRegHyperparams = {
  l2: number;
  epochs: number;
  learningRate: number;
  minDf: number;
  maxFeatures: number;
  wordNgramMax: number;
  charNgramMin: number;
  charNgramMax: number;
  titleRepeat: number;
};

export type TfidfTuneSelectionMethod = "group_holdout" | "fixed_preset";

export type TfidfTuneResult = {
  params: TfidfLogRegHyperparams;
  selectionMethod: TfidfTuneSelectionMethod;
  /** Accuracy on train-only template-group holdout (not the official 20% test split). */
  holdoutValAccuracy: number;
  holdoutValMacroF1: number;
  /** @deprecated Use holdoutValAccuracy — kept for JSON report compatibility. */
  cvAccuracy: number;
  /** @deprecated Use holdoutValMacroF1 */
  cvMacroF1: number;
  folds: number;
  candidatesEvaluated: number;
  /** Per-candidate holdout scores when selection ran (empty when fixed preset skips grid). */
  candidateHoldoutScores: Array<{ params: TfidfLogRegHyperparams; accuracy: number; macroF1: number }>;
  notes: string[];
};

/**
 * Documented offline preset (train-only grid comparison on the same split policy).
 * Not derived from the held-out 1186-row test set.
 */
export const FIXED_TFIDF_LOGREG_HYPERPARAMS: TfidfLogRegHyperparams = {
  l2: 0.1,
  epochs: 120,
  learningRate: 0.15,
  minDf: 1,
  maxFeatures: 20000,
  wordNgramMax: 3,
  charNgramMin: 2,
  charNgramMax: 6,
  titleRepeat: 4,
} as const;

/** Below this train-only holdout accuracy, candidates are treated as non-discriminative. */
export const TFIDF_HOLDOUT_MEANINGFUL_ACCURACY = 0.05 as const;

/** Minimum spread between best and worst holdout accuracy to trust argmax selection. */
export const TFIDF_HOLDOUT_MIN_ACCURACY_SPREAD = 0.01 as const;

const DEFAULT_CANDIDATES: TfidfLogRegHyperparams[] = [
  FIXED_TFIDF_LOGREG_HYPERPARAMS,
  {
    l2: 0.25,
    epochs: 80,
    learningRate: 0.2,
    minDf: 1,
    maxFeatures: 12000,
    wordNgramMax: 2,
    charNgramMin: 2,
    charNgramMax: 5,
    titleRepeat: 3,
  },
  {
    l2: 0.5,
    epochs: 90,
    learningRate: 0.18,
    minDf: 1,
    maxFeatures: 14000,
    wordNgramMax: 2,
    charNgramMin: 3,
    charNgramMax: 5,
    titleRepeat: 3,
  },
];

/** Fraction of training template groups reserved for tuning validation (train split only). */
export const TFIDF_TUNING_HOLDOUT_GROUP_FRACTION = 0.15 as const;

function groupIdsFor(examples: LabeledJobExample[]): string[] {
  return examples.map(
    (example) => example.templateGroupId ?? syntheticTemplateGroupId(example.category, example.title),
  );
}

function metricsFromPredictions(
  examples: LabeledJobExample[],
  predict: (example: LabeledJobExample) => JobCorpusCategory,
): { accuracy: number; macroF1: number } {
  if (examples.length === 0) return { accuracy: 0, macroF1: 0 };
  let correct = 0;
  const perClass = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((c) => [c, { tp: 0, fp: 0, fn: 0 }])) as Record<
    JobCorpusCategory,
    { tp: number; fp: number; fn: number }
  >;

  for (const example of examples) {
    const predicted = predict(example);
    if (predicted === example.category) correct += 1;
    for (const category of JOB_CORPUS_CATEGORIES) {
      const bucket = perClass[category];
      if (category === example.category && predicted === category) bucket.tp += 1;
      if (category !== example.category && predicted === category) bucket.fp += 1;
      if (category === example.category && predicted !== category) bucket.fn += 1;
    }
  }

  let macroF1 = 0;
  for (const category of JOB_CORPUS_CATEGORIES) {
    const { tp, fp, fn } = perClass[category];
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    macroF1 += f1;
  }

  return { accuracy: correct / examples.length, macroF1: macroF1 / JOB_CORPUS_CATEGORIES.length };
}

export type HoldoutValidateOptions = {
  seed: number;
  holdoutGroupFraction?: number;
  /** Use full `params.epochs` (required for honest holdout measurement). */
  useFullTrainingEpochs?: boolean;
};

/** Split train rows by template group; fit on innerTrain, score innerVal (train split only). */
export function splitTrainForGroupHoldout(
  train: LabeledJobExample[],
  options: { seed: number; holdoutGroupFraction?: number },
): { innerTrain: LabeledJobExample[]; innerVal: LabeledJobExample[]; valGroupCount: number } {
  const groups = groupIdsFor(train);
  const unique = Array.from(new Set(groups));
  const rng = createSeededRng(options.seed ^ 0x71ee011);
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [unique[i], unique[j]] = [unique[j]!, unique[i]!];
  }

  const fraction = options.holdoutGroupFraction ?? TFIDF_TUNING_HOLDOUT_GROUP_FRACTION;
  const valGroupCount = Math.min(
    Math.max(1, Math.floor(unique.length * fraction)),
    Math.max(1, unique.length - 1),
  );
  const valGroups = new Set(unique.slice(0, valGroupCount));

  const innerTrain: LabeledJobExample[] = [];
  const innerVal: LabeledJobExample[] = [];
  for (let i = 0; i < train.length; i++) {
    const example = train[i]!;
    const groupId = groups[i]!;
    if (valGroups.has(groupId)) innerVal.push(example);
    else innerTrain.push(example);
  }

  return { innerTrain, innerVal, valGroupCount };
}

/** Grouped holdout on the training split (never uses the held-out 20% test set). */
export function holdoutValidateParams(
  train: LabeledJobExample[],
  params: TfidfLogRegHyperparams,
  options: HoldoutValidateOptions,
): { accuracy: number; macroF1: number } {
  const { innerTrain, innerVal } = splitTrainForGroupHoldout(train, options);
  if (innerTrain.length === 0 || innerVal.length === 0) return { accuracy: 0, macroF1: 0 };

  const epochs = options.useFullTrainingEpochs === false ? Math.min(params.epochs, 28) : params.epochs;
  const model = trainTfidfLogisticRegression(innerTrain, {
    seed: options.seed,
    ...params,
    epochs,
  });
  return metricsFromPredictions(innerVal, (example) => predictTfidfLogReg(model, example));
}

function holdoutScoresForCandidates(
  train: LabeledJobExample[],
  candidates: TfidfLogRegHyperparams[],
  options: { seed: number; holdoutGroupFraction?: number; useFullTrainingEpochs: boolean },
): Array<{ params: TfidfLogRegHyperparams; accuracy: number; macroF1: number }> {
  return candidates.map((params) => {
    const { accuracy, macroF1 } = holdoutValidateParams(train, params, {
      seed: options.seed,
      holdoutGroupFraction: options.holdoutGroupFraction,
      useFullTrainingEpochs: options.useFullTrainingEpochs,
    });
    return { params, accuracy, macroF1 };
  });
}

function pickBestFromHoldoutScores(
  scores: Array<{ params: TfidfLogRegHyperparams; accuracy: number; macroF1: number }>,
): { best: TfidfLogRegHyperparams; bestScore: number; spread: number } {
  let best = scores[0]!.params;
  let bestScore = -Infinity;
  let minAcc = Infinity;
  let maxAcc = -Infinity;

  for (const row of scores) {
    minAcc = Math.min(minAcc, row.accuracy);
    maxAcc = Math.max(maxAcc, row.accuracy);
    const score = row.accuracy + 0.05 * row.macroF1;
    if (score > bestScore) {
      bestScore = score;
      best = row.params;
    }
  }

  return { best, bestScore, spread: maxAcc - minAcc };
}

function buildTuneResult(input: {
  params: TfidfLogRegHyperparams;
  selectionMethod: TfidfTuneSelectionMethod;
  holdout: { accuracy: number; macroF1: number };
  candidatesEvaluated: number;
  candidateHoldoutScores: TfidfTuneResult["candidateHoldoutScores"];
  notes: string[];
}): TfidfTuneResult {
  return {
    params: input.params,
    selectionMethod: input.selectionMethod,
    holdoutValAccuracy: input.holdout.accuracy,
    holdoutValMacroF1: input.holdout.macroF1,
    cvAccuracy: input.holdout.accuracy,
    cvMacroF1: input.holdout.macroF1,
    folds: 1,
    candidatesEvaluated: input.candidatesEvaluated,
    candidateHoldoutScores: input.candidateHoldoutScores,
    notes: input.notes,
  };
}

/**
 * Pick TF-IDF + logreg settings using train-only template-group holdout when it discriminates;
 * otherwise apply FIXED_TFIDF_LOGREG_HYPERPARAMS. The official test split is never used.
 */
export function selectTfidfLogRegHyperparams(
  train: LabeledJobExample[],
  options?: {
    seed?: number;
    candidates?: TfidfLogRegHyperparams[];
    holdoutGroupFraction?: number;
  },
): TfidfTuneResult {
  const seed = options?.seed ?? 42;
  const candidates =
    options?.candidates && options.candidates.length > 0 ? options.candidates : DEFAULT_CANDIDATES;

  const commonNotes = [
    "Template-group holdout reserves ~15% of training role templates for inner validation.",
    "The held-out 20% test split (seed 42) is never used for vocabulary fit, tuning, or model selection.",
  ];

  if (candidates.length === 1) {
    const holdout = holdoutValidateParams(train, candidates[0]!, {
      seed,
      holdoutGroupFraction: options?.holdoutGroupFraction,
      useFullTrainingEpochs: true,
    });
    return buildTuneResult({
      params: candidates[0]!,
      selectionMethod: "fixed_preset",
      holdout,
      candidatesEvaluated: 1,
      candidateHoldoutScores: [{ params: candidates[0]!, ...holdout }],
      notes: [
        ...commonNotes,
        "Single candidate supplied — treated as a fixed preset (no comparative selection).",
      ],
    });
  }

  // Fast probe with capped epochs to detect non-discriminative holdout before expensive full-epoch grid.
  const probeScores = holdoutScoresForCandidates(train, candidates, {
    seed,
    holdoutGroupFraction: options?.holdoutGroupFraction,
    useFullTrainingEpochs: false,
  });
  const probeMaxAcc = Math.max(...probeScores.map((row) => row.accuracy));

  let fullScores = probeScores;
  if (probeMaxAcc >= TFIDF_HOLDOUT_MEANINGFUL_ACCURACY) {
    fullScores = holdoutScoresForCandidates(train, candidates, {
      seed,
      holdoutGroupFraction: options?.holdoutGroupFraction,
      useFullTrainingEpochs: true,
    });
  }

  const { best, spread } = pickBestFromHoldoutScores(fullScores);
  const bestRow = fullScores.find((row) => row.params === best) ?? fullScores[0]!;
  const maxAcc = Math.max(...fullScores.map((row) => row.accuracy));

  const holdoutNonDiscriminative =
    maxAcc < TFIDF_HOLDOUT_MEANINGFUL_ACCURACY || spread < TFIDF_HOLDOUT_MIN_ACCURACY_SPREAD;

  if (holdoutNonDiscriminative) {
    const fixedHoldout = holdoutValidateParams(train, FIXED_TFIDF_LOGREG_HYPERPARAMS, {
      seed,
      holdoutGroupFraction: options?.holdoutGroupFraction,
      useFullTrainingEpochs: true,
    });
    return buildTuneResult({
      params: FIXED_TFIDF_LOGREG_HYPERPARAMS,
      selectionMethod: "fixed_preset",
      holdout: fixedHoldout,
      candidatesEvaluated: candidates.length,
      candidateHoldoutScores: fullScores,
      notes: [
        ...commonNotes,
        "Train-only template-group holdout accuracy stayed near zero for all candidates (unseen role templates).",
        "Holdout accuracy spread was below the minimum threshold — argmax selection would be arbitrary.",
        "Using FIXED_TFIDF_LOGREG_HYPERPARAMS from a prior offline train-only grid comparison (not test-selected).",
        "Do not describe this run as successful hyperparameter tuning on holdout metrics.",
      ],
    });
  }

  return buildTuneResult({
    params: best,
    selectionMethod: "group_holdout",
    holdout: { accuracy: bestRow.accuracy, macroF1: bestRow.macroF1 },
    candidatesEvaluated: candidates.length,
    candidateHoldoutScores: fullScores,
    notes: [
      ...commonNotes,
      "Selected the candidate with the best train-only template-group holdout score.",
    ],
  });
}

/** Exposed for unit tests (single candidate holdout scoring). */
export function scoreTfidfParamsOnTrainHoldout(
  train: LabeledJobExample[],
  params: TfidfLogRegHyperparams,
  seed: number,
): { accuracy: number; macroF1: number } {
  return holdoutValidateParams(train, params, { seed, useFullTrainingEpochs: true });
}

/** @deprecated Use scoreTfidfParamsOnTrainHoldout */
export function scoreTfidfParamsOnTrainCv(
  train: LabeledJobExample[],
  params: TfidfLogRegHyperparams,
  seed: number,
): { accuracy: number; macroF1: number } {
  return scoreTfidfParamsOnTrainHoldout(train, params, seed);
}
