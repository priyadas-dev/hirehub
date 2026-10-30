/**
 * Track 2 — train/evaluate job-category classifier offline.
 * Baseline: multinomial NB. Experimental: TF-IDF + logistic regression on the same split.
 *
 * Usage:
 *   node --import tsx scripts/rag/train-job-classifier.mjs [--count=5000]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { JOB_CORPUS_CATEGORIES } from "../../src/lib/ai/corpus.ts";
import { CLASSIFIER_TARGET_ACCURACY } from "../../src/lib/ai/job-classifier.ts";
import { compareClassifiersOnGroupedSplit } from "../../src/lib/ai/job-classifier-compare.ts";

function parseArgs(argv) {
  let count = 5000;
  for (const arg of argv) {
    const m = arg.match(/^--count=(\d+)$/);
    if (m) count = Number(m[1]);
  }
  return { count };
}

function printReport(label, report) {
  console.log(
    `[classify] ${label} accuracy=${(report.accuracy * 100).toFixed(2)}% macroF1=${report.macroF1.toFixed(4)} meetsTarget=${report.meetsTarget} (target ${(CLASSIFIER_TARGET_ACCURACY * 100).toFixed(0)}%)`,
  );
  console.log(`[classify] ${label} per-class P/R/F1/support:`);
  for (const category of JOB_CORPUS_CATEGORIES) {
    const m = report.perClass[category];
    console.log(
      `[classify]   ${category.padEnd(18)} P=${m.precision.toFixed(4)} R=${m.recall.toFixed(4)} F1=${m.f1.toFixed(4)} support=${m.support}`,
    );
  }
}

function main() {
  const { count } = parseArgs(process.argv.slice(2));
  console.log(
    `[classify] Comparing NB vs experimental TF-IDF+LogReg on ${count} synthetic docs (same preprocess + template-group split, seed 42)…`,
  );

  const { split, comparison } = compareClassifiersOnGroupedSplit({ count });
  const diag = comparison.diagnostics;

  console.log(
    `[classify] Split train=${split.train.length} test=${split.test.length} seed=${split.seed} trainFraction=${split.trainFraction} mode=${split.mode ?? "row"}`,
  );
  console.log(
    `[classify] Diagnostics: near-dup=${(diag.nearDuplicateRate * 100).toFixed(2)}% (${diag.nearDuplicateCount}/${comparison.testSize}); template-group overlap=${diag.templateGroupOverlapCount}`,
  );

  printReport("NB baseline", comparison.naiveBayes);
  printReport("TF-IDF+LogReg", comparison.tfidfLogReg);
  if (comparison.tfidfTuning) {
    const t = comparison.tfidfTuning;
    console.log(
      `[classify] TF-IDF selection: method=${t.selectionMethod} holdoutValAccuracy=${(t.holdoutValAccuracy * 100).toFixed(2)}% candidates=${t.candidatesEvaluated}`,
    );
  }

  console.log(
    "[classify] Note: synthetic scores are experimental/offline only — not a real-world accuracy claim. Production assistant/RAG unchanged.",
  );

  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const baselinePath = path.join(outDir, "classifier-eval.json");
  const comparePath = path.join(outDir, "classifier-compare.json");
  writeFileSync(baselinePath, JSON.stringify(comparison.naiveBayes, null, 2), "utf8");
  writeFileSync(comparePath, JSON.stringify(comparison, null, 2), "utf8");
  console.log(`[classify] Wrote NB baseline ${baselinePath}`);
  console.log(`[classify] Wrote comparison ${comparePath}`);
}

main();
