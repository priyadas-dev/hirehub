/**
 * Controlled offline comparison: multinomial NB (baseline) vs experimental TF-IDF logreg.
 * Same preprocess, gold labels, template-group split, and seed.
 */
import {
  assertNoSplitLeakage,
  assertNoTemplateGroupLeakage,
  buildSyntheticSplitDiagnostics,
  buildTrack5EvalEnvelope,
  CLASSIFIER_RANDOM_SEED,
  CLASSIFIER_TRAIN_FRACTION,
  evaluateClassifier,
  stratifiedGroupTrainTestSplit,
  trainMultinomialNaiveBayes,
  type ClassifierEvalReport,
  type ClassifierSplit,
  type SyntheticSplitDiagnostics,
  type Track5EvalEnvelope,
  type TrainedJobClassifier,
} from "@/lib/ai/job-classifier";
import {
  generateClassifierLabeledExamples,
  type ClassifierEnrichmentVariant,
} from "@/lib/ai/job-classifier-dataset";
import {
  evaluateTfidfLogRegOnSplit,
  type TfidfLogRegModel,
} from "@/lib/ai/job-classifier-tfidf-lr";
import {
  selectTfidfLogRegHyperparams,
  type TfidfLogRegHyperparams,
  type TfidfTuneResult,
} from "@/lib/ai/job-classifier-tune";

/** Pre-fix evaluation snapshot (same split policy); for historical comparison only. */
export const CLASSIFIER_HISTORICAL_REFERENCE = {
  recordedAt: "2026-10-27T11:46:45.345Z",
  note: "Measured before holdout tuning was corrected to fixed-preset fallback; split seed 42 unchanged.",
  naiveBayes: { accuracy: 0.9527824620573356, macroF1: 0.9365547365547365 },
  tfidfLogReg: { accuracy: 0.7537942664418212, macroF1: 0.7412006024754675 },
} as const;

export type ClassifierComparisonReport = {
  seed: number;
  trainFraction: number;
  trainSize: number;
  testSize: number;
  splitMode: "row" | "template_group";
  diagnostics: SyntheticSplitDiagnostics;
  naiveBayes: ClassifierEvalReport;
  tfidfLogReg: ClassifierEvalReport;
  tfidfTuning?: TfidfTuneResult;
  historicalReference?: typeof CLASSIFIER_HISTORICAL_REFERENCE;
  /** Dual-benchmark envelope (synthetic vs independent placeholder). */
  track5?: Track5EvalEnvelope;
  notes: string[];
};

export function compareClassifiersOnGroupedSplit(options?: {
  count?: number;
  seed?: number;
  trainFraction?: number;
  enrichmentVariant?: ClassifierEnrichmentVariant;
  /** Override holdout grid (tests may pass a single candidate for speed). */
  tfidfTuneCandidates?: TfidfLogRegHyperparams[];
}): {
  split: ClassifierSplit;
  naiveBayesModel: TrainedJobClassifier;
  tfidfLogRegModel: TfidfLogRegModel;
  comparison: ClassifierComparisonReport;
} {
  const count = options?.count ?? 5000;
  const seed = options?.seed ?? CLASSIFIER_RANDOM_SEED;
  const trainFraction = options?.trainFraction ?? CLASSIFIER_TRAIN_FRACTION;

  const examples = generateClassifierLabeledExamples(count, {
    variant: options?.enrichmentVariant,
  });
  const split = stratifiedGroupTrainTestSplit(examples, { seed, trainFraction });
  assertNoSplitLeakage(split);
  assertNoTemplateGroupLeakage(split);

  const naiveBayesModel = trainMultinomialNaiveBayes(split.train, { seed });
  const naiveBayes = evaluateClassifier(naiveBayesModel, split.test, {
    trainSize: split.train.length,
    seed,
    trainFraction,
  });
  const diagnostics = buildSyntheticSplitDiagnostics(split, naiveBayes.accuracy);
  const naiveBayesReport: ClassifierEvalReport = {
    ...naiveBayes,
    syntheticDiagnostics: diagnostics,
    notes: [
      ...naiveBayes.notes,
      ...diagnostics.notes,
      "Baseline multinomial Naive Bayes under leakage-resistant template-group evaluation (Option A remediated features).",
    ],
  };

  const tuned = selectTfidfLogRegHyperparams(split.train, {
    seed,
    candidates: options?.tfidfTuneCandidates,
  });
  const { model: tfidfLogRegModel, report: tfidfLogReg } = evaluateTfidfLogRegOnSplit(split, {
    seed,
    ...tuned.params,
  });
  const tfidfReport: ClassifierEvalReport = {
    ...tfidfLogReg,
    syntheticDiagnostics: diagnostics,
    notes: [
      ...tfidfLogReg.notes,
      ...diagnostics.notes,
      "Experimental comparator on the identical grouped split and preprocess as Naive Bayes.",
    ],
  };

  const track5 = buildTrack5EvalEnvelope(naiveBayesReport);

  return {
    split,
    naiveBayesModel,
    tfidfLogRegModel,
    comparison: {
      seed,
      trainFraction,
      trainSize: split.train.length,
      testSize: split.test.length,
      splitMode: split.mode ?? "template_group",
      diagnostics,
      naiveBayes: naiveBayesReport,
      tfidfLogReg: tfidfReport,
      track5,
      notes: [
        "Both models share preprocess, gold labels, template-group split, and seed.",
        "Examples use Track 5 Option A classifier features (location + title-keyed duties; no category-tied skills line). Track-1 RAG corpus text is unchanged.",
        tuned.selectionMethod === "group_holdout"
          ? "TF-IDF hyperparameters were chosen by train-only template-group holdout."
          : "TF-IDF uses a documented fixed preset — train-only holdout could not discriminate candidates.",
        "TF-IDF vocabulary/IDF and logistic weights were fit on the training split only.",
        "Near-duplicate and template-group overlap diagnostics are shared across both reports.",
        "Do not treat either synthetic score as a real-world accuracy claim without further validation.",
        "track5.syntheticBenchmark holds the official NB remediated metrics; track5.independentBenchmark stays unavailable until a real labeled set is sourced.",
      ],
      tfidfTuning: tuned,
      historicalReference: CLASSIFIER_HISTORICAL_REFERENCE,
    },
  };
}
