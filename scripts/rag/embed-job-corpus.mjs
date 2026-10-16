/**
 * Track 1 — batch-embed pending job_corpus rows.
 *
 * Providers:
 *   --provider=gemini (default) — Gemini batchEmbedContents (quota-limited)
 *   --provider=local  — free Xenova/all-mpnet-base-v2 768-dim on CPU (no Gemini key)
 *
 * Gemini retries HTTP 429 / transient 5xx with exponential backoff + Retry-After.
 * Default concurrency=1; gemini batchSize=16 (max 100); local batchSize=32 (max 64).
 *
 * Do NOT mix Gemini and local vectors without resetting embeddings first.
 *
 * Usage:
 *   node --import tsx scripts/rag/embed-job-corpus.mjs [--provider=local|gemini] [--limit=200] [--batch-size=16] [--concurrency=1]
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *            GEMINI_API_KEY only when --provider=gemini
 * Never prints secret values.
 */
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import {
  batchEmbedJobCorpus,
  DEFAULT_EMBED_BATCH_SIZE,
  DEFAULT_EMBED_CONCURRENCY,
  DEFAULT_LOCAL_EMBED_BATCH_SIZE,
} from "../../src/lib/ai/corpus-embed.ts";
import {
  embeddingModelLabel,
  resolveEmbeddingProvider,
} from "../../src/lib/ai/embed-provider.ts";

function parseArgs(argv) {
  let limit = 200;
  let concurrency = DEFAULT_EMBED_CONCURRENCY;
  let batchSize = null;
  let provider = process.env.EMBEDDING_PROVIDER ?? "gemini";
  for (const arg of argv) {
    const lim = arg.match(/^--limit=(\d+)$/);
    if (lim) limit = Number(lim[1]);
    const conc = arg.match(/^--concurrency=(\d+)$/);
    if (conc) concurrency = Math.max(1, Number(conc[1]));
    const batch = arg.match(/^--batch-size=(\d+)$/);
    if (batch) batchSize = Math.max(1, Number(batch[1]));
    const prov = arg.match(/^--provider=(local|gemini)$/i);
    if (prov) provider = prov[1].toLowerCase();
  }
  const resolved = resolveEmbeddingProvider(provider);
  if (batchSize == null) {
    batchSize =
      resolved === "local" ? DEFAULT_LOCAL_EMBED_BATCH_SIZE : DEFAULT_EMBED_BATCH_SIZE;
  }
  return { limit, concurrency, batchSize, provider: resolved };
}

async function main() {
  loadProjectEnv();
  const { limit, concurrency, batchSize, provider } = parseArgs(process.argv.slice(2));
  const env = getRagEnvStatus({ requireGemini: provider === "gemini" });

  if (env.missing.length) {
    console.error(`[rag:embed] BLOCKER: missing ${env.missing.join(", ")}`);
    console.error(
      "[rag:embed] Also ensure PROPOSED_0009 + PROPOSED_0010 were manually applied in Supabase.",
    );
    process.exitCode = 2;
    return;
  }

  const client = createRagAdminClient();
  const probe = await probeRagMigrations(client);
  if (!probe.jobCorpusExists || !probe.corpusKeyReady) {
    console.error(`[rag:embed] BLOCKER: ${probe.message}`);
    process.exitCode = 2;
    return;
  }

  const model = embeddingModelLabel(provider);
  if (provider === "local") {
    console.log(
      `[rag:embed] provider=local model=${model} — embedding up to ${limit} pending rows on CPU (batchSize=${batchSize}, concurrency=${concurrency}). No Gemini quota. First run downloads the model once.`,
    );
    console.log(
      "[rag:embed] Reminder: set EMBEDDING_PROVIDER=local for the assistant too so query vectors match. Do not mix with Gemini-embedded rows — run rag:reset-embeddings first if switching.",
    );
  } else {
    console.log(
      `[rag:embed] provider=gemini model=${model} — embedding up to ${limit} pending rows via batchEmbedContents (batchSize=${batchSize}, concurrency=${concurrency}; 429/5xx retried with backoff). Batching does not bypass daily quotas.`,
    );
  }

  const result = await batchEmbedJobCorpus(client, {
    limit,
    concurrency,
    batchSize,
    provider,
    pauseMs: provider === "local" ? 0 : concurrency === 1 ? 150 : 250,
    onProgress: (p) => {
      if (p.processed % 25 === 0 || p.failed > 0) {
        console.log(
          `[rag:embed] processed=${p.processed} embedded=${p.embedded} skipped=${p.skipped} failed=${p.failed}`,
        );
      }
    },
  });

  console.log("[rag:embed] Result:", {
    provider: result.provider,
    processed: result.processed,
    embedded: result.embedded,
    skipped: result.skipped,
    failed: result.failed,
  });
  if (result.failures.length) {
    console.log(
      "[rag:embed] Sample failures:",
      result.failures.slice(0, 10).map((f) => ({
        id: f.id,
        message: f.message,
        contentChars: f.contentChars ?? null,
        httpStatus: f.diagnostic?.httpStatus ?? null,
        category: f.diagnostic?.category ?? null,
        geminiStatus: f.diagnostic?.geminiStatus ?? null,
        geminiCode: f.diagnostic?.geminiCode ?? null,
        retryable: f.diagnostic?.retryable ?? null,
        retryAfterMs: f.diagnostic?.retryAfterMs ?? null,
      })),
    );
    const byCategory = {};
    for (const f of result.failures) {
      const key = f.diagnostic?.category ?? "unknown";
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }
    console.log("[rag:embed] Failure categories:", byCategory);
    console.log(
      "[rag:embed] Note: failed rows keep embedding=NULL and remain pending for the next run.",
    );
  }
  if (result.failed > 0 && result.embedded === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[rag:embed] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
