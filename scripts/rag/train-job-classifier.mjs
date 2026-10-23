/**
 * Track 2 — train/evaluate job-category classifier offline.
 * Reuses Track 1 synthetic corpus labels. No Supabase, no paid APIs, no live jobs.
 *
 * Usage:
 *   node --import tsx scripts/rag/train-job-classifier.mjs [--count=5000]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CLASSIFIER_TARGET_ACCURACY,
  runJobClassifierPipeline,
} from "../../src/lib/ai/job-classifier.ts";

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
  console.log(`[classify] Training multinomial NB on ${count} synthetic labeled docs (offline)…`);

  const { split, report } = runJobClassifierPipeline({ count });

  console.log(
    `[classify] Split train=${split.train.length} test=${split.test.length} seed=${split.seed}`,
  );
  console.log(
    `[classify] Held-out accuracy=${(report.accuracy * 100).toFixed(2)}% (target ${(CLASSIFIER_TARGET_ACCURACY * 100).toFixed(0)}%) meetsTarget=${report.meetsTarget}`,
  );
  console.log(`[classify] Macro F1=${report.macroF1.toFixed(4)}`);

  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "classifier-eval.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[classify] Wrote ${outPath}`);
}

main();
