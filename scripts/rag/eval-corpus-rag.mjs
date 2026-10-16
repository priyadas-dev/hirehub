/**
 * Track 1 — evaluate corpus RAG with matching, noisy, and edge-case queries.
 * Writes a local report under scripts/rag/out/ (gitignored).
 *
 * Usage:
 *   node --import tsx scripts/rag/eval-corpus-rag.mjs [--match-count=5]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import { retrieveCorpusMatches } from "../../src/lib/ai/corpus-retrieve.ts";
import { EVAL_QUERY_BANK } from "../../src/lib/ai/corpus-eval.ts";

function parseArgs(argv) {
  let matchCount = 5;
  for (const arg of argv) {
    const m = arg.match(/^--match-count=(\d+)$/);
    if (m) matchCount = Number(m[1]);
  }
  return { matchCount };
}

async function main() {
  loadProjectEnv();
  const { matchCount } = parseArgs(process.argv.slice(2));
  const env = getRagEnvStatus();

  if (env.missing.length) {
    console.error(`[rag:eval] BLOCKER: missing ${env.missing.join(", ")}`);
    console.error(
      "[rag:eval] Apply PROPOSED_0009 + PROPOSED_0010 manually, set secrets, seed + embed, then re-run.",
    );
    process.exitCode = 2;
    return;
  }

  const client = createRagAdminClient();
  const probe = await probeRagMigrations(client);
  if (!probe.jobCorpusExists || !probe.corpusKeyReady || !probe.matchFnReady) {
    console.error(`[rag:eval] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }

  const cases = [];
  let categoryHits = 0;
  let categoryCases = 0;
  let emptyResults = 0;

  for (const item of EVAL_QUERY_BANK) {
    const result = await retrieveCorpusMatches(client, {
      query: item.query,
      matchCount,
      category: item.categoryFilter,
    });

    if (!result.ok) {
      cases.push({
        id: item.id,
        kind: item.kind,
        query: item.query,
        ok: false,
        message: result.message,
      });
      continue;
    }

    const top = result.matches[0] ?? null;
    const topCategories = result.matches.map((m) => m.category).filter(Boolean);
    let categoryHit = null;
    if (item.expectCategory) {
      categoryCases += 1;
      categoryHit = topCategories.includes(item.expectCategory);
      if (categoryHit) categoryHits += 1;
    }
    if (result.matches.length === 0) emptyResults += 1;

    cases.push({
      id: item.id,
      kind: item.kind,
      query: item.query,
      ok: true,
      resultCount: result.matches.length,
      topSimilarity: top?.similarity ?? null,
      topTitle: top?.title ?? null,
      topCategory: top?.category ?? null,
      topCorpusKey: top?.corpus_key ?? null,
      categoryHit,
      representative: result.matches.slice(0, 3).map((m) => ({
        corpus_key: m.corpus_key,
        title: m.title,
        category: m.category,
        similarity: Number(m.similarity.toFixed(4)),
        is_synthetic: m.is_synthetic,
      })),
    });

    console.log(
      `[rag:eval] ${item.id} (${item.kind}) → ${result.matches.length} hits` +
        (top ? ` top=${top.similarity.toFixed(3)} ${top.title}` : ""),
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    matchCount,
    metrics: {
      totalCases: EVAL_QUERY_BANK.length,
      categoryHitRate: categoryCases ? categoryHits / categoryCases : null,
      emptyResultRate: cases.filter((c) => c.ok).length
        ? emptyResults / cases.filter((c) => c.ok).length
        : null,
      failedCalls: cases.filter((c) => !c.ok).length,
    },
    cases,
    notes: [
      "Corpus matches are synthetic training documents — not live HireHub vacancies.",
      "Live recommendations must use recommendApprovedLiveJobs (approved jobs only).",
    ],
  };

  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "eval-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[rag:eval] Wrote ${outPath}`);
  console.log("[rag:eval] Metrics:", report.metrics);
}

main().catch((err) => {
  console.error("[rag:eval] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
