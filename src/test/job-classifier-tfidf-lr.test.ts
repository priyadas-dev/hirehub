import { describe, expect, it } from "vitest";
import { JOB_CORPUS_CATEGORIES } from "@/lib/ai/corpus";
import { compareClassifiersOnGroupedSplit } from "@/lib/ai/job-classifier-compare";
import {
  CLASSIFIER_RANDOM_SEED,
  assertNoTemplateGroupLeakage,
  buildClassifierFeatureText,
  corpusDocsToLabeledExamples,
  stratifiedGroupTrainTestSplit,
} from "@/lib/ai/job-classifier";
import { generateSyntheticJobCorpus } from "@/lib/ai/corpus-generate";
import {
  extractTfidfFeatureStrings,
  fitTfidfVectorizer,
  transformTfidf,
  trainTfidfLogisticRegression,
  evaluateTfidfLogRegOnSplit,
} from "@/lib/ai/job-classifier-tfidf-lr";

describe("TF-IDF vectorizer train-only fit", () => {
  it("builds vocabulary from training texts only and ignores unseen test strings in IDF", () => {
    const trainTexts = [
      buildClassifierFeatureText({
        title: "Junior Software Engineer",
        description: "Ship services with teammates.",
      }),
      buildClassifierFeatureText({
        title: "Senior Backend Engineer",
        description: "Own APIs and reviews.",
      }),
    ];
    const vectorizer = fitTfidfVectorizer(trainTexts, { minDf: 1, maxFeatures: 200 });
    expect(vectorizer.fittedOn).toBe(2);
    expect(vectorizer.vocabulary.length).toBeGreaterThan(0);
    expect(vectorizer.vocabulary).toEqual([...vectorizer.vocabulary].sort());

    const feats = extractTfidfFeatureStrings(trainTexts[0]!);
    expect(feats.some((f) => f.startsWith("w1:"))).toBe(true);
    expect(feats.some((f) => f.startsWith("c3:"))).toBe(true);

    const testOnly = transformTfidf(vectorizer, [
      buildClassifierFeatureText({
        title: "Brand New Unseen Role Title ZZZ",
        description: "Completely novel wording not in train.",
      }),
    ]);
    expect(testOnly[0]).toHaveLength(vectorizer.vocabulary.length);
    // Unseen tokens contribute zeros; row stays finite.
    expect(testOnly[0]!.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("TF-IDF logreg on grouped split", () => {
  it("fits on train only and scores the held-out grouped test set", () => {
    const examples = corpusDocsToLabeledExamples(generateSyntheticJobCorpus(600));
    const split = stratifiedGroupTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    assertNoTemplateGroupLeakage(split);

    const model = trainTfidfLogisticRegression(split.train, {
      seed: CLASSIFIER_RANDOM_SEED,
      epochs: 8,
      maxFeatures: 1500,
    });
    expect(model.kind).toBe("tfidf_logreg");
    expect(model.trainedOn).toBe(split.train.length);
    expect(model.vectorizer.fittedOn).toBe(split.train.length);
    expect(model.categories).toEqual([...JOB_CORPUS_CATEGORIES]);

    const { report } = evaluateTfidfLogRegOnSplit(split, { seed: CLASSIFIER_RANDOM_SEED });
    expect(report.model).toBe("tfidf_logreg");
    expect(report.testSize).toBe(split.test.length);
    expect(report.trainSize).toBe(split.train.length);
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
    expect(report.macroF1).toBeGreaterThanOrEqual(0);
    expect(report.macroF1).toBeLessThanOrEqual(1);
    for (const category of JOB_CORPUS_CATEGORIES) {
      expect(report.perClass[category].support).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("compareClassifiersOnGroupedSplit", () => {
  it(
    "evaluates NB and TF-IDF logreg on the identical grouped split",
    () => {
    const { split, comparison } = compareClassifiersOnGroupedSplit({
      count: 600,
      seed: CLASSIFIER_RANDOM_SEED,
      tfidfTuneCandidates: [
        {
          l2: 0.5,
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
    assertNoTemplateGroupLeakage(split);
    expect(comparison.splitMode).toBe("template_group");
    expect(comparison.trainSize).toBe(split.train.length);
    expect(comparison.testSize).toBe(split.test.length);
    expect(comparison.diagnostics.templateGroupOverlapCount).toBe(0);
    expect(comparison.naiveBayes.model).toBe("multinomial_nb");
    expect(comparison.tfidfLogReg.model).toBe("tfidf_logreg");
    expect(comparison.naiveBayes.testSize).toBe(comparison.tfidfLogReg.testSize);
    expect(comparison.naiveBayes.seed).toBe(CLASSIFIER_RANDOM_SEED);
    expect(comparison.tfidfLogReg.seed).toBe(CLASSIFIER_RANDOM_SEED);
    expect(Number.isFinite(comparison.naiveBayes.weightedF1)).toBe(true);
    expect(comparison.diagnostics.skillsLinePresentInTest).toBe(false);
    expect(comparison.track5?.syntheticBenchmark.kind).toBe("syntheticBenchmark");
    expect(comparison.track5?.syntheticBenchmark.notRealWorld).toBe(true);
    expect(comparison.track5?.independentBenchmark.status).toBe("unavailable");
    for (const example of split.test) {
      expect(example.description.toLowerCase()).not.toContain("hands-on tools frequently used");
    }
    },
    120_000,
  );
});
