import { CLASS_PROTOTYPES, ORIGINAL_JOB_DESCRIPTIONS } from "@/lib/ai/classifier-original-eval";
import { JOB_CORPUS_CATEGORIES, type JobCorpusCategory } from "@/lib/ai/corpus";
import { embedTextsGte } from "@/lib/ai/gte-embed";
import {
  emptyConfusionMatrix,
  type ClassMetrics,
  type ConfusionMatrix,
  type LabeledJobExample,
  type OriginalDescriptionEval,
} from "@/lib/ai/job-classifier";

/**
 * Nearest class prototype must reach this cosine similarity.
 * gte-small vectors are L2-normalized, so cosine is their dot product.
 * A score below this cutoff is unscored rather than forced onto a class.
 */
export const ORIGINAL_PROTOTYPE_COSINE_CUTOFF = 0.5;

const ORIGINAL_PROTOTYPE_NOTES = [
  "Original descriptions are scored by nearest gte-small class prototype. predictJobCategory is not used.",
  `The nearest prototype must have cosine similarity of at least ${ORIGINAL_PROTOTYPE_COSINE_CUTOFF}. Below that cutoff the row is unscored.`,
  "Unscored rows stay in the accuracy denominator, count as incorrect, and are false negatives for their gold class. They are not predictions.",
  "Prototype embeddings are computed in memory and are not written to embedding_gte.",
] as const;

function dot(left: readonly number[], right: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < left.length; i++) sum += left[i]! * right[i]!;
  return sum;
}

function prototypeText(category: JobCorpusCategory, prototypes: Record<JobCorpusCategory, string>): string {
  const text = prototypes[category]?.trim();
  if (!text) throw new Error(`Missing class prototype for ${category}.`);
  return text;
}

/**
 * Score held-out descriptions against one fixed prototype per category.
 * Uses the local gte-small embedder (or its test seam). Does not call a paid API.
 */
export async function evaluateOriginalDescriptionsByPrototype(
  rows: readonly LabeledJobExample[] = ORIGINAL_JOB_DESCRIPTIONS,
  prototypes: Record<JobCorpusCategory, string> = CLASS_PROTOTYPES,
): Promise<OriginalDescriptionEval> {
  if (rows.length === 0) throw new Error("Cannot evaluate on an empty original-description set.");

  const prototypeTexts = JOB_CORPUS_CATEGORIES.map((category) => prototypeText(category, prototypes));
  const rowTexts = rows.map((row) => `${row.title}. ${row.description}`.trim());
  const vectors = await embedTextsGte([...prototypeTexts, ...rowTexts]);
  const prototypeVectors = vectors.slice(0, prototypeTexts.length);
  const rowVectors = vectors.slice(prototypeTexts.length);

  const confusionMatrix: ConfusionMatrix = emptyConfusionMatrix();
  const support = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((category) => [category, 0])) as Record<
    JobCorpusCategory,
    number
  >;
  let correct = 0;
  let unscoredCount = 0;

  rows.forEach((row, rowIndex) => {
    support[row.category] += 1;
    const vector = rowVectors[rowIndex];
    if (!vector) throw new Error("Missing embedding for an original description.");

    let bestCategory: JobCorpusCategory = JOB_CORPUS_CATEGORIES[0]!;
    let bestScore = -Infinity;
    prototypeVectors.forEach((prototype, prototypeIndex) => {
      if (!prototype) return;
      const score = dot(vector, prototype);
      if (score > bestScore) {
        bestScore = score;
        bestCategory = JOB_CORPUS_CATEGORIES[prototypeIndex]!;
      }
    });

    if (!(bestScore >= ORIGINAL_PROTOTYPE_COSINE_CUTOFF)) {
      unscoredCount += 1;
      return;
    }

    confusionMatrix[row.category][bestCategory] += 1;
    if (bestCategory === row.category) correct += 1;
  });

  const perClass = {} as Record<JobCorpusCategory, ClassMetrics>;
  let macroF1Sum = 0;
  for (const category of JOB_CORPUS_CATEGORIES) {
    let tp = 0;
    let fp = 0;
    for (const actual of JOB_CORPUS_CATEGORIES) {
      for (const predicted of JOB_CORPUS_CATEGORIES) {
        const n = confusionMatrix[actual][predicted];
        if (actual === category && predicted === category) tp += n;
        if (actual !== category && predicted === category) fp += n;
      }
    }
    const fn = support[category] - tp;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClass[category] = { precision, recall, f1, support: support[category] };
    macroF1Sum += f1;
  }

  return {
    accuracy: correct / rows.length,
    testSize: rows.length,
    unscoredCount,
    macroF1: macroF1Sum / JOB_CORPUS_CATEGORIES.length,
    confusionMatrix,
    perClass,
    notes: [...ORIGINAL_PROTOTYPE_NOTES],
  };
}
