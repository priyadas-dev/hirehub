/**
 * Null out all job_corpus.embedding values so a clean re-embed can use one provider.
 * Required before switching between Gemini and local vectors (do not mix spaces).
 *
 * Usage:
 *   node --import tsx scripts/rag/reset-corpus-embeddings.mjs [--yes]
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Never prints secret values. Does not delete corpus rows or content.
 */
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";

async function main() {
  loadProjectEnv();
  const yes = process.argv.slice(2).includes("--yes");
  const env = getRagEnvStatus({ requireGemini: false });

  if (env.missing.length) {
    console.error(`[rag:reset-embeddings] BLOCKER: missing ${env.missing.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  if (!yes) {
    console.error(
      "[rag:reset-embeddings] Refusing to run without --yes (this sets embedding=NULL on all job_corpus rows).",
    );
    process.exitCode = 2;
    return;
  }

  const client = createRagAdminClient();
  const probe = await probeRagMigrations(client);
  if (!probe.jobCorpusExists) {
    console.error(`[rag:reset-embeddings] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }

  // Supabase requires a filter on update — match all synthetic/live corpus rows by source/key presence.
  const { data, error, count } = await client
    .from("job_corpus")
    .update(
      { embedding: null, updated_at: new Date().toISOString() },
      { count: "exact" },
    )
    .not("id", "is", null)
    .select("id");

  if (error) {
    console.error(`[rag:reset-embeddings] Failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const cleared = count ?? data?.length ?? 0;
  console.log(`[rag:reset-embeddings] Cleared embeddings on ${cleared} job_corpus row(s).`);
  console.log(
    "[rag:reset-embeddings] Next: npm run rag:embed -- --provider=local --limit=5000  (and set EMBEDDING_PROVIDER=local for the app).",
  );
}

main().catch((err) => {
  console.error(
    "[rag:reset-embeddings] Fatal:",
    err instanceof Error ? err.message : err,
  );
  process.exitCode = 1;
});
