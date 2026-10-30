import { afterEach, describe, expect, it } from "vitest";
import { CLASS_PROTOTYPES, ORIGINAL_JOB_DESCRIPTIONS } from "@/lib/ai/classifier-original-eval";
import {
  evaluateOriginalDescriptionsByPrototype,
  ORIGINAL_PROTOTYPE_COSINE_CUTOFF,
} from "@/lib/ai/classifier-original-prototype";
import { JOB_CORPUS_CATEGORIES, type JobCorpusCategory } from "@/lib/ai/corpus";
import { GTE_EMBEDDING_DIMENSIONS, setGteEmbedPipelineForTests } from "@/lib/ai/gte-embed";
import type { LabeledJobExample } from "@/lib/ai/job-classifier";

function unitVector(index: number): number[] {
  const values = Array.from({ length: GTE_EMBEDDING_DIMENSIONS }, () => 0);
  values[index] = 1;
  return values;
}

function vectorWithCosine(axis: number, cosine: number): number[] {
  const values = Array.from({ length: GTE_EMBEDDING_DIMENSIONS }, () => 0);
  values[axis] = cosine;
  values[GTE_EMBEDDING_DIMENSIONS - 1] = Math.sqrt(1 - cosine * cosine);
  return values;
}

function row(id: string, category: JobCorpusCategory, title: string): LabeledJobExample {
  return { id, category, title, description: "Held-out wording for the prototype test." };
}

afterEach(() => {
  setGteEmbedPipelineForTests(null);
});

describe("class prototypes", () => {
  it("has one prototype per category and does not copy held-out text", () => {
    expect(Object.keys(CLASS_PROTOTYPES)).toHaveLength(JOB_CORPUS_CATEGORIES.length);
    const heldOut = new Set<string>();
    for (const example of ORIGINAL_JOB_DESCRIPTIONS) {
      heldOut.add(example.title);
      heldOut.add(example.description);
      heldOut.add(`${example.title}. ${example.description}`);
    }
    for (const category of JOB_CORPUS_CATEGORIES) {
      const prototype = CLASS_PROTOTYPES[category];
      expect(prototype.trim().length).toBeGreaterThan(0);
      expect(heldOut.has(prototype)).toBe(false);
    }
  });
});

describe("evaluateOriginalDescriptionsByPrototype", () => {
  const prototypes = Object.fromEntries(
    JOB_CORPUS_CATEGORIES.map((category) => [category, `prototype ${category}`]),
  ) as Record<JobCorpusCategory, string>;

  function installEmbedder(vectors: Map<string, number[]>) {
    setGteEmbedPipelineForTests(async () => {
      return async (text: string) => {
        const vector = vectors.get(text);
        if (!vector) throw new Error(`No test vector for ${text}`);
        return { data: Float32Array.from(vector) };
      };
    });
  }

  it("assigns the nearest prototype and leaves a below-cutoff row unscored", async () => {
    const vectors = new Map<string, number[]>();
    JOB_CORPUS_CATEGORIES.forEach((category, index) => {
      vectors.set(prototypes[category], unitVector(index));
    });
    const engineering = row("near-engineering", "engineering", "Matches engineering");
    const data = row("below-cutoff", "data", "Matches nothing");
    const design = row("wrong-neighbor", "design", "Matches data");
    vectors.set(`${engineering.title}. ${engineering.description}`, unitVector(0));
    vectors.set(`${data.title}. ${data.description}`, unitVector(GTE_EMBEDDING_DIMENSIONS - 1));
    vectors.set(`${design.title}. ${design.description}`, unitVector(1));
    installEmbedder(vectors);

    const report = await evaluateOriginalDescriptionsByPrototype([engineering, data, design], prototypes);

    expect(report.testSize).toBe(3);
    expect(report.unscoredCount).toBe(1);
    expect(report.accuracy).toBe(1 / 3);
    expect(report.confusionMatrix.engineering.engineering).toBe(1);
    expect(report.confusionMatrix.design.data).toBe(1);
    expect(report.confusionMatrix.data.data).toBe(0);
    expect(report.perClass.engineering).toMatchObject({ precision: 1, recall: 1, support: 1 });
    expect(report.perClass.data).toMatchObject({ precision: 0, recall: 0, support: 1 });
    expect(report.perClass.design).toMatchObject({ precision: 0, recall: 0, support: 1 });
    expect(report.notes.some((note) => note.includes(String(ORIGINAL_PROTOTYPE_COSINE_CUTOFF)))).toBe(true);
  });

  it("scores a row at the cutoff and leaves a lower cosine unscored", async () => {
    const vectors = new Map<string, number[]>();
    JOB_CORPUS_CATEGORIES.forEach((category, index) => {
      vectors.set(prototypes[category], unitVector(index));
    });
    const atCutoff = row("at-cutoff", "engineering", "Exactly at cutoff");
    const belowCutoff = row("under-cutoff", "engineering", "Just under cutoff");
    vectors.set(
      `${atCutoff.title}. ${atCutoff.description}`,
      vectorWithCosine(0, ORIGINAL_PROTOTYPE_COSINE_CUTOFF),
    );
    vectors.set(
      `${belowCutoff.title}. ${belowCutoff.description}`,
      vectorWithCosine(0, ORIGINAL_PROTOTYPE_COSINE_CUTOFF - 0.01),
    );
    installEmbedder(vectors);

    const report = await evaluateOriginalDescriptionsByPrototype([atCutoff, belowCutoff], prototypes);

    expect(report.testSize).toBe(2);
    expect(report.unscoredCount).toBe(1);
    expect(report.accuracy).toBe(0.5);
    expect(report.perClass.engineering.support).toBe(2);
    expect(report.perClass.engineering.recall).toBe(0.5);
  });
});
