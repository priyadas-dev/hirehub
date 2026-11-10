/**
 * Track 5 / classify — train/evaluate job-category classifier offline.
 * Baseline: multinomial NB. Experimental: TF-IDF + logistic regression on the same split.
 * Uses Option A remediated classifier features (no category-tied skills laundry list).
 *
 * Usage:
 *   node --import tsx scripts/rag/train-job-classifier.mjs [--count=5000] [--nb-only]
 *
 * `--nb-only` writes the official Track 5 syntheticBenchmark (NB) without the slow TF-IDF comparator.
 *
 * Writes versioned Track 5 artifacts only. Does NOT overwrite historical:
 *   classifier-eval.json / classifier-compare.json / original-description-eval.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JOB_CORPUS_CATEGORIES } from "../../src/lib/ai/corpus.ts";
import { DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT } from "../../src/lib/ai/job-classifier-enrichment.ts";
import {
  CLASSIFIER_TARGET_ACCURACY,
  CLASSIFIER_TRACK5_TARGET_MACRO_F1,
  assertNoSplitLeakage,
  assertNoTemplateGroupLeakage,
  buildTrack5EvalEnvelope,
  runJobClassifierPipeline,
} from "../../src/lib/ai/job-classifier.ts";
import { compareClassifiersOnGroupedSplit } from "../../src/lib/ai/job-classifier-compare.ts";

function parseArgs(argv) {
  let count = 5000;
  let nbOnly = false;
  for (const arg of argv) {
    const m = arg.match(/^--count=(\d+)$/);
    if (m) count = Number(m[1]);
    if (arg === "--nb-only") nbOnly = true;
  }
  return { count, nbOnly };
}

function printReport(label, report) {
  console.log(
    `[classify] ${label} accuracy=${(report.accuracy * 100).toFixed(2)}% macroF1=${report.macroF1.toFixed(4)} weightedF1=${report.weightedF1.toFixed(4)}`,
  );
  console.log(
    `[classify] ${label} meetsTarget(A2 acc≥${(CLASSIFIER_TARGET_ACCURACY * 100).toFixed(0)}%)=${report.meetsTarget} | meetsTrack5MacroF1(A3 F1≥${CLASSIFIER_TRACK5_TARGET_MACRO_F1.toFixed(2)})=${report.meetsTrack5MacroF1}`,
  );
  console.log(`[classify] ${label} per-class P/R/F1/support:`);
  for (const category of JOB_CORPUS_CATEGORIES) {
    const m = report.perClass[category];
    console.log(
      `[classify]   ${category.padEnd(18)} P=${m.precision.toFixed(4)} R=${m.recall.toFixed(4)} F1=${m.f1.toFixed(4)} support=${m.support}`,
    );
  }
}

function writeTrack5Artifacts(payload) {
  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const track5NbPath = path.join(outDir, `track5-remediated-nb-${stamp}.json`);
  const track5EnvelopePath = path.join(outDir, `track5-remediated-envelope-${stamp}.json`);
  writeFileSync(track5NbPath, JSON.stringify(payload.naiveBayes, null, 2), "utf8");
  writeFileSync(track5EnvelopePath, JSON.stringify(payload.track5, null, 2), "utf8");
  console.log(`[classify] Wrote ${track5NbPath}`);
  console.log(`[classify] Wrote ${track5EnvelopePath}`);
  if (payload.comparison) {
    const track5ComparePath = path.join(outDir, `track5-remediated-compare-${stamp}.json`);
    writeFileSync(track5ComparePath, JSON.stringify(payload.comparison, null, 2), "utf8");
    console.log(`[classify] Wrote ${track5ComparePath}`);
  }
  return stamp;
}

function printDiagnostics(diag, testSize) {
  console.log(
    `[classify] Diagnostics: near-dup@0.9=${(diag.nearDuplicateRate * 100).toFixed(2)}% (${diag.nearDuplicateCount}/${testSize}); near-dup@0.5=${(diag.nearDuplicateRateAt05 * 100).toFixed(2)}% (${diag.nearDuplicateCountAt05}/${testSize}); template-group overlap=${diag.templateGroupOverlapCount}`,
  );
  console.log(
    `[classify] Ablations: title=${(diag.titleOnlyAccuracy * 100).toFixed(2)}% desc=${(diag.descriptionOnlyAccuracy * 100).toFixed(2)}% skills=${(diag.skillsOnlyAccuracy * 100).toFixed(2)}% (skillsLinePresent=${diag.skillsLinePresentInTest}) duty=${(diag.dutyOnlyAccuracy * 100).toFixed(2)}%`,
  );
}

function main() {
  const { count, nbOnly } = parseArgs(process.argv.slice(2));
  console.log(
    `[classify] Track 5 Option A — ${nbOnly ? "NB-only syntheticBenchmark" : "NB vs TF-IDF+LogReg"} on ${count} synthetic docs (default enrichment=${DEFAULT_CLASSIFIER_ENRICHMENT_VARIANT}, template-group split, seed 42)…`,
  );
  console.log(
    "[classify] Preserving historical baselines: will NOT overwrite classifier-eval.json / classifier-compare.json / original-description-eval.json",
  );

  if (nbOnly) {
    const { split, report } = runJobClassifierPipeline({ count });
    assertNoSplitLeakage(split);
    assertNoTemplateGroupLeakage(split);
    const diag = report.syntheticDiagnostics;
    console.log(
      `[classify] Split train=${split.train.length} test=${split.test.length} seed=${split.seed} trainFraction=${split.trainFraction} mode=${split.mode ?? "row"}`,
    );
    if (diag) printDiagnostics(diag, report.testSize);
    printReport("NB (syntheticBenchmark)", report);
    const track5 = buildTrack5EvalEnvelope(report);
    writeTrack5Artifacts({ naiveBayes: report, track5 });
  } else {
    const { split, comparison } = compareClassifiersOnGroupedSplit({ count });
    const diag = comparison.diagnostics;
    console.log(
      `[classify] Split train=${split.train.length} test=${split.test.length} seed=${split.seed} trainFraction=${split.trainFraction} mode=${split.mode ?? "row"}`,
    );
    printDiagnostics(diag, comparison.testSize);
    printReport("NB (syntheticBenchmark)", comparison.naiveBayes);
    printReport("TF-IDF+LogReg", comparison.tfidfLogReg);
    if (comparison.tfidfTuning) {
      const t = comparison.tfidfTuning;
      console.log(
        `[classify] TF-IDF selection: method=${t.selectionMethod} holdoutValAccuracy=${(t.holdoutValAccuracy * 100).toFixed(2)}% candidates=${t.candidatesEvaluated}`,
      );
    }
    writeTrack5Artifacts({
      naiveBayes: comparison.naiveBayes,
      track5: comparison.track5,
      comparison,
    });
  }

  console.log(
    "[classify] Note: this command writes syntheticBenchmark only — not a real-world claim. For independentBenchmark use: npm run rag:classify:track5-ood. RAG corpus unchanged.",
  );
}

main();
