import { describe, expect, it } from "vitest";
import { ORIGINAL_JOB_DESCRIPTIONS } from "@/lib/ai/classifier-original-eval";
import { JOB_CORPUS_CATEGORIES } from "@/lib/ai/corpus";
import {
  generateSyntheticJobCorpus,
  syntheticTemplateGroupId,
} from "@/lib/ai/corpus-generate";
import {
  assertNoSplitLeakage,
  assertNoTemplateGroupLeakage,
  CLASSIFIER_RANDOM_SEED,
  CLASSIFIER_TARGET_ACCURACY,
  CLASSIFIER_TRACK5_TARGET_MACRO_F1,
  CLASSIFIER_TRAIN_FRACTION,
  corpusDocsToLabeledExamples,
  countTemplateGroupOverlap,
  evaluateClassifier,
  exampleToTokens,
  maskClassifierCategoryKeywords,
  measureSameClassNearDuplicateRate,
  predictJobCategory,
  runJobClassifierPipeline,
  scoreHeldOutWithTokenizer,
  stratifiedGroupTrainTestSplit,
  stratifiedTrainTestSplit,
  stripSyntheticClassifierShortcuts,
  SYNTHETIC_NEAR_DUPLICATE_JACCARD,
  tokenJaccard,
  trainMultinomialNaiveBayes,
  type LabeledJobExample,
} from "@/lib/ai/job-classifier";

describe("category keyword masking", () => {
  it("masks explicit category slugs but keeps occupational stems and gold labels", () => {
    const labeled: LabeledJobExample = {
      id: "x",
      title: "Senior Software Engineer",
      description: "Build services with teammates.",
      category: "engineering",
    };
    const before = labeled.category;
    // Slug "engineering" is masked when present; occupational "engineer" stays.
    expect(maskClassifierCategoryKeywords("synthetic engineering role")).not.toMatch(/\bengineering\b/i);
    expect(maskClassifierCategoryKeywords(labeled.title)).toMatch(/engineer/i);
    expect(maskClassifierCategoryKeywords("Junior Data Analyst")).not.toMatch(/\bdata\b/i);
    expect(maskClassifierCategoryKeywords("Product Designer")).not.toMatch(/\bproduct\b/i);
    // Titles are masked the same way as descriptions — category slugs must not leak.
    expect(exampleToTokens({ title: "Junior Data Analyst", description: "" })).not.toContain("data");
    expect(exampleToTokens({ title: "Junior Data Analyst", description: "" })).toContain("analyst");
    expect(exampleToTokens({ title: "Senior Product Manager", description: "" })).not.toContain("product");
    expect(exampleToTokens({ title: "Senior Product Manager", description: "" })).toContain("manager");
    expect(maskClassifierCategoryKeywords("Product Designer")).toMatch(/designer/i);
    expect(maskClassifierCategoryKeywords("Digital Marketing Specialist")).not.toMatch(/\bmarketing\b/i);
    expect(maskClassifierCategoryKeywords("HR Generalist")).not.toMatch(/\bhr\b/i);
    expect(maskClassifierCategoryKeywords("Operations Coordinator")).not.toMatch(/\boperations\b/i);
    expect(labeled.category).toBe(before);

    const tokens = exampleToTokens({
      title: "Senior Support Team Lead",
      description:
        'This is a synthetic customer support role titled "Senior Support Team Lead" based in Dhaka. Core skills for this document: Zendesk troubleshooting. A supporting note stays.',
    });

    expect(tokens).not.toContain("synthetic");
    expect(tokens).not.toContain("zendesk");
    expect(tokens).toContain("support");
    expect(tokens).toContain("team");
    expect(tokens).toContain("lead");
    expect(tokens).toContain("supporting");
  });

  it("strips the full skill list even when skills contain internal periods like Node.js", () => {
    const withNodeJs =
      'This is a synthetic engineering role titled "Junior QA Automation Engineer" based in Dhaka. ' +
      "You will ship iterative improvements every sprint while working with modern tools. " +
      "Core skills for this document: TypeScript, React, Node.js, PostgreSQL, Testing. " +
      "Day-to-day work mixes independent ownership with team reviews, written updates, and stakeholder demos. " +
      "Variant seed 1 exists only to diversify the HireHub RAG corpus for evaluation — it is not a real opening.";
    const stripped = stripSyntheticClassifierShortcuts(withNodeJs);
    expect(stripped).not.toMatch(/Core skills/i);
    expect(stripped).not.toMatch(/TypeScript/i);
    expect(stripped).not.toMatch(/Node\.js/i);
    expect(stripped).not.toMatch(/\bjs\b/i);
    expect(stripped).not.toMatch(/PostgreSQL/i);
    expect(stripped).not.toMatch(/This is a synthetic/i);
    expect(stripped).not.toMatch(/Variant seed/i);

    const tokens = exampleToTokens({
      title: "Junior QA Automation Engineer",
      description: withNodeJs,
    });
    expect(tokens).toContain("engineer");
    expect(tokens).toContain("qa");
    expect(tokens).toContain("automation");
    for (const skill of ["typescript", "react", "node", "js", "postgresql", "testing", "engineering"]) {
      expect(tokens).not.toContain(skill);
    }
  });

  it("strips synthetic skill-list shortcuts from generator docs without changing gold labels", () => {
    const doc = generateSyntheticJobCorpus(12).find((row) => row.category === "engineering");
    expect(doc).toBeTruthy();
    const gold = doc!.category;
    const stripped = stripSyntheticClassifierShortcuts(doc!.description);
    expect(stripped).not.toMatch(/Core skills/i);
    expect(stripped).not.toMatch(/This is a synthetic/i);
    expect(stripped).not.toMatch(/Variant seed/i);
    const tokens = exampleToTokens({ title: doc!.title, description: doc!.description });
    for (const leaked of ["engineering", "typescript", "postgresql", "synthetic"]) {
      expect(tokens).not.toContain(leaked);
    }
    // Occupational stem kept; category slug removed.
    expect(tokens).toContain("engineer");
    expect(doc!.category).toBe(gold);
  });
});

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

describe("stratifiedGroupTrainTestSplit", () => {
  it("keeps each template group entirely in train or entirely in test", () => {
    const examples = corpusDocsToLabeledExamples(generateSyntheticJobCorpus(1200));
    expect(examples.every((e) => Boolean(e.templateGroupId))).toBe(true);
    expect(examples[0]?.templateGroupId).toBe(
      syntheticTemplateGroupId(examples[0]!.category, examples[0]!.title),
    );

    const a = stratifiedGroupTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    const b = stratifiedGroupTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    expect(a.mode).toBe("template_group");
    expect(a.train.map((e) => e.id)).toEqual(b.train.map((e) => e.id));
    assertNoSplitLeakage(a);
    assertNoTemplateGroupLeakage(a);
    expect(countTemplateGroupOverlap(a)).toBe(0);

    for (const category of JOB_CORPUS_CATEGORIES) {
      expect(a.train.some((e) => e.category === category)).toBe(true);
      expect(a.test.some((e) => e.category === category)).toBe(true);
    }
    // Each class must expose multiple base-title groups so the group split can hold some out.
    const groupsByClass = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((c) => [c, new Set<string>()]));
    for (const example of examples) {
      groupsByClass[example.category]!.add(example.templateGroupId!);
    }
    for (const category of JOB_CORPUS_CATEGORIES) {
      expect(groupsByClass[category]!.size).toBeGreaterThanOrEqual(2);
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

describe("original job descriptions", () => {
  const forbiddenTitles = [
    "Software Engineer",
    "Mobile Engineer",
    "Data Engineer",
    "BI Developer",
    "Data Analyst",
    "Machine Learning Engineer",
    "Analytics Engineer",
    "UX Researcher",
    "Design Systems Designer",
    "UI Designer",
    "Brand Designer",
    "Product Designer",
    "Product Owner",
    "Brand Manager",
    "Content Marketer",
    "Growth Marketer",
    "Digital Marketing Specialist",
    "SEO Specialist",
    "Sales Development Representative",
    "Office Manager",
    "Payroll Specialist",
    "Clinical Coordinator",
    "Instructional Designer",
    "Support Team Lead",
    "L&D Coordinator",
  ];
  const forbiddenTokens = [
    "roadmapping",
    "google",
    "ads",
    "zendesk",
    "gaap",
    "prototyping",
    "wireframing",
    "typescript",
    "postgresql",
    "pandas",
    "bigquery",
    "hris",
    "hipaa",
    "payroll",
    "clinical",
    "instructional",
  ];

  it("has one independently written description for every category", () => {
    expect(ORIGINAL_JOB_DESCRIPTIONS).toHaveLength(JOB_CORPUS_CATEGORIES.length);
    expect(new Set(ORIGINAL_JOB_DESCRIPTIONS.map((row) => row.id)).size).toBe(ORIGINAL_JOB_DESCRIPTIONS.length);
    expect(new Set(ORIGINAL_JOB_DESCRIPTIONS.map((row) => row.category))).toEqual(new Set(JOB_CORPUS_CATEGORIES));

    for (const row of ORIGINAL_JOB_DESCRIPTIONS) {
      const title = row.title.toLowerCase();
      for (const forbidden of forbiddenTitles) {
        expect(title).not.toContain(forbidden.toLowerCase());
      }
      const tokens = exampleToTokens(row);
      for (const token of forbiddenTokens) {
        expect(tokens).not.toContain(token);
      }
    }
  });

  it("does not reuse a base title from the synthetic generator", () => {
    const bases = new Set(
      generateSyntheticJobCorpus(5000).map((doc) =>
        doc.title.replace(/^(Junior|Mid-level|Senior|Lead|Staff)\s+/, "").toLowerCase(),
      ),
    );
    for (const row of ORIGINAL_JOB_DESCRIPTIONS) {
      expect(bases.has(row.title.toLowerCase())).toBe(false);
    }
  });
});

describe("synthetic diagnostics helpers", () => {
  it("computes Jaccard and same-class near-duplicate rate on a tiny split", () => {
    expect(tokenJaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 5);
    expect(tokenJaccard([], [])).toBe(1);

    const split = {
      train: [
        {
          id: "tr1",
          title: "Alpha",
          description: "shared tokens one two",
          category: "engineering" as const,
        },
      ],
      test: [
        {
          id: "te1",
          title: "Beta",
          description: "shared tokens one two three",
          category: "engineering" as const,
        },
        {
          id: "te2",
          title: "Gamma",
          description: "completely different wording here",
          category: "finance" as const,
        },
      ],
      seed: 1,
      trainFraction: 0.5,
    };
    const near = measureSameClassNearDuplicateRate(split, {
      threshold: 0.5,
      tokenize: (example) => example.description.split(/\s+/),
    });
    expect(near.testSize).toBe(2);
    expect(near.count).toBe(1);
    expect(near.rate).toBeCloseTo(0.5, 5);
    expect(SYNTHETIC_NEAR_DUPLICATE_JACCARD).toBe(0.9);
  });

  it("scores title-only ablation without changing the primary feature path", () => {
    const examples = corpusDocsToLabeledExamples(generateSyntheticJobCorpus(240));
    const split = stratifiedTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    const titleOnly = scoreHeldOutWithTokenizer(split, (example) =>
      exampleToTokens({ title: example.title, description: "" }),
    );
    expect(titleOnly).toBeGreaterThanOrEqual(0);
    expect(titleOnly).toBeLessThanOrEqual(1);
  });
});

describe("runJobClassifierPipeline", () => {
  it("uses template-group splits, reports diagnostics, and does not alter gold labels", () => {
    const { split, model, report } = runJobClassifierPipeline({
      count: 1200,
      seed: CLASSIFIER_RANDOM_SEED,
    });
    assertNoSplitLeakage(split);
    assertNoTemplateGroupLeakage(split);
    expect(split.mode).toBe("template_group");
    expect(report.seed).toBe(CLASSIFIER_RANDOM_SEED);
    expect(report.trainFraction).toBe(CLASSIFIER_TRAIN_FRACTION);
    expect(report.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.accuracy).toBeLessThanOrEqual(1);
    expect(report.meetsTarget).toBe(report.accuracy >= CLASSIFIER_TARGET_ACCURACY);
    expect(report.targetAccuracy).toBe(CLASSIFIER_TARGET_ACCURACY);
    expect(report.meetsTrack5MacroF1).toBe(report.macroF1 >= CLASSIFIER_TRACK5_TARGET_MACRO_F1);
    expect(report.targetMacroF1).toBe(CLASSIFIER_TRACK5_TARGET_MACRO_F1);
    expect(report.testSize).toBe(split.test.length);
    expect(report.notes.some((n) => /live job recommendations/i.test(n))).toBe(true);
    expect(report.notes.some((n) => /option a|skills laundry|skill-list/i.test(n))).toBe(true);
    expect(report.notes.some((n) => /gte-small prototype/i.test(n))).toBe(true);
    expect(report.originalDescriptions).toBeUndefined();
    expect(Number.isFinite(report.weightedF1)).toBe(true);
    expect(report.weightedF1).toBeGreaterThanOrEqual(0);
    expect(report.weightedF1).toBeLessThanOrEqual(1);

    expect(report.syntheticDiagnostics).toBeTruthy();
    const diag = report.syntheticDiagnostics!;
    expect(diag.splitMode).toBe("template_group");
    expect(diag.templateGroupOverlapCount).toBe(0);
    expect(diag.fullMaskedAccuracy).toBe(report.accuracy);
    expect(diag.nearDuplicateThreshold).toBe(SYNTHETIC_NEAR_DUPLICATE_JACCARD);
    expect(diag.nearDuplicateRate).toBeCloseTo(diag.nearDuplicateCount / report.testSize, 5);
    expect(diag.skillsLinePresentInTest).toBe(false);
    expect(Number.isFinite(diag.skillsOnlyAccuracy)).toBe(true);
    expect(Number.isFinite(diag.dutyOnlyAccuracy)).toBe(true);
    expect(Number.isFinite(diag.nearDuplicateRateAt05)).toBe(true);
    for (const example of split.test) {
      expect(example.description.toLowerCase()).not.toContain("hands-on tools frequently used");
    }

    for (const category of JOB_CORPUS_CATEGORIES) {
      const metrics = report.perClass[category];
      expect(metrics).toBeTruthy();
      expect(metrics.support).toBeGreaterThan(0);
      expect(Number.isFinite(metrics.precision)).toBe(true);
      expect(Number.isFinite(metrics.recall)).toBe(true);
      expect(Number.isFinite(metrics.f1)).toBe(true);
      expect(metrics.precision).toBeGreaterThanOrEqual(0);
      expect(metrics.precision).toBeLessThanOrEqual(1);
      expect(metrics.recall).toBeGreaterThanOrEqual(0);
      expect(metrics.recall).toBeLessThanOrEqual(1);
      expect(metrics.f1).toBeGreaterThanOrEqual(0);
      expect(metrics.f1).toBeLessThanOrEqual(1);
    }

    expect(JOB_CORPUS_CATEGORIES).toContain(predictJobCategory(model, ORIGINAL_JOB_DESCRIPTIONS[0]!));
  });
});
