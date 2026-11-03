import { describe, expect, it } from "vitest";
import { JOB_CORPUS_CATEGORIES } from "@/lib/ai/corpus";
import { generateSyntheticJobCorpus, syntheticBaseTitle } from "@/lib/ai/corpus-generate";
import {
  CLASSIFIER_DUTY_BY_BASE_TITLE,
  buildClassifierOrientedDescription,
  corpusDocsToClassifierExamples,
  generateClassifierLabeledExamples,
} from "@/lib/ai/job-classifier-dataset";
import {
  CLASSIFIER_RANDOM_SEED,
  assertNoTemplateGroupLeakage,
  buildClassifierFeatureText,
  exampleToTokens,
  maskClassifierCategoryKeywords,
  stratifiedGroupTrainTestSplit,
  stripSyntheticClassifierShortcuts,
} from "@/lib/ai/job-classifier";

describe("classifier-oriented dataset", () => {
  it("covers every generator base title with a duty sentence", () => {
    const titles = new Set(
      generateSyntheticJobCorpus(240).map((doc) => syntheticBaseTitle(doc.title)),
    );
    for (const title of titles) {
      expect(CLASSIFIER_DUTY_BY_BASE_TITLE[title], `missing duty for ${title}`).toBeTruthy();
    }
  });

  it("keeps occupational tokens after shortcut strip + category-slug mask", () => {
    const doc = generateSyntheticJobCorpus(24).find((row) => row.category === "engineering");
    expect(doc).toBeTruthy();
    const description = buildClassifierOrientedDescription(doc!);
    expect(description.toLowerCase()).not.toContain("core skills for this document");
    expect(description.toLowerCase()).not.toMatch(/this is a synthetic\s+engineering\s+role/);
    expect(description.toLowerCase()).not.toContain("common methods for this role include");

    const stripped = stripSyntheticClassifierShortcuts(description);
    const masked = maskClassifierCategoryKeywords(stripped);
    expect(masked.toLowerCase()).toMatch(/typescript|react|postgresql/);
    expect(masked.toLowerCase()).not.toMatch(/\bengineering\b/);

    const tokens = exampleToTokens({ title: doc!.title, description });
    expect(tokens.length).toBeGreaterThan(15);
    expect(buildClassifierFeatureText({ title: doc!.title, description }).length).toBeGreaterThan(80);
  });

  it("preserves gold labels and template groups; category slugs are masked in titles too", () => {
    const examples = generateClassifierLabeledExamples(120);
    expect(examples).toHaveLength(120);
    for (const category of JOB_CORPUS_CATEGORIES) {
      expect(examples.some((e) => e.category === category)).toBe(true);
    }
    const data = examples.find((e) => e.category === "data");
    expect(data).toBeTruthy();
    const feature = buildClassifierFeatureText(data!).toLowerCase();
    expect(feature).not.toMatch(/\bdata\b/);
    expect(feature).toMatch(/analyst|engineer|warehouse|dashboard|pipeline|sql|python/i);
    expect(data!.templateGroupId?.startsWith("data::")).toBe(true);
  });

  it("supports leakage-resistant grouped splits with zero group overlap", () => {
    const examples = corpusDocsToClassifierExamples(generateSyntheticJobCorpus(600));
    const split = stratifiedGroupTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    assertNoTemplateGroupLeakage(split);
    expect(split.mode).toBe("template_group");
    expect(split.train.length).toBeGreaterThan(split.test.length);
  });
});
