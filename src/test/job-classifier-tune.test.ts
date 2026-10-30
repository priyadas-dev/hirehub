import { describe, expect, it } from "vitest";
import { generateClassifierLabeledExamples } from "@/lib/ai/job-classifier-dataset";
import { stratifiedGroupTrainTestSplit, CLASSIFIER_RANDOM_SEED } from "@/lib/ai/job-classifier";
import {
  FIXED_TFIDF_LOGREG_HYPERPARAMS,
  selectTfidfLogRegHyperparams,
  scoreTfidfParamsOnTrainHoldout,
} from "@/lib/ai/job-classifier-tune";

describe("TF-IDF train-only tuning", () => {
  it("uses train-only holdout or fixed preset without touching the official test split", () => {
    const examples = generateClassifierLabeledExamples(400);
    const split = stratifiedGroupTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    const tuned = selectTfidfLogRegHyperparams(split.train, {
      seed: CLASSIFIER_RANDOM_SEED,
      candidates: [
        {
          l2: 0.5,
          epochs: 20,
          learningRate: 0.2,
          minDf: 1,
          maxFeatures: 4000,
          wordNgramMax: 2,
          charNgramMin: 3,
          charNgramMax: 4,
          titleRepeat: 2,
        },
        {
          l2: 1,
          epochs: 24,
          learningRate: 0.25,
          minDf: 1,
          maxFeatures: 6000,
          wordNgramMax: 2,
          charNgramMin: 2,
          charNgramMax: 5,
          titleRepeat: 3,
        },
      ],
    });

    expect(tuned.params.maxFeatures).toBeGreaterThan(0);
    expect(tuned.candidatesEvaluated).toBe(2);
    expect(["group_holdout", "fixed_preset"]).toContain(tuned.selectionMethod);
    expect(tuned.holdoutValAccuracy).toBeGreaterThanOrEqual(0);
    expect(tuned.holdoutValAccuracy).toBeLessThanOrEqual(1);
    expect(tuned.notes.some((note) => note.includes("20% test split"))).toBe(true);

    const scored = scoreTfidfParamsOnTrainHoldout(split.train, tuned.params, CLASSIFIER_RANDOM_SEED);
    expect(scored.accuracy).toBeGreaterThanOrEqual(0);
    expect(scored.accuracy).toBeLessThanOrEqual(1);
  }, 120_000);

  it("falls back to the documented fixed preset when train-only holdout is non-discriminative", () => {
    // Same template-group train policy as the official eval, but a smaller corpus so the
    // test does not repeat three probe fits + one full-preset holdout on ~3.8k rows (~5+ min).
    const examples = generateClassifierLabeledExamples(480);
    const split = stratifiedGroupTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    const tuned = selectTfidfLogRegHyperparams(split.train, {
      seed: CLASSIFIER_RANDOM_SEED,
      candidates: [
        {
          l2: 0.5,
          epochs: 12,
          learningRate: 0.2,
          minDf: 1,
          maxFeatures: 2000,
          wordNgramMax: 2,
          charNgramMin: 3,
          charNgramMax: 4,
          titleRepeat: 2,
        },
        {
          l2: 1,
          epochs: 12,
          learningRate: 0.25,
          minDf: 1,
          maxFeatures: 2000,
          wordNgramMax: 2,
          charNgramMin: 3,
          charNgramMax: 4,
          titleRepeat: 2,
        },
      ],
    });

    expect(tuned.selectionMethod).toBe("fixed_preset");
    expect(tuned.params).toEqual(FIXED_TFIDF_LOGREG_HYPERPARAMS);
    expect(tuned.candidateHoldoutScores.length).toBeGreaterThan(0);
    expect(tuned.notes.some((n) => n.includes("FIXED_TFIDF_LOGREG_HYPERPARAMS"))).toBe(true);
  }, 120_000);
});
