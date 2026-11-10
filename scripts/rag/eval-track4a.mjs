/**
 * Assessment 3 Track 4A — unified agent + RAG evaluation harness.
 *
 * Reuses:
 *   - src/lib/ai/agents/agent-scenarios.ts (offline agent task-success)
 *   - scripts/rag/eval-sets/a3_v1.json + existing a3-frozen-*.json artifacts
 *   - scripts/rag/out/eval-report.json (Assessment 2 category-hit baseline)
 *
 * Does NOT invent missing A2 numbers. Does NOT seed/embed or expand to 20k (Task 4B).
 *
 * Usage:
 *   node --import tsx scripts/rag/eval-track4a.mjs
 *   npm run rag:eval:track4a
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentScenarios } from "../../src/lib/ai/agents/agent-scenarios.ts";
import {
  buildTrack4AReport,
  loadAssessment2Snapshot,
  loadLatestA3FrozenSnapshot,
  renderTrack4AMarkdown,
} from "../../src/lib/ai/eval/track4a-report.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  const agents = await runAgentScenarios();
  const assessment2 = loadAssessment2Snapshot(repoRoot);
  const assessment3Rag = loadLatestA3FrozenSnapshot(repoRoot);
  const report = buildTrack4AReport({
    agents,
    assessment2,
    assessment3Rag,
    repoRoot,
  });
  const markdown = renderTrack4AMarkdown(report);

  const outDir = path.join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `track4a-${stamp}.json`);
  const mdOutPath = path.join(outDir, `track4a-${stamp}.md`);
  const docsPath = path.join(repoRoot, "docs", "ASSESSMENT_3_TRACK4A_EVALUATION_REPORT.md");

  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(mdOutPath, markdown, "utf8");
  writeFileSync(docsPath, markdown, "utf8");

  console.log(
    `[rag:eval:track4a] agents ${agents.passed}/${agents.total} (${(agents.taskSuccessRate * 100).toFixed(1)}%)`,
  );
  for (const [agent, stats] of Object.entries(agents.byAgent)) {
    console.log(
      `  ${agent}: ${stats.passed}/${stats.total} (${(stats.rate * 100).toFixed(1)}%)`,
    );
  }
  if (assessment3Rag) {
    console.log(
      `[rag:eval:track4a] RAG artifact ${assessment3Rag.sourcePath} hit@${assessment3Rag.k}=${assessment3Rag.hitRate ?? "n/a"} P@k=${assessment3Rag.meanPrecisionAtK ?? "n/a"}`,
    );
  } else {
    console.warn("[rag:eval:track4a] No a3-frozen-*.json found — RAG section uses empty measured column.");
  }
  if (assessment2) {
    console.log(
      `[rag:eval:track4a] A2 category-hit=${assessment2.categoryHitRate?.toFixed(3) ?? "n/a"} from ${assessment2.sourcePath}`,
    );
  } else {
    console.warn("[rag:eval:track4a] Assessment 2 eval-report.json missing — comparison left blank.");
  }
  console.log(`[rag:eval:track4a] wrote ${jsonPath}`);
  console.log(`[rag:eval:track4a] wrote ${mdOutPath}`);
  console.log(`[rag:eval:track4a] wrote ${docsPath}`);

  if (agents.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[rag:eval:track4a] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
