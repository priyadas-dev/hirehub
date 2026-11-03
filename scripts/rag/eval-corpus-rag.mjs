/**
 * Track 1 — evaluate corpus RAG with matching, noisy, edge, and clean-vs-noisy pairs.
 * Writes local reports under scripts/rag/out/ (gitignored JSON; markdown summary printed).
 *
 * Does NOT reseed corpus or overwrite embeddings.
 *
 * Usage:
 *   node --import tsx scripts/rag/eval-corpus-rag.mjs [--match-count=5] [--provider=gte]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import { retrieveCorpusMatches } from "../../src/lib/ai/corpus-retrieve.ts";
import {
  EVAL_QUERY_BANK,
  formatCleanVsNoisyMarkdown,
  summarizeCleanVsNoisy,
} from "../../src/lib/ai/corpus-eval.ts";

function parseArgs(argv) {
  let matchCount = 5;
  let provider = process.env.EMBEDDING_PROVIDER ?? "gemini";
  for (const arg of argv) {
    const m = arg.match(/^--match-count=(\d+)$/);
    if (m) matchCount = Number(m[1]);
    const prov = arg.match(/^--provider=(local|gemini|gte|gte-small)$/i);
    if (prov) {
      const p = prov[1].toLowerCase();
      provider = p === "gte-small" ? "gte" : p;
    }
  }
  return { matchCount, provider };
}

async function main() {
  loadProjectEnv();
  const { matchCount, provider } = parseArgs(process.argv.slice(2));
  const env = getRagEnvStatus({ requireGemini: provider === "gemini" });

  if (env.missing.length) {
    console.error(`[rag:eval] BLOCKER: missing ${env.missing.join(", ")}`);
    console.error(
      "[rag:eval] Apply PROPOSED_0009 + PROPOSED_0010 (+ 0011 for gte) manually, set secrets, seed + embed, then re-run.",
    );
    process.exitCode = 2;
    return;
  }

  const client = createRagAdminClient();
  const probe = await probeRagMigrations(client);
  if (!probe.jobCorpusExists || !probe.corpusKeyReady) {
    console.error(`[rag:eval] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }
  if (provider === "gte" && !probe.gteSpaceReady) {
    console.error(`[rag:eval] BLOCKER: gte space not ready. ${probe.message}`);
    process.exitCode = 2;
    return;
  }
  if (provider !== "gte" && !probe.matchFnReady) {
    console.error(`[rag:eval] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }

  const cases = [];
  let categoryHits = 0;
  let categoryCases = 0;
  let emptyResults = 0;

  for (const item of EVAL_QUERY_BANK) {
    const result = await retrieveCorpusMatches(
      client,
      {
        query: item.query,
        matchCount,
        category: item.categoryFilter,
      },
      { provider },
    );

    if (!result.ok) {
      cases.push({
        id: item.id,
        kind: item.kind,
        query: item.query,
        pairId: item.pairId ?? null,
        pairRole: item.pairRole ?? null,
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
      pairId: item.pairId ?? null,
      pairRole: item.pairRole ?? null,
      ok: true,
      hybrid: result.hybrid,
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
        (result.hybrid ? " [hybrid]" : " [vector+rerank]") +
        (top ? ` top=${top.similarity.toFixed(3)} ${top.title}` : ""),
    );
  }

  const cleanVsNoisy = summarizeCleanVsNoisy(cases, EVAL_QUERY_BANK);
  const cleanVsNoisyMarkdown = formatCleanVsNoisyMarkdown(cleanVsNoisy);

  const hybridUsed = cases.some((c) => c.hybrid === true);

  const report = {
    generatedAt: new Date().toISOString(),
    matchCount,
    provider,
    hybrid: hybridUsed,
    ftsReady: probe.ftsReady === true,
    metrics: {
      totalCases: EVAL_QUERY_BANK.length,
      categoryHitRate: categoryCases ? categoryHits / categoryCases : null,
      emptyResultRate: cases.filter((c) => c.ok).length
        ? emptyResults / cases.filter((c) => c.ok).length
        : null,
      failedCalls: cases.filter((c) => !c.ok).length,
      cleanNoisyPairCount: cleanVsNoisy.pairCount,
      noisyCategoryHitRate: cleanVsNoisy.noisyCategoryHitRate,
      cleanCategoryHitRate: cleanVsNoisy.cleanCategoryHitRate,
    },
    cleanVsNoisy,
    cases,
    notes: [
      "Corpus matches are synthetic training documents — not live HireHub vacancies.",
      "Live recommendations must use recommendApprovedLiveJobs (approved jobs only).",
      "Retrieval is hybrid: dense vector + Postgres FTS (PROPOSED_0018) + RRF/lexical re-rank.",
      "cleanVsNoisy compares paired clean matching queries vs typo twins (with vs without noise).",
      "This run does not reseed or overwrite embeddings.",
      probe.ftsReady
        ? "FTS RPC search_job_corpus_fts is available."
        : "FTS not applied yet — lexical re-rank still runs; apply PROPOSED_0018_job_corpus_fts.sql for full hybrid.",
    ],
  };

  const outDir = path.join(process.cwd(), "scripts/rag/out");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "eval-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  const mdPath = path.join(outDir, "clean-vs-noisy.md");
  writeFileSync(
    mdPath,
    `# Clean vs noisy RAG (generated)\n\nProvider: \`${provider}\`  \nGenerated: ${report.generatedAt}\n\n${cleanVsNoisyMarkdown}\n`,
    "utf8",
  );
  console.log(`[rag:eval] Wrote ${outPath}`);
  console.log(`[rag:eval] Wrote ${mdPath}`);
  console.log("[rag:eval] Metrics:", report.metrics);
  console.log("[rag:eval] Clean vs noisy:\n" + cleanVsNoisyMarkdown);
}

main().catch((err) => {
  console.error("[rag:eval] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
