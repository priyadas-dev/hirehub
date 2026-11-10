/**
 * Track 4B — report verified corpus/embedding checkpoint stats + eval table.
 *
 * Usage:
 *   node --import tsx scripts/rag/corpus-checkpoint.mjs
 *   npm run rag:checkpoint
 *
 * Reads live Supabase inventory when credentials exist; always merges frozen eval
 * artifacts. Never invents 10k/20k eval numbers.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import { corpusKeyForIndex } from "../../src/lib/ai/corpus.ts";
import {
  loadFrozenEvalCheckpoints,
  renderTrack4BMarkdown,
  summarizeCheckpoint,
} from "../../src/lib/ai/corpus-checkpoint.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

async function countCorpusOnly(client, filter) {
  let q = client
    .from("job_corpus")
    .select("id", { count: "exact", head: true })
    .is("job_id", null);
  if (filter === "gte") q = q.not("embedding_gte", "is", null);
  if (filter === "emb768") q = q.not("embedding", "is", null);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function inventoryCorpus(client) {
  const total = await countCorpusOnly(client);
  const gte = await countCorpusOnly(client, "gte");
  const emb = await countCorpusOnly(client, "emb768");

  let baselinePresent = 0;
  const pageSize = 500;
  for (let i = 0; i < 5000; i += pageSize) {
    const batch = [];
    for (let j = i; j < Math.min(5000, i + pageSize); j++) batch.push(corpusKeyForIndex(j));
    const { data, error } = await client
      .from("job_corpus")
      .select("corpus_key")
      .in("corpus_key", batch);
    if (error) throw new Error(error.message);
    baselinePresent += data?.length ?? 0;
  }

  return {
    corpusOnlyRows: total,
    uniqueKeys: total,
    embeddingGteNonNull: gte,
    embedding768NonNull: emb,
    baselineKeysPresent: baselinePresent,
  };
}

async function main() {
  loadProjectEnv();
  const env = getRagEnvStatus();
  const evalRows = loadFrozenEvalCheckpoints(repoRoot);
  const inventories = [];
  let liveStatus = "pipeline_only";

  const manualSteps = [
    "# 1) Inventory (verify baseline intact + counts)",
    "npm run rag:scale -- --stage=A",
    "# 2) If rows < 10k: Stage D seed (resumable; skips existing keys)",
    "npm run rag:scale -- --stage=D --dry-run",
    "npm run rag:scale -- --stage=D --confirm-seed-scale",
    "# 3) Embed pending gte only (384-dim embedding_gte; never wipes 768 column)",
    "npm run rag:embed -- --provider=gte --limit=5000 --confirm-gte-bulk --batch-size=16",
    "npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=10k",
    "# 4) If rows < 20k: Stage E seed",
    "npm run rag:scale -- --stage=E --confirm-seed-scale",
    "# 5) Finish remaining gte embeddings (repeat until missingGte=0)",
    "npm run rag:embed -- --provider=gte --limit=10000 --confirm-gte-bulk --batch-size=16",
    "npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=20k",
    "# 6) Refresh comparison + checkpoint report",
    "npm run rag:scale -- --stage=F",
    "npm run rag:checkpoint",
  ];

  if (
    env.missing.includes("SUPABASE_URL") ||
    env.missing.includes("SUPABASE_SERVICE_ROLE_KEY")
  ) {
    console.warn("[rag:checkpoint] No live Supabase service-role env — writing eval-only checkpoint report.");
  } else {
    try {
      const client = createRagAdminClient();
      const probe = await probeRagMigrations(client);
      if (!probe.jobCorpusExists || !probe.corpusKeyReady) {
        console.warn(`[rag:checkpoint] Probe blocked: ${probe.message}`);
      } else {
        const inv = await inventoryCorpus(client);
        const target =
          inv.corpusOnlyRows >= 20000 ? 20000 : inv.corpusOnlyRows >= 10000 ? 10000 : 5000;
        inventories.push(
          summarizeCheckpoint({
            totalCorpusRows: inv.corpusOnlyRows,
            uniqueKeys: inv.uniqueKeys,
            baselineKeysPresent: inv.baselineKeysPresent,
            embeddedGte: inv.embeddingGteNonNull,
            embedded768: inv.embedding768NonNull,
            targetRows: target,
          }),
        );
        liveStatus =
          inv.corpusOnlyRows >= 20000 && inv.embeddingGteNonNull >= 20000
            ? "verified_live"
            : inv.corpusOnlyRows > 5000
              ? "partial"
              : "partial";
        console.log(
          `[rag:checkpoint] live rows=${inv.corpusOnlyRows} unique=${inv.uniqueKeys} gte=${inv.embeddingGteNonNull} missingGte=${Math.max(0, inv.corpusOnlyRows - inv.embeddingGteNonNull)} baseline=${inv.baselineKeysPresent}/5000`,
        );
      }
    } catch (err) {
      console.warn(
        `[rag:checkpoint] Live inventory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Always include measured 5k eval evidence when present in artifacts (even without live DB).
  const generatedAt = new Date().toISOString();
  const markdown = renderTrack4BMarkdown({
    generatedAt,
    inventories,
    evalRows,
    liveStatus,
    manualSteps,
  });

  const outDir = path.join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `track4b-checkpoint-${stamp}.json`);
  const mdOutPath = path.join(outDir, `track4b-checkpoint-${stamp}.md`);
  const docsPath = path.join(repoRoot, "docs", "ASSESSMENT_3_TRACK4B_SCALE_REPORT.md");

  const payload = {
    generatedAt,
    liveStatus,
    inventories,
    evalRows,
    manualSteps,
  };
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  writeFileSync(mdOutPath, markdown, "utf8");
  writeFileSync(docsPath, markdown, "utf8");

  console.log(`[rag:checkpoint] wrote ${jsonPath}`);
  console.log(`[rag:checkpoint] wrote ${docsPath}`);
  for (const row of evalRows) {
    console.log(
      `  eval ${row.scale}: verified=${row.verified} hit=${row.hitRate ?? "—"} P@k=${row.precisionAtK ?? "—"}`,
    );
  }
}

main().catch((err) => {
  console.error("[rag:checkpoint] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
