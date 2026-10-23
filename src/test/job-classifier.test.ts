import { describe, expect, it } from "vitest";
import { JOB_CORPUS_CATEGORIES } from "@/lib/ai/corpus";
import { generateSyntheticJobCorpus } from "@/lib/ai/corpus-generate";
import {
  assertNoSplitLeakage,
  CLASSIFIER_RANDOM_SEED,
  CLASSIFIER_TARGET_ACCURACY,
  CLASSIFIER_TRAIN_FRACTION,
  corpusDocsToLabeledExamples,
  evaluateClassifier,
  predictJobCategory,
  runJobClassifierPipeline,
  stratifiedTrainTestSplit,
  trainMultinomialNaiveBayes,
  type LabeledJobExample,
} from "@/lib/ai/job-classifier";

describe("stratifiedTrainTestSplit", () => {
  it("uses a fixed seed and keeps train/test ids disjoint (no leakage)", () => {
    const examples = corpusDocsToLabeledExamples(generateSyntheticJobCorpus(600));
    const a = stratifiedTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    const b = stratifiedTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });

    expect(a.train.map((e) => e.id)).toEqual(b.train.map((e) => e.id));
    expect(a.test.map((e) => e.id)).toEqual(b.test.map((e) => e.id));
    assertNoSplitLeakage(a);

    const total = a.train.length + a.test.length;
    expect(total).toBe(examples.length);
    expect(a.train.length / total).toBeGreaterThan(0.75);
    expect(a.train.length / total).toBeLessThan(0.85);
    expect(a.trainFraction).toBe(CLASSIFIER_TRAIN_FRACTION);
  });

  it("preserves every class in both train and test when feasible", () => {
    const examples = corpusDocsToLabeledExamples(generateSyntheticJobCorpus(1200));
    const split = stratifiedTrainTestSplit(examples, { seed: 7 });
    for (const category of JOB_CORPUS_CATEGORIES) {
      expect(split.train.some((e) => e.category === category)).toBe(true);
      expect(split.test.some((e) => e.category === category)).toBe(true);
    }
  });
});

describe("multinomial NB predictions", () => {
  it("returns a known category and prefers matching title language", () => {
    const train: LabeledJobExample[] = [
      {
        id: "t1",
        title: "Senior Software Engineer",
        description: "Build TypeScript services and React apps with CI pipelines.",
        category: "engineering",
      },
      {
        id: "t2",
        title: "Backend Engineer",
        description: "Node.js APIs PostgreSQL testing and DevOps collaboration.",
        category: "engineering",
      },
      {
        id: "t3",
        title: "Financial Analyst",
        description: "Budgeting forecasting Excel financial modeling and GAAP basics.",
        category: "finance",
      },
      {
        id: "t4",
        title: "Accountant",
        description: "Payroll reporting budgeting and forecasting for finance teams.",
        category: "finance",
      },
    ];
    const model = trainMultinomialNaiveBayes(train, { seed: 1 });
    expect(JOB_CORPUS_CATEGORIES).toContain(
      predictJobCategory(model, {
        title: "Mid-level Software Engineer",
        description: "TypeScript React Node.js APIs and testing.",
      }),
    );
    expect(
      predictJobCategory(model, {
        title: "Junior Financial Analyst",
        description: "Excel budgeting forecasting financial modeling.",
      }),
    ).toBe("finance");
  });
});

describe("evaluateClassifier output", () => {
  it("computes held-out metrics only on the provided test set", () => {
    const train: LabeledJobExample[] = [
      { id: "a", title: "UI Designer", description: "Figma prototyping wireframing", category: "design" },
      { id: "b", title: "UX Researcher", description: "User research accessibility", category: "design" },
      { id: "c", title: "Sales Manager", description: "CRM negotiation pipeline", category: "sales" },
      { id: "d", title: "Account Executive", description: "Outbound prospecting CRM", category: "sales" },
    ];
    const test: LabeledJobExample[] = [
      { id: "e", title: "Brand Designer", description: "Figma brand systems wireframing", category: "design" },
      { id: "f", title: "Sales Development Representative", description: "CRM outbound prospecting", category: "sales" },
    ];
    const model = trainMultinomialNaiveBayes(train, { seed: 2 });
    const report = evaluateClassifier(model, test, {
      trainSize: train.length,
      seed: 2,
      trainFraction: 0.8,
    });

    expect(report.testSize).toBe(2);
    expect(report.trainSize).toBe(4);
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
    expect(report.confusionMatrix.design).toBeTruthy();
    expect(report.perClass.design.support + report.perClass.sales.support).toBe(2);
    expect(report.notes.some((n) => /held-out/i.test(n))).toBe(true);
  });
});

describe("runJobClassifierPipeline", () => {
  it("meets the 70% held-out accuracy target on the synthetic corpus", () => {
    const { split, report } = runJobClassifierPipeline({
      count: 1200,
      seed: CLASSIFIER_RANDOM_SEED,
    });
    assertNoSplitLeakage(split);
    expect(report.accuracy).toBeGreaterThanOrEqual(CLASSIFIER_TARGET_ACCURACY);
    expect(report.meetsTarget).toBe(true);
    expect(report.testSize).toBe(split.test.length);
    // Never treat corpus classifier output as a live recommendation source.
    expect(report.notes.some((n) => /live job recommendations/i.test(n))).toBe(true);
  });
});
