/**
 * Assessment 3 Track 5 — independent / OOD labeled JD dataset helpers.
 *
 * Protocol: train on synthetic only; score OOD once; never tune on OOD.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { JOB_CORPUS_CATEGORIES, type JobCorpusCategory } from "@/lib/ai/corpus";
import {
  CLASSIFIER_TRACK5_TARGET_MACRO_F1,
  emptyConfusionMatrix,
  evaluatePredictions,
  predictJobCategory,
  type ClassifierEvalReport,
  type LabeledJobExample,
  type TrainedJobClassifier,
  type Track5IndependentBenchmark,
} from "@/lib/ai/job-classifier";

export const TRACK5_OOD_DATASET_ID = "track5_ood_v1" as const;

export type Track5OodRow = LabeledJobExample & {
  location?: string;
  provenance?: {
    dataset?: string;
    split?: string;
    license?: string;
    source_idx?: number;
    source_job_type?: string | null;
    company?: string | null;
    label_reason?: string;
    label_protocol?: string;
  };
};

export type Track5OodLoadResult = {
  datasetId: typeof TRACK5_OOD_DATASET_ID;
  rows: Track5OodRow[];
  perClass: Record<JobCorpusCategory, number>;
  path: string;
};

function defaultOodJsonlPath(): string {
  return path.join(process.cwd(), "datasets/track5_ood_v1/track5_ood_v1.jsonl");
}

export function loadTrack5OodV1(jsonlPath: string = defaultOodJsonlPath()): Track5OodLoadResult {
  const text = readFileSync(jsonlPath, "utf8");
  const rows: Track5OodRow[] = [];
  const perClass = Object.fromEntries(JOB_CORPUS_CATEGORIES.map((c) => [c, 0])) as Record<
    JobCorpusCategory,
    number
  >;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = JSON.parse(line) as Track5OodRow;
    if (!raw.id || !raw.title || !raw.description || !raw.category) {
      throw new Error(`Invalid OOD row in ${jsonlPath}`);
    }
    if (!(JOB_CORPUS_CATEGORIES as readonly string[]).includes(raw.category)) {
      throw new Error(`Unknown OOD category ${raw.category} for ${raw.id}`);
    }
    rows.push({
      id: raw.id,
      title: raw.title,
      description: raw.description,
      category: raw.category,
      location: raw.location,
      provenance: raw.provenance,
    });
    perClass[raw.category] += 1;
  }

  if (rows.length === 0) {
    throw new Error(`OOD dataset empty: ${jsonlPath}`);
  }

  return {
    datasetId: TRACK5_OOD_DATASET_ID,
    rows,
    perClass,
    path: jsonlPath,
  };
}

export function scoreTrack5Ood(
  model: TrainedJobClassifier,
  rows: readonly LabeledJobExample[],
  meta: { trainSize: number; seed: number; trainFraction: number },
): ClassifierEvalReport {
  const predictions = rows.map((row) => predictJobCategory(model, row));
  return evaluatePredictions(
    [...rows],
    predictions,
    { ...meta, model: "multinomial_nb" },
    {
      notes: [
        "independentBenchmark / OOD only — not blended into syntheticBenchmark.",
        "Model trained on synthetic train split only; OOD was not used for tuning.",
        `Dataset=${TRACK5_OOD_DATASET_ID}; n=${rows.length}.`,
      ],
    },
  );
}

export function buildReadyIndependentBenchmark(options: {
  report: ClassifierEvalReport;
  n: number;
  perClassSupport: Record<JobCorpusCategory, number>;
}): Track5IndependentBenchmark {
  const lowSupport = JOB_CORPUS_CATEGORIES.filter((c) => (options.perClassSupport[c] ?? 0) < 10);
  const notes = [
    "Licensed public original JD split (Apache-2.0), mapped to HireHub 12 classes.",
    "Not HireHub live vacancies; HireHub jobs export was too small (n≈15) to serve as OOD alone.",
    "Single-annotator / rule-assisted labels — not multi-rater gold.",
    "Never tune on this set; never blend into syntheticBenchmark headline.",
    `meetsTrack5MacroF1 on OOD is informational only (gate remains synthetic Macro F1 ≥ ${CLASSIFIER_TRACK5_TARGET_MACRO_F1}).`,
  ];
  if (lowSupport.length > 0) {
    notes.push(
      `Low-support classes (<10): ${lowSupport.join(", ")} — treat per-class F1 cautiously.`,
    );
  }
  if (options.n < 200) {
    notes.push(`n=${options.n} is below preferred ≥200–500; report with disclaimer.`);
  }

  return {
    kind: "independentBenchmark",
    status: "ready",
    datasetId: TRACK5_OOD_DATASET_ID,
    n: options.n,
    provenance:
      "its-zion-18/Jobs-tabular-dataset@original (Apache-2.0) → datasets/track5_ood_v1",
    license: "Apache-2.0",
    notes,
    metrics: {
      accuracy: options.report.accuracy,
      macroF1: options.report.macroF1,
      weightedF1: options.report.weightedF1,
      meetsTrack5MacroF1: options.report.meetsTrack5MacroF1,
      perClass: options.report.perClass,
      confusionMatrix: options.report.confusionMatrix ?? emptyConfusionMatrix(),
    },
  };
}
