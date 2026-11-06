/**
 * Phase 8 — evaluate the frozen a3_v1 set (retrieval + heuristic answer metrics).
 * Does NOT seed or embed. Writes scripts/rag/out/ (gitignored).
 *
 * Usage:
 *   node --import tsx scripts/rag/eval-frozen-set.mjs [--provider=gte] [--k=5] [--scale-label=5k]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import { retrieveCorpusMatches } from "../../src/lib/ai/corpus-retrieve.ts";
import {
  aggregateRetrievalMetrics,
  metricsLookSuspicious,
  scoreAnswerRelevance,
  scoreFaithfulness,
  scoreRetrievalCase,
} from "../../src/lib/ai/rag-metrics.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SET = path.join(__dirname, "eval-sets", "a3_v1.json");

function parseArgs(argv) {
  let provider = process.env.EMBEDDING_PROVIDER ?? "gte";
  let k = 5;
  let scaleLabel = "live";
  let setPath = DEFAULT_SET;
  for (const arg of argv) {
    const p = arg.match(/^--provider=(local|gemini|gte|gte-small)$/i);
    if (p) {
      const v = p[1].toLowerCase();
      provider = v === "gte-small" ? "gte" : v;
    }
    const km = arg.match(/^--k=(\d+)$/);
    if (km) k = Number(km[1]);
    const s = arg.match(/^--scale-label=([\w.-]+)$/);
    if (s) scaleLabel = s[1];
    const sp = arg.match(/^--set=(.+)$/);
    if (sp) setPath = path.resolve(sp[1]);
  }
  return { provider, k, scaleLabel, setPath };
}

function gradedFromCase(item, matches) {
  if (Array.isArray(item.relevantCorpusKeys) && item.relevantCorpusKeys.length > 0) {
    return item.relevantCorpusKeys.map((id) => ({ id, grade: 2 }));
  }
  const cats = new Set(item.relevantCategories ?? []);
  if (cats.size === 0) return [];
  // Category proxy grades — label as weak Precision@k in reports
  return matches
    .filter((m) => m.category && cats.has(m.category))
    .map((m) => ({ id: m.corpus_key ?? m.id, grade: 2 }));
}

async function main() {
  loadProjectEnv();
  const { provider, k, scaleLabel, setPath } = parseArgs(process.argv.slice(2));
  const frozen = JSON.parse(readFileSync(setPath, "utf8"));
  const env = getRagEnvStatus({ requireGemini: provider === "gemini" });

  if (env.missing.length) {
    console.error(`[rag:eval-frozen] BLOCKER: missing ${env.missing.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const client = createRagAdminClient();
  const probe = await probeRagMigrations(client);
  if (!probe.jobCorpusExists || !probe.corpusKeyReady) {
    console.error(`[rag:eval-frozen] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }

  const cases = [];
  const answerCases = [];

  for (const item of frozen.cases) {
    const result = await retrieveCorpusMatches(
      client,
      { query: item.query, matchCount: k },
      { provider },
    );

    if (!result.ok) {
      cases.push({
        id: item.id,
        kind: item.kind,
        ok: false,
        message: result.message,
      });
      continue;
    }

    const ranked = result.matches.map((m) => ({
      id: m.corpus_key ?? m.id,
      score: m.similarity,
    }));
    const relevant = gradedFromCase(item, result.matches);
    // For category-proxy when keys empty: treat matching categories in corpus as relevant pool
    // by grading retrieved hits only (precision among returned). Also compute categoryHit.
    let categoryHit = null;
    if (item.expectCategory) {
      categoryHit = result.matches.some((m) => m.category === item.expectCategory);
    }

    const scored = scoreRetrievalCase({
      id: item.id,
      ranked,
      relevant:
        relevant.length > 0
          ? relevant
          : item.relevantCategories?.length
            ? result.matches
                .filter((m) => item.relevantCategories.includes(m.category))
                .map((m) => ({ id: m.corpus_key ?? m.id, grade: 2 }))
            : [],
      k,
      categoryHit,
    });

    cases.push({
      ...scored,
      kind: item.kind,
      ok: true,
      topKeys: ranked.slice(0, 3).map((r) => r.id),
      resultCount: result.matches.length,
      relevanceMode:
        item.relevantCorpusKeys?.length > 0 ? "corpus_keys" : "category_proxy",
    });

    if (item.answerProbe) {
      const contexts = result.matches.map(
        (m) => `${m.title ?? ""}\n${m.content ?? m.skills_text ?? ""}`,
      );
      const syntheticAnswer = contexts[0]
        ? `Based on the corpus, a relevant practice doc is “${result.matches[0]?.title ?? "role"}” covering ${result.matches[0]?.skills_text ?? "skills"}.`
        : "No supporting corpus context was retrieved.";
      const faith = scoreFaithfulness(syntheticAnswer, contexts);
      const rel = scoreAnswerRelevance(item.query, syntheticAnswer);
      answerCases.push({
        id: item.id,
        faithfulness: faith,
        answerRelevance: rel,
      });
    }
  }

  const retrievalAgg = aggregateRetrievalMetrics(cases.filter((c) => c.ok && c.hitAtK != null));
  const suspicion = metricsLookSuspicious(retrievalAgg.hitRate);

  const outDir = path.join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `a3-frozen-${scaleLabel}-${stamp}.json`);
  const payload = {
    evalSetId: frozen.id,
    frozenAt: frozen.frozenAt,
    scaleLabel,
    provider,
    k,
    retrieval: retrievalAgg,
    suspicionProtocolTriggered: suspicion,
    answer: answerCases,
    cases,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(`[rag:eval-frozen] set=${frozen.id} scale=${scaleLabel} provider=${provider}`);
  console.log(
    `[rag:eval-frozen] hitRate=${retrievalAgg.hitRate?.toFixed(3) ?? "n/a"} precision@${k}=${retrievalAgg.meanPrecisionAtK?.toFixed(3) ?? "n/a"} mrr=${retrievalAgg.meanMrr?.toFixed(3) ?? "n/a"} ndcg=${retrievalAgg.meanNdcgAtK?.toFixed(3) ?? "n/a"} categoryHit=${retrievalAgg.categoryHitRate?.toFixed(3) ?? "n/a"}`,
  );
  if (suspicion) {
    console.warn(
      "[rag:eval-frozen] SUSPICION: primary hit-rate > 0.90 — run leakage checklist before accepting.",
    );
  }
  console.log(`[rag:eval-frozen] wrote ${outPath}`);
}

main().catch((err) => {
  console.error("[rag:eval-frozen] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
