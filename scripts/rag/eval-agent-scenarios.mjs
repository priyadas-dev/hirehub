/**
 * Phase 8 — agent task-success harness (Phases 6–7 tools, offline).
 *
 * Usage:
 *   node --import tsx scripts/rag/eval-agent-scenarios.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentScenarios } from "../../src/lib/ai/agents/agent-scenarios.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const report = await runAgentScenarios();
  const outDir = path.join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `agent-scenarios-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`[rag:eval-agents] taskSuccessRate=${(report.taskSuccessRate * 100).toFixed(1)}% (${report.passed}/${report.total})`);
  if (report.byAgent) {
    for (const [agent, stats] of Object.entries(report.byAgent)) {
      console.log(`  [${agent}] ${stats.passed}/${stats.total}`);
    }
  }
  for (const s of report.scenarios) {
    console.log(`  ${s.ok ? "PASS" : "FAIL"} ${s.id} — ${s.title}`);
  }
  console.log(`[rag:eval-agents] wrote ${outPath}`);
  if (report.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[rag:eval-agents] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
