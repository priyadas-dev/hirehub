/**
 * P4 — Freeze enriched_v2 NB on synthetic train; score track5_ood_v1 once.
 *
 * Never tunes on OOD. Writes versioned track5-ood-* artifacts only.
 *
 * Usage:
 *   npm run rag:classify:track5-ood
 *   node --import tsx scripts/rag/eval-track5-ood.mjs [--count=5000]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT,
} from "../../src/lib/ai/job-classifier-enrichment.ts";
import {
  buildTrack5EvalEnvelope,
  runJobClassifierPipeline,
} from "../../src/lib/ai/job-classifier.ts";
import {
  buildReadyIndependentBenchmark,
  loadTrack5OodV1,
  scoreTrack5Ood,
  TRACK5_OOD_DATASET_ID,
} from "../../src/lib/ai/track5-ood.ts";

function parseArgs(argv) {
  let count = 5000;
  for (const arg of argv) {
    const m = arg.match(/^--count=(\d+)$/);
    if (m) count = Number(m[1]);
  }
  return { count };
}

function main() {
  const { count } = parseArgs(process.argv.slice(2));
  const variant = DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT;
  const ood = loadTrack5OodV1();

  console.log(
    `[track5-ood] Freeze variant=${variant} count=${count}; score ${TRACK5_OOD_DATASET_ID} n=${ood.rows.length} once (no OOD tuning).`,
  );

  const { split, model, report: syntheticReport } = runJobClassifierPipeline({
    count,
    enrichmentVariant: variant,
  });

  const oodReport = scoreTrack5Ood(model, ood.rows, {
    trainSize: split.train.length,
    seed: split.seed,
    trainFraction: split.trainFraction,
  });

  const independent = buildReadyIndependentBenchmark({
    report: oodReport,
    n: ood.rows.length,
    perClassSupport: ood.perClass,
  });

  const envelope = buildTrack5EvalEnvelope(syntheticReport, {
    provenance: `hirehub-synthetic-option-a-${variant}-v1`,
  });
  envelope.independentBenchmark = independent;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `track5-ood-${variant}-${stamp}.json`);

  const payload = {
    generatedAt: new Date().toISOString(),
    task: "assessment3-track5-p4-ood",
    protocol: {
      frozenVariant: variant,
      optionA: true,
      tuneOnOod: false,
      trainSource: "synthetic-enriched-template-group-split",
      oodDatasetId: TRACK5_OOD_DATASET_ID,
    },
    split: {
      trainSize: split.train.length,
      testSize: split.test.length,
      seed: split.seed,
      mode: split.mode,
    },
    syntheticBenchmark: envelope.syntheticBenchmark,
    independentBenchmark: independent,
    oodPerClassSupport: ood.perClass,
    track5: envelope,
    honesty: [
      "syntheticBenchmark and independentBenchmark are separate headlines.",
      "OOD Macro F1 does not replace the synthetic Track 5 gate.",
      "HireHub live jobs export was insufficient (n≈15); OOD uses licensed public original JDs.",
      "meetsTarget = A2 acc≥0.70; meetsTrack5MacroF1 = A3 macroF1≥0.85.",
    ],
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(
    `[track5-ood] synthetic: acc=${(syntheticReport.accuracy * 100).toFixed(2)}% macroF1=${syntheticReport.macroF1.toFixed(4)} meetsTrack5MacroF1=${syntheticReport.meetsTrack5MacroF1}`,
  );
  console.log(
    `[track5-ood] independent: n=${independent.n} acc=${(independent.metrics.accuracy * 100).toFixed(2)}% macroF1=${independent.metrics.macroF1.toFixed(4)} weightedF1=${independent.metrics.weightedF1.toFixed(4)} meetsTrack5MacroF1=${independent.metrics.meetsTrack5MacroF1}`,
  );
  console.log(`[track5-ood] perClassSupport=${JSON.stringify(ood.perClass)}`);
  console.log(`[track5-ood] Wrote ${outPath}`);
}

main();
