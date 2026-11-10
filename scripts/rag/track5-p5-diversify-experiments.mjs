/**
 * Track 5 P5 — synthetic duty diversification matrix (Option A).
 *
 * Goal (aspirational, not forced): Macro F1 ≥ 0.85 AND accuracy in (70%, 90%).
 * If unmet cleanly → keep enriched_v2 + honest “still too easy”.
 *
 * Usage:
 *   npm run rag:classify:track5-p5
 *   node --import tsx scripts/rag/track5-p5-diversify-experiments.mjs [--count=5000]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildTrack5EvalEnvelope,
  runJobClassifierPipeline,
} from "../../src/lib/ai/job-classifier.ts";

const VARIANTS = ["enriched_v1", "enriched_v2", "v2-div-a", "v2-div-b"];

function parseArgs(argv) {
  let count = 5000;
  for (const arg of argv) {
    const m = arg.match(/^--count=(\d+)$/);
    if (m) count = Number(m[1]);
  }
  return { count };
}

function inPreferredAccuracyBand(accuracy) {
  return accuracy > 0.7 && accuracy < 0.9;
}

function main() {
  const { count } = parseArgs(process.argv.slice(2));
  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const summary = {
    generatedAt: new Date().toISOString(),
    task: "assessment3-track5-p5-diversify",
    count,
    seed: 42,
    optionA: true,
    preferredAccuracyBand: "(0.70, 0.90)",
    targetMacroF1: 0.85,
    variants: [],
  };

  console.log(
    `[track5-p5] Diversify matrix count=${count} variants=${VARIANTS.join(",")} (Option A; no skills line)`,
  );

  for (const variant of VARIANTS) {
    console.log(`[track5-p5] === variant=${variant} ===`);
    const { split, report } = runJobClassifierPipeline({
      count,
      enrichmentVariant: variant,
    });
    const diag = report.syntheticDiagnostics;
    const envelope = buildTrack5EvalEnvelope(report, {
      provenance: `hirehub-synthetic-option-a-${variant}-p5-v1`,
    });

    const joint =
      report.meetsTrack5MacroF1 === true && inPreferredAccuracyBand(report.accuracy);

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
      jointPreferredBandAndMacroF1: joint,
      track5: envelope,
    };

    const outPath = path.join(outDir, `track5-p5-${variant}-${stamp}.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(
      `[track5-p5] ${variant}: acc=${(report.accuracy * 100).toFixed(2)}% macroF1=${report.macroF1.toFixed(4)} meetsTrack5MacroF1=${report.meetsTrack5MacroF1} band=${inPreferredAccuracyBand(report.accuracy)} joint=${joint} skillsLinePresent=${diag?.skillsLinePresentInTest}`,
    );
    console.log(`[track5-p5] Wrote ${outPath}`);

    summary.variants.push({
      variant,
      accuracy: report.accuracy,
      macroF1: report.macroF1,
      weightedF1: report.weightedF1,
      meetsTarget: report.meetsTarget,
      meetsTrack5MacroF1: report.meetsTrack5MacroF1,
      inPreferredAccuracyBand: inPreferredAccuracyBand(report.accuracy),
      jointPreferredBandAndMacroF1: joint,
      skillsLinePresentInTest: diag?.skillsLinePresentInTest ?? null,
      nearDuplicateRate: diag?.nearDuplicateRate ?? null,
      nearDuplicateRateAt05: diag?.nearDuplicateRateAt05 ?? null,
      artifact: path.basename(outPath),
    });
  }

  const jointWinners = [...summary.variants]
    .filter((v) => v.jointPreferredBandAndMacroF1)
    .sort((a, b) => b.macroF1 - a.macroF1 || a.accuracy - b.accuracy);
  const f1Winners = [...summary.variants]
    .filter((v) => v.meetsTrack5MacroF1)
    .sort((a, b) => b.macroF1 - a.macroF1);

  summary.jointWinners = jointWinners.map((v) => v.variant);
  summary.recommendedDefault = jointWinners[0]?.variant ?? "enriched_v2";
  summary.keepEnrichedV2 =
    jointWinners.length === 0
      ? "No clean joint winner; keep enriched_v2 and report synthetic task still too easy / band unmet."
      : null;
  summary.honesty = [
    "Option A preserved (no category-tied skills laundry list).",
    "No noise, label flips, test peeking, or deliberate model crippling.",
    "Preferred accuracy band is aspirational; Macro F1 ≥ 0.85 remains the Track 5 gate.",
    "If no variant jointly hits band + F1, default stays enriched_v2 with honesty.",
    "independentBenchmark not rescored here — see P4 track5-ood artifact.",
  ];
  summary.bestMacroF1MeetingGate = f1Winners[0] ?? null;

  const summaryPath = path.join(outDir, `track5-p5-summary-${stamp}.json`);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(
    `[track5-p5] jointWinners=${JSON.stringify(summary.jointWinners)} recommendedDefault=${summary.recommendedDefault}`,
  );
  console.log(`[track5-p5] Wrote ${summaryPath}`);
}

main();
