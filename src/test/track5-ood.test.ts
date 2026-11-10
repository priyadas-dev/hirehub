import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOB_CORPUS_CATEGORIES } from "@/lib/ai/corpus";
import { syntheticBaseTitle } from "@/lib/ai/corpus-generate";
import { CLASSIFIER_DUTY_BY_BASE_TITLE } from "@/lib/ai/job-classifier-dataset";
import {
  buildReadyIndependentBenchmark,
  loadTrack5OodV1,
  scoreTrack5Ood,
  TRACK5_OOD_DATASET_ID,
} from "@/lib/ai/track5-ood";
import { runJobClassifierPipeline } from "@/lib/ai/job-classifier";

describe("track5_ood_v1", () => {
  it("loads ≥200 labeled rows covering all 12 classes with unique ids", () => {
    const ood = loadTrack5OodV1();
    expect(ood.datasetId).toBe(TRACK5_OOD_DATASET_ID);
    expect(ood.rows.length).toBeGreaterThanOrEqual(200);
    expect(new Set(ood.rows.map((r) => r.id)).size).toBe(ood.rows.length);

    for (const category of JOB_CORPUS_CATEGORIES) {
      expect(ood.perClass[category]).toBeGreaterThan(0);
    }

    for (const row of ood.rows) {
      expect(row.title.trim().length).toBeGreaterThan(2);
      expect(row.description.trim().length).toBeGreaterThan(40);
      expect(JOB_CORPUS_CATEGORIES).toContain(row.category);
      expect(row.provenance?.license).toBe("Apache-2.0");
      expect(row.provenance?.split).toBe("original");
    }
  });

  it("is disjoint from synthetic classifier base-title duty bank", () => {
    const ood = loadTrack5OodV1();
    const syntheticBases = new Set(
      Object.keys(CLASSIFIER_DUTY_BY_BASE_TITLE).map((t) => syntheticBaseTitle(t).toLowerCase()),
    );
    for (const row of ood.rows) {
      expect(syntheticBases.has(syntheticBaseTitle(row.title).toLowerCase())).toBe(false);
    }
  });

  it("manifest documents hirehub insufficiency and no OOD tuning", () => {
    const manifestPath = path.join(process.cwd(), "datasets/track5_ood_v1/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      n: number;
      hireHubExportAttempt: { usableLabeledPreferred: boolean };
      protocol: { tuneOnOod: boolean; reportAs: string };
      source: { license: string; split: string };
    };
    expect(manifest.n).toBeGreaterThanOrEqual(200);
    expect(manifest.source.license).toBe("Apache-2.0");
    expect(manifest.source.split).toBe("original");
    expect(manifest.hireHubExportAttempt.usableLabeledPreferred).toBe(false);
    expect(manifest.protocol.tuneOnOod).toBe(false);
    expect(manifest.protocol.reportAs).toBe("independentBenchmark");
  });

  it(
    "scores frozen enriched_v2 without crashing and builds ready independentBenchmark",
    () => {
      const ood = loadTrack5OodV1();
      const { split, model } = runJobClassifierPipeline({
        count: 600,
        enrichmentVariant: "enriched_v2",
      });
      const report = scoreTrack5Ood(model, ood.rows.slice(0, 36), {
        trainSize: split.train.length,
        seed: split.seed,
        trainFraction: split.trainFraction,
      });
      expect(Number.isFinite(report.accuracy)).toBe(true);
      expect(Number.isFinite(report.macroF1)).toBe(true);
      expect(report.testSize).toBe(36);

      const independent = buildReadyIndependentBenchmark({
        report,
        n: ood.rows.length,
        perClassSupport: ood.perClass,
      });
      expect(independent.status).toBe("ready");
      expect(independent.datasetId).toBe(TRACK5_OOD_DATASET_ID);
      expect(independent.metrics?.macroF1).toBe(report.macroF1);
      expect(independent.notes.some((n) => /never tune/i.test(n))).toBe(true);
    },
    120_000,
  );
});
