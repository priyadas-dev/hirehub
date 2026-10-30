/**
 * Score the 12 held-out job descriptions by nearest local gte-small class prototype.
 * Does not train Naive Bayes, write embeddings, or touch Supabase.
 *
 * Usage:
 *   node --import tsx scripts/rag/eval-original-descriptions.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluateOriginalDescriptionsByPrototype } from "../../src/lib/ai/classifier-original-prototype.ts";

async function main() {
  console.log("[classify:original] Embedding class prototypes and held-out descriptions with local gte-small…");
  const report = await evaluateOriginalDescriptionsByPrototype();
  console.log(
    `[classify:original] accuracy=${(report.accuracy * 100).toFixed(2)}% macroF1=${report.macroF1.toFixed(4)} n=${report.testSize} unscored=${report.unscoredCount}`,
  );
  for (const [category, metrics] of Object.entries(report.perClass)) {
    console.log(
      `[classify:original] ${category} P=${metrics.precision.toFixed(2)} R=${metrics.recall.toFixed(2)} F1=${metrics.f1.toFixed(2)} support=${metrics.support}`,
    );
  }

  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "original-description-eval.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[classify:original] Wrote ${outPath}`);
}

main().catch((err) => {
  console.error("[classify:original] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
