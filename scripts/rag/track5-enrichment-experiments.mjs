/**
 * Track 5 Task 5E — duty/prose enrichment experiment matrix (Option A, NB, seed 42).
 *
 * Usage:
 *   node --import tsx scripts/rag/track5-enrichment-experiments.mjs [--count=5000]
 *
 * Writes versioned track5-enriched-* artifacts only. Never overwrites historical baselines.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ORIGINAL_JOB_DESCRIPTIONS } from "../../src/lib/ai/classifier-original-eval.ts";
import {
  CLASSIFIER_ENRICHMENT_VARIANTS,
} from "../../src/lib/ai/job-classifier-enrichment.ts";
import {
  buildTrack5EvalEnvelope,
  evaluateClassifier,
  predictJobCategory,
  runJobClassifierPipeline,
} from "../../src/lib/ai/job-classifier.ts";
import { JOB_CORPUS_CATEGORIES } from "../../src/lib/ai/corpus.ts";

function parseArgs(argv) {
  let count = 5000;
  for (const arg of argv) {
    const m = arg.match(/^--count=(\d+)$/);
    if (m) count = Number(m[1]);
  }
  return { count };
}

function scoreIndependentMicro(model) {
  let correct = 0;
  const perClass = Object.fromEntries(
    JOB_CORPUS_CATEGORIES.map((c) => [c, { tp: 0, fp: 0, fn: 0, support: 0 }]),
  );
  for (const row of ORIGINAL_JOB_DESCRIPTIONS) {
    perClass[row.category].support += 1;
    const predicted = predictJobCategory(model, row);
    if (predicted === row.category) {
      correct += 1;
      perClass[row.category].tp += 1;
    } else {
      perClass[row.category].fn += 1;
      perClass[predicted].fp += 1;
    }
  }
  let macroF1 = 0;
  const perClassOut = {};
  for (const category of JOB_CORPUS_CATEGORIES) {
    const { tp, fp, fn, support } = perClass[category];
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClassOut[category] = { precision, recall, f1, support };
    macroF1 += f1;
  }
  return {
    n: ORIGINAL_JOB_DESCRIPTIONS.length,
    accuracy: correct / ORIGINAL_JOB_DESCRIPTIONS.length,
    macroF1: macroF1 / JOB_CORPUS_CATEGORIES.length,
    perClass: perClassOut,
    notes: [
      "Independent micro-benchmark on ORIGINAL_JOB_DESCRIPTIONS (n=12 hand-written).",
      "Not a real employer dataset. Do not treat as real-world proof.",
      "Model trained on synthetic train split only; this set was not used for tuning.",
    ],
  };
}

function main() {
  const { count } = parseArgs(process.argv.slice(2));
  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const summary = {
    generatedAt: new Date().toISOString(),
    task: "assessment3-track5-task5e",
    count,
    seed: 42,
    optionA: true,
    variants: [],
  };

  console.log(
    `[track5e] Running enrichment matrix on ${count} docs (variants=${CLASSIFIER_ENRICHMENT_VARIANTS.join(",")})…`,
  );
  console.log(
    "[track5e] Will NOT overwrite classifier-eval.json / classifier-compare.json / original-description-eval.json / prior track5-remediated-*",
  );

  for (const variant of CLASSIFIER_ENRICHMENT_VARIANTS) {
    console.log(`[track5e] === variant=${variant} ===`);
    const { split, model, report } = runJobClassifierPipeline({
      count,
      enrichmentVariant: variant,
    });
    const diag = report.syntheticDiagnostics;
    const independent = scoreIndependentMicro(model);
    const envelope = buildTrack5EvalEnvelope(report, {
      provenance: `hirehub-synthetic-option-a-${variant}-v1`,
    });
    envelope.independentBenchmark = {
      kind: "independentBenchmark",
      status: "ready",
      datasetId: "ORIGINAL_JOB_DESCRIPTIONS",
      n: independent.n,
      provenance: "hand-written-in-repo-not-real-employer-data",
      notes: independent.notes,
      metrics: {
        accuracy: independent.accuracy,
        macroF1: independent.macroF1,
        perClass: independent.perClass,
      },
    };

    const payload = {
      variant,
      optionA: true,
      skillsLineForbidden: true,
      split: {
        trainSize: split.train.length,
        testSize: split.test.length,
        seed: split.seed,
        mode: split.mode,
      },
      syntheticBenchmark: envelope.syntheticBenchmark,
      independentBenchmark: envelope.independentBenchmark,
      report,
      diagnostics: diag,
      track5: envelope,
    };

    const outPath = path.join(outDir, `track5-enriched-${variant}-${stamp}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(
      `[track5e] ${variant}: acc=${(report.accuracy * 100).toFixed(2)}% macroF1=${report.macroF1.toFixed(4)} weightedF1=${report.weightedF1.toFixed(4)} meetsTarget(A2)=${report.meetsTarget} meetsTrack5MacroF1=${report.meetsTrack5MacroF1} skillsLinePresent=${diag?.skillsLinePresentInTest} indepAcc=${(independent.accuracy * 100).toFixed(1)}% indepMacroF1=${independent.macroF1.toFixed(3)}`,
    );
    console.log(`[track5e] Wrote ${outPath}`);

    summary.variants.push({
      variant,
      accuracy: report.accuracy,
      macroF1: report.macroF1,
      weightedF1: report.weightedF1,
      meetsTarget: report.meetsTarget,
      meetsTrack5MacroF1: report.meetsTrack5MacroF1,
      targetMacroF1: report.targetMacroF1,
      skillsLinePresentInTest: diag?.skillsLinePresentInTest ?? null,
      titleOnlyAccuracy: diag?.titleOnlyAccuracy ?? null,
      descriptionOnlyAccuracy: diag?.descriptionOnlyAccuracy ?? null,
      dutyOnlyAccuracy: diag?.dutyOnlyAccuracy ?? null,
      skillsOnlyAccuracy: diag?.skillsOnlyAccuracy ?? null,
      nearDuplicateRate: diag?.nearDuplicateRate ?? null,
      nearDuplicateRateAt05: diag?.nearDuplicateRateAt05 ?? null,
      independentAccuracy: independent.accuracy,
      independentMacroF1: independent.macroF1,
      artifact: path.basename(outPath),
    });
  }

  const ranked = [...summary.variants].sort((a, b) => b.macroF1 - a.macroF1);
  summary.winner = ranked[0]?.variant ?? null;
  summary.winnerMacroF1 = ranked[0]?.macroF1 ?? null;
  summary.meetsMacroF1Gate = ranked[0]?.meetsTrack5MacroF1 ?? false;
  summary.honesty = [
    "All variants keep Option A (no category-tied skills laundry list).",
    "Synthetic scores are not real-world claims.",
    "Independent block uses n=12 hand-written rows only — underpowered; not a real labeled JD dataset.",
    "meetsTarget = Assessment 2 accuracy≥0.70; meetsTrack5MacroF1 = Assessment 3 Track 5 macroF1≥0.85 — do not confuse them.",
  ];

  const summaryPath = path.join(outDir, `track5-enriched-summary-${stamp}.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[track5e] Winner=${summary.winner} macroF1=${summary.winnerMacroF1?.toFixed(4)} meets>=0.85=${summary.meetsMacroF1Gate}`);
  console.log(`[track5e] Wrote ${summaryPath}`);
}

main();
