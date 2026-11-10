import { describe, expect, it } from "vitest";
import { JOB_CORPUS_CATEGORIES } from "@/lib/ai/corpus";
import { generateSyntheticJobCorpus, syntheticBaseTitle } from "@/lib/ai/corpus-generate";
import { assertEnrichmentCoverage } from "@/lib/ai/job-classifier-enrichment";
import {
  CLASSIFIER_DUTY_BY_BASE_TITLE,
  CLASSIFIER_FORBIDDEN_SKILLS_LINE,
  CLASSIFIER_SECONDARY_DUTY_BY_BASE_TITLE,
  assertClassifierDatasetCoverage,
  buildClassifierOrientedDescription,
  classifierDescriptionHasForbiddenSkillsLine,
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

describe("classifier-oriented dataset (Option A)", () => {
  it("covers every generator base title with primary/secondary + enrichment maps", () => {
    const titles = new Set(
      generateSyntheticJobCorpus(240).map((doc) => syntheticBaseTitle(doc.title)),
    );
    for (const title of titles) {
      expect(CLASSIFIER_DUTY_BY_BASE_TITLE[title], `missing duty for ${title}`).toBeTruthy();
      expect(
        CLASSIFIER_SECONDARY_DUTY_BY_BASE_TITLE[title],
        `missing secondary duty for ${title}`,
      ).toBeTruthy();
    }
    assertEnrichmentCoverage(titles);
    expect(() => assertClassifierDatasetCoverage()).not.toThrow();
  });

  it("omits skills laundry list and category-slug openers across enrichment variants", () => {
    const doc = generateSyntheticJobCorpus(24).find((row) => row.category === "engineering");
    expect(doc).toBeTruthy();
    for (const variant of [
      "post5d",
      "enriched_v1",
      "enriched_v2",
      "enriched_v3",
      "v2-div-a",
      "v2-div-b",
    ] as const) {
      const description = buildClassifierOrientedDescription(doc!, { variant });
      expect(classifierDescriptionHasForbiddenSkillsLine(description)).toBe(false);
      expect(description.toLowerCase()).not.toContain(CLASSIFIER_FORBIDDEN_SKILLS_LINE.toLowerCase());
      expect(description.toLowerCase()).not.toContain("core skills for this document");
      expect(description.toLowerCase()).not.toMatch(/this is a synthetic\s+engineering\s+role/);
      expect(description.toLowerCase()).not.toContain(doc!.skills_text.toLowerCase());
      expect(description.toLowerCase()).toMatch(/pull|features|review|tests|release|code|service|api|suite|schema|handoff/);
    }

    const description = buildClassifierOrientedDescription(doc!, { variant: "enriched_v2" });
    const stripped = stripSyntheticClassifierShortcuts(description);
    const masked = maskClassifierCategoryKeywords(stripped);
    expect(masked.toLowerCase()).not.toMatch(/\bengineering\b/);
    const tokens = exampleToTokens({ title: doc!.title, description });
    expect(tokens.length).toBeGreaterThan(20);
    expect(buildClassifierFeatureText({ title: doc!.title, description }).length).toBeGreaterThan(120);
  });

  it("never reintroduces category-exclusive skills lines across a full batch", () => {
    const examples = generateClassifierLabeledExamples(500);
    expect(examples).toHaveLength(500);
    for (const example of examples) {
      expect(classifierDescriptionHasForbiddenSkillsLine(example.description)).toBe(false);
      expect(example.description.toLowerCase()).not.toContain("hands-on tools frequently used");
      expect(example.description.toLowerCase()).not.toContain("core skills for this document");
    }
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
    expect(feature).toMatch(/analyst|engineer|warehouse|dashboard|pipeline|metric|schema/i);
    expect(data!.templateGroupId?.startsWith("data::")).toBe(true);
  });

  it("keeps design enrichment free of marketing campaign/acquisition/conversion tokens", () => {
    const duty = CLASSIFIER_DUTY_BY_BASE_TITLE["Brand Designer"]!.toLowerCase();
    expect(duty).not.toContain("campaign");
    expect(duty).not.toContain("growth");
    expect(duty).toMatch(/visual|design|brand/);

    const designTitles = [
      "Senior Product Designer",
      "Mid-level UI Designer",
      "Lead UX Researcher",
      "Senior Brand Designer",
      "Staff Design Systems Designer",
    ];
    for (const title of designTitles) {
      for (const variant of [
        "enriched_v1",
        "enriched_v2",
        "enriched_v3",
        "v2-div-a",
        "v2-div-b",
      ] as const) {
        const enriched = buildClassifierOrientedDescription(
          { title, location: "Dhaka", corpus_key: `p3-${title}-${variant}` },
          { variant },
        ).toLowerCase();
        expect(enriched, `${title}/${variant}`).toMatch(/visual|typography|layout|design|usability|interface|prototype|component|contrast|token/);
        expect(enriched, `${title}/${variant}`).not.toContain("campaign");
        expect(enriched, `${title}/${variant}`).not.toContain("acquisition");
        expect(enriched, `${title}/${variant}`).not.toContain("conversion");
        expect(enriched, `${title}/${variant}`).not.toMatch(/\bseo\b/);
      }
    }
  });

  it("supports leakage-resistant grouped splits with zero group overlap", () => {
    const examples = corpusDocsToClassifierExamples(generateSyntheticJobCorpus(600));
    const split = stratifiedGroupTrainTestSplit(examples, { seed: CLASSIFIER_RANDOM_SEED });
    assertNoTemplateGroupLeakage(split);
    expect(split.mode).toBe("template_group");
    expect(split.train.length).toBeGreaterThan(split.test.length);
    for (const example of [...split.train, ...split.test]) {
      expect(classifierDescriptionHasForbiddenSkillsLine(example.description)).toBe(false);
    }
  });
});
