/**
 * Phase 8 Stages A→F orchestrator.
 *
 * Default is offline / dry-run. Live writes require explicit flags:
 *   --confirm-seed-scale   upsert append rows (embeddings omitted)
 *   --confirm-gte-bulk     passed through embed path for large gte batches
 *
 * Usage examples:
 *   node --import tsx scripts/rag/scale-corpus-stages.mjs --stage=A
 *   node --import tsx scripts/rag/scale-corpus-stages.mjs --stage=B
 *   node --import tsx scripts/rag/scale-corpus-stages.mjs --stage=C
 *   node --import tsx scripts/rag/scale-corpus-stages.mjs --stage=D --dry-run
 *   node --import tsx scripts/rag/scale-corpus-stages.mjs --stage=F
 *   node --import tsx scripts/rag/scale-corpus-stages.mjs --stage=D --confirm-seed-scale
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import { generateSyntheticJobCorpus } from "../../src/lib/ai/corpus-generate.ts";
import { corpusKeyForIndex } from "../../src/lib/ai/corpus.ts";
import {
  evaluateCorpusSample,
  sliceAppendCorpus,
} from "../../src/lib/ai/corpus-quality.ts";
import {
  appendRangeForStage,
  loadFrozenEvalCheckpoints,
  summarizeCheckpoint,
} from "../../src/lib/ai/corpus-checkpoint.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function parseArgs(argv) {
  let stage = "A";
  let dryRun = true;
  let confirmSeedScale = false;
  let confirmGteBulk = false;
  for (const arg of argv) {
    const s = arg.match(/^--stage=([A-Fa-f])$/);
    if (s) stage = s[1].toUpperCase();
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--no-dry-run") dryRun = false;
    if (arg === "--confirm-seed-scale") {
      confirmSeedScale = true;
      dryRun = false;
    }
    if (arg === "--confirm-gte-bulk") confirmGteBulk = true;
  }
  return { stage, dryRun, confirmSeedScale, confirmGteBulk };
}

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
  // Prefer exact head counts (avoids statement timeouts on 20k full scans).
  const total = await countCorpusOnly(client);
  const gte = await countCorpusOnly(client, "gte");
  const emb = await countCorpusOnly(client, "emb768");

  // Baseline intact: sample first/last baseline keys + count in key prefix range via pages.
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

  // Unique keys ≈ total for corpus-only synthetic rows (enforced by unique corpus_key).
  return {
    corpusOnlyRows: total,
    embeddingGteNonNull: gte,
    embedding768NonNull: emb,
    baselineKeysPresent: baselinePresent,
    baselineIntact: baselinePresent === 5000,
    categories: {},
    uniqueKeys: total,
  };
}

/** Fetch which corpus_keys already exist (for resumable append). */
async function fetchExistingKeySet(client, keys) {
  const existing = new Set();
  const batchSize = 200;
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const { data, error } = await client
      .from("job_corpus")
      .select("corpus_key")
      .in("corpus_key", batch);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      if (row.corpus_key) existing.add(row.corpus_key);
    }
  }
  return existing;
}

/**
 * Upsert only missing keys. Never sets embedding columns — preserves vectors on re-run.
 * Throws on batch failure (does not silently skip failed records).
 */
async function upsertMissingDocs(client, docs) {
  const existing = await fetchExistingKeySet(
    client,
    docs.map((d) => d.corpus_key),
  );
  const missing = docs.filter((d) => !existing.has(d.corpus_key));
  const skippedExisting = docs.length - missing.length;
  const batchSize = 200;
  let upserted = 0;
  for (let i = 0; i < missing.length; i += batchSize) {
    const slice = missing.slice(i, i + batchSize).map((doc) => ({
      corpus_key: doc.corpus_key,
      job_id: null,
      title: doc.title,
      location: doc.location,
      category: doc.category,
      skills_text: doc.skills_text,
      source: doc.source,
      is_synthetic: true,
      content: doc.content,
      // Omit embedding / embedding_gte — never wipe vectors on seed/reseed.
      updated_at: new Date().toISOString(),
    }));
    const { error } = await client.from("job_corpus").upsert(slice, {
      onConflict: "corpus_key",
      ignoreDuplicates: false,
    });
    if (error) throw new Error(`Upsert failed at offset ${i}: ${error.message}`);
    upserted += slice.length;
    console.log(`[rag:scale] Upserted missing ${upserted}/${missing.length} (skipped existing ${skippedExisting})`);
  }
  return { upserted, skippedExisting, planned: docs.length };
}

function writeArtifact(name, payload) {
  const outDir = path.join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const p = path.join(outDir, name);
  writeFileSync(p, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[rag:scale] wrote ${p}`);
  return p;
}

async function main() {
  loadProjectEnv();
  const { stage, dryRun, confirmSeedScale, confirmGteBulk } = parseArgs(process.argv.slice(2));
  console.log(
    `[rag:scale] stage=${stage} dryRun=${dryRun} confirmSeedScale=${confirmSeedScale} confirmGteBulk=${confirmGteBulk}`,
  );

  if (stage === "B") {
    const all = generateSyntheticJobCorpus(5100);
    const sample = sliceAppendCorpus(all, 5000, 5100);
    const quality = evaluateCorpusSample(sample, { baselineExclusive: true });
    writeArtifact(`stage-B-sample-quality.json`, { stage: "B", quality, sampleKeys: sample.map((d) => d.corpus_key) });
    console.log(`[rag:scale] Stage B quality ok=${quality.ok} disjoint=${quality.disjointFromBaseline5k}`);
    if (!quality.ok) process.exitCode = 1;
    return;
  }

  if (stage === "C") {
    const all = generateSyntheticJobCorpus(5200);
    const sample = sliceAppendCorpus(all, 5000, 5200);
    const quality = evaluateCorpusSample(sample, { baselineExclusive: true });
    writeArtifact(`stage-C-leakage-check.json`, {
      stage: "C",
      quality,
      frozenEvalSet: "scripts/rag/eval-sets/a3_v1.json",
      leakageChecklist: [
        "Eval set authored outside corpus-generate.ts",
        "Same frozen set used at 5k/10k/20k",
        "Suspicion if hit-rate > 0.90",
        "No delete of baseline keys",
      ],
    });
    console.log(`[rag:scale] Stage C leakageFlags=${quality.leakageFlags.join(",") || "none"}`);
    if (!quality.disjointFromBaseline5k || quality.duplicateKeys.length) process.exitCode = 1;
    return;
  }

  if (stage === "F") {
    const evalRows = loadFrozenEvalCheckpoints(repoRoot);
    writeArtifact(`stage-F-comparison.json`, {
      stage: "F",
      frozenEvalSet: "a3_v1",
      filledFromArtifacts: true,
      table: evalRows.map((row) => ({
        scale: row.scale,
        hitRate: row.hitRate,
        precisionAtK: row.precisionAtK,
        mrr: row.mrr,
        ndcgAtK: row.ndcgAtK,
        categoryHitRate: row.categoryHitRate,
        faithfulness: row.faithfulness,
        answerRelevance: row.answerRelevance,
        verified: row.verified,
        source: row.sourcePath ?? `missing a3-frozen-${row.scale}-*.json`,
      })),
      a2BaselineCategoryHit: {
        overall: 0.725,
        matching: 0.774,
        noisy: 0.632,
        edge: 0.167,
        note: "A2 category-hit@k proxy from Phase 0 freeze — not Precision@k; different bank than a3_v1",
      },
      policy: "Do not invent unverified 10k/20k cells",
    });
    console.log("[rag:scale] Stage F comparison written from available frozen eval artifacts.");
    for (const row of evalRows) {
      console.log(
        `  ${row.scale}: verified=${row.verified} hit=${row.hitRate ?? "—"} P@k=${row.precisionAtK ?? "—"}`,
      );
    }
    return;
  }

  // Stages A, D, E need DB (A read-only; D/E optional write)
  const env = getRagEnvStatus();
  if (env.missing.includes("SUPABASE_URL") || env.missing.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error("[rag:scale] BLOCKER: missing Supabase service-role env for live inventory/seed.");
    process.exitCode = 2;
    return;
  }

  const client = createRagAdminClient();
  const probe = await probeRagMigrations(client);
  if (!probe.jobCorpusExists || !probe.corpusKeyReady) {
    console.error(`[rag:scale] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }

  if (stage === "A") {
    const inv = await inventoryCorpus(client);
    const checkpoint = summarizeCheckpoint({
      totalCorpusRows: inv.corpusOnlyRows,
      uniqueKeys: inv.uniqueKeys,
      baselineKeysPresent: inv.baselineKeysPresent,
      embeddedGte: inv.embeddingGteNonNull,
      embedded768: inv.embedding768NonNull,
      targetRows: inv.corpusOnlyRows >= 20000 ? 20000 : inv.corpusOnlyRows >= 10000 ? 10000 : 5000,
    });
    writeArtifact(`stage-A-inventory.json`, {
      stage: "A",
      inventory: inv,
      checkpoint,
      probe: { gteSpaceReady: probe.gteSpaceReady, ftsReady: probe.ftsReady, message: probe.message },
      policy: "Preserve baseline keys; no deletes",
    });
    console.log(
      `[rag:scale] Stage A corpusOnly=${inv.corpusOnlyRows} unique=${inv.uniqueKeys} gte=${inv.embeddingGteNonNull} missingGte=${checkpoint.missingGteCount} baselineIntact=${inv.baselineIntact} dims=384`,
    );
    if (!inv.baselineIntact) {
      console.warn("[rag:scale] WARNING: baseline 5k keys not fully present — investigate before scale.");
    }
    return;
  }

  if (stage === "D" || stage === "E") {
    const { start, end, target } = appendRangeForStage(stage);
    const all = generateSyntheticJobCorpus(target);
    const append = sliceAppendCorpus(all, start, end);
    const quality = evaluateCorpusSample(append, { baselineExclusive: true });
    writeArtifact(`stage-${stage}-preseed-quality.json`, {
      stage,
      target,
      start,
      end,
      quality,
      keyRange: { first: append[0]?.corpus_key, last: append.at(-1)?.corpus_key },
    });

    if (!quality.ok || !quality.disjointFromBaseline5k) {
      console.error("[rag:scale] Append sample failed quality/disjoint checks — refusing seed.");
      process.exitCode = 1;
      return;
    }

    if (dryRun || !confirmSeedScale) {
      console.log(
        `[rag:scale] Stage ${stage} DRY-RUN — would upsert up to ${append.length} keys ${append[0]?.corpus_key}…${append.at(-1)?.corpus_key}. Pass --confirm-seed-scale to write.`,
      );
      console.log(
        `[rag:scale] After seed, embed pending gte only: npm run rag:embed -- --provider=gte --limit=${append.length} --confirm-gte-bulk --batch-size=16`,
      );
      console.log(
        `[rag:scale] Then eval: npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=${stage === "D" ? "10k" : "20k"}`,
      );
      return;
    }

    const before = await inventoryCorpus(client);
    if (!before.baselineIntact) {
      console.error("[rag:scale] Refusing seed: baseline 5k keys incomplete.");
      process.exitCode = 1;
      return;
    }
    const seedResult = await upsertMissingDocs(client, append);
    const after = await inventoryCorpus(client);
    const checkpoint = summarizeCheckpoint({
      totalCorpusRows: after.corpusOnlyRows,
      uniqueKeys: after.uniqueKeys,
      baselineKeysPresent: after.baselineKeysPresent,
      embeddedGte: after.embeddingGteNonNull,
      embedded768: after.embedding768NonNull,
      targetRows: target,
    });
    writeArtifact(`stage-${stage}-seed-result.json`, {
      stage,
      seedResult,
      before,
      after,
      checkpoint,
      confirmGteBulk,
      embedHint: `npm run rag:embed -- --provider=gte --limit=${Math.max(seedResult.upserted, 1)} --confirm-gte-bulk --batch-size=16`,
      evalHint: `npm run rag:eval:frozen -- --provider=gte --k=5 --scale-label=${stage === "D" ? "10k" : "20k"}`,
    });
    console.log(
      `[rag:scale] Stage ${stage} upserted=${seedResult.upserted} skippedExisting=${seedResult.skippedExisting}. corpusOnly now ${after.corpusOnlyRows} (unique ${after.uniqueKeys}). Embed pending nulls next (not auto-run).`,
    );
    return;
  }

  console.error(`[rag:scale] Unknown stage ${stage}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("[rag:scale] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
