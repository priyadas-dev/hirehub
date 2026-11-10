/**
 * Track 1 / Track 4B — seed synthetic job corpus into public.job_corpus only.
 * Never inserts into public.jobs. Resumable: skips existing corpus_key rows.
 * Never writes embedding / embedding_gte (preserves vectors on re-run).
 *
 * Usage:
 *   node --import tsx scripts/rag/seed-job-corpus.mjs [--count=5000|10000|20000] [--dry-run]
 *
 * Requires (after manual migration apply):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import { generateSyntheticJobCorpus } from "../../src/lib/ai/corpus-generate.ts";

function parseArgs(argv) {
  let count = 5000;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    const m = arg.match(/^--count=(\d+)$/);
    if (m) count = Number(m[1]);
  }
  if (![5000, 10000, 20000].includes(count) && count < 1) {
    throw new Error(`Invalid --count=${count}`);
  }
  return { count, dryRun };
}

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

async function main() {
  loadProjectEnv();
  const { count, dryRun } = parseArgs(process.argv.slice(2));
  const env = getRagEnvStatus();

  console.log(`[rag:seed] Generating ${count} synthetic corpus documents (not real vacancies)…`);
  const docs = generateSyntheticJobCorpus(count);
  console.log(`[rag:seed] Generated ${docs.length} docs. Source=${docs[0]?.source}`);

  if (dryRun) {
    console.log("[rag:seed] Dry run — sample keys:", docs.slice(0, 3).map((d) => d.corpus_key));
    console.log("[rag:seed] Last key:", docs.at(-1)?.corpus_key);
    console.log("[rag:seed] No database writes performed.");
    return;
  }

  if (env.missing.includes("SUPABASE_URL") || env.missing.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error(
      "[rag:seed] BLOCKER: missing",
      env.missing.filter((k) => k !== "GEMINI_API_KEY").join(", "),
    );
    console.error(
      "[rag:seed] Set service-role env locally, then manually apply PROPOSED_0009 + PROPOSED_0010 in Supabase SQL Editor before seeding.",
    );
    process.exitCode = 2;
    return;
  }

  const client = createRagAdminClient();
  const probe = await probeRagMigrations(client);
  if (!probe.jobCorpusExists || !probe.corpusKeyReady) {
    console.error(`[rag:seed] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }

  const existing = await fetchExistingKeySet(
    client,
    docs.map((d) => d.corpus_key),
  );
  const missing = docs.filter((d) => !existing.has(d.corpus_key));
  const skippedExisting = docs.length - missing.length;
  console.log(
    `[rag:seed] Existing keys in range: ${skippedExisting}. Missing to upsert: ${missing.length}.`,
  );

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
    if (error) {
      console.error(`[rag:seed] Upsert failed at offset ${i}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    upserted += slice.length;
    console.log(`[rag:seed] Upserted missing ${upserted}/${missing.length}`);
  }

  console.log(
    `[rag:seed] Done. upserted=${upserted} skippedExisting=${skippedExisting}. public.jobs untouched. Embeddings unchanged.`,
  );
}

main().catch((err) => {
  console.error("[rag:seed] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
