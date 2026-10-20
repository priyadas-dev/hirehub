/**
 * Track 1 — batch-embed pending job_corpus rows (resumable).
 *
 * Providers:
 *   --provider=gemini (default) — Gemini → job_corpus.embedding (768)
 *   --provider=local            — Xenova/all-mpnet-base-v2 → embedding (768)
 *   --provider=gte              — Xenova/gte-small → embedding_gte (384) only
 *
 * gte never overwrites embedding (768). Do not mix providers inside one column.
 *
 * Safety:
 *   Default --limit=200. For --provider=gte with --limit>200, require
 *   --confirm-gte-bulk (does not run against production by itself; you still
 *   need SUPABASE_* credentials and applied PROPOSED_0011).
 *
 * Usage:
 *   node --import tsx scripts/rag/embed-job-corpus.mjs --provider=gte --limit=200
 *   node --import tsx scripts/rag/embed-job-corpus.mjs --provider=gte --limit=5000 --confirm-gte-bulk --batch-size=16
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *            GEMINI_API_KEY only when --provider=gemini
 * Never prints secret values. Does not seed rows or apply SQL.
 */
import { loadProjectEnv, getRagEnvStatus } from "../../src/lib/ai/rag-env.ts";
import { createRagAdminClient, probeRagMigrations } from "../../src/lib/ai/rag-admin.ts";
import {
  batchEmbedJobCorpus,
  DEFAULT_EMBED_BATCH_SIZE,
  DEFAULT_EMBED_CONCURRENCY,
  DEFAULT_GTE_EMBED_BATCH_SIZE,
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
  let confirmGteBulk = false;
  for (const arg of argv) {
    const lim = arg.match(/^--limit=(\d+)$/);
    if (lim) limit = Number(lim[1]);
    const conc = arg.match(/^--concurrency=(\d+)$/);
    if (conc) concurrency = Math.max(1, Number(conc[1]));
    const batch = arg.match(/^--batch-size=(\d+)$/);
    if (batch) batchSize = Math.max(1, Number(batch[1]));
    const prov = arg.match(/^--provider=(local|gemini|gte|gte-small)$/i);
    if (prov) {
      const p = prov[1].toLowerCase();
      provider = p === "gte-small" ? "gte" : p;
    }
    if (arg === "--confirm-gte-bulk") confirmGteBulk = true;
  }
  const resolved = resolveEmbeddingProvider(provider);
  if (batchSize == null) {
    batchSize =
      resolved === "gte"
        ? DEFAULT_GTE_EMBED_BATCH_SIZE
        : resolved === "local"
          ? DEFAULT_LOCAL_EMBED_BATCH_SIZE
          : DEFAULT_EMBED_BATCH_SIZE;
  }
  return { limit, concurrency, batchSize, provider: resolved, confirmGteBulk };
}

async function main() {
  loadProjectEnv();
  const { limit, concurrency, batchSize, provider, confirmGteBulk } = parseArgs(
    process.argv.slice(2),
  );
  const env = getRagEnvStatus({ requireGemini: provider === "gemini" });

  if (env.missing.length) {
    console.error(`[rag:embed] BLOCKER: missing ${env.missing.join(", ")}`);
    console.error(
      "[rag:embed] Also ensure PROPOSED_0009 + PROPOSED_0010 were manually applied (and PROPOSED_0011 for --provider=gte).",
    );
    process.exitCode = 2;
    return;
  }

  if (provider === "gte" && limit > 200 && !confirmGteBulk) {
    console.error(
      "[rag:embed] BLOCKER: --provider=gte with --limit>200 requires --confirm-gte-bulk.",
    );
    console.error(
      "[rag:embed] Example: npm run rag:embed -- --provider=gte --limit=5000 --confirm-gte-bulk --batch-size=16",
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
  if (provider === "gte" && !probe.gteSpaceReady) {
    console.error(`[rag:embed] BLOCKER: gte space not ready. ${probe.message}`);
    console.error(
      "[rag:embed] Manually review/apply drizzle/migrations/PROPOSED_0011_gte_small_embeddings.sql first.",
    );
    process.exitCode = 2;
    return;
  }

  const model = embeddingModelLabel(provider);
  if (provider === "gte") {
    console.log(
      `[rag:embed] provider=gte model=${model} dims=384 — writing embedding_gte only (legacy embedding untouched). limit=${limit} batchSize=${batchSize} concurrency=${concurrency}. First run downloads the model once.`,
    );
    console.log(
      "[rag:embed] Reminder: set EMBEDDING_PROVIDER=gte for the assistant so query vectors match. Rollback: EMBEDDING_PROVIDER=gemini|local.",
    );
  } else if (provider === "local") {
    console.log(
      `[rag:embed] provider=local model=${model} dims=768 — embedding up to ${limit} pending rows on CPU (batchSize=${batchSize}). Writes embedding column.`,
    );
  } else {
    console.log(
      `[rag:embed] provider=gemini model=${model} dims=768 — embedding up to ${limit} pending rows via batchEmbedContents (batchSize=${batchSize}).`,
    );
  }

  const result = await batchEmbedJobCorpus(client, {
    limit,
    concurrency,
    batchSize,
    provider,
    pauseMs: provider === "gemini" ? (concurrency === 1 ? 150 : 250) : 0,
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
    const targetCol = provider === "gte" ? "embedding_gte" : "embedding";
    console.log(
      `[rag:embed] Note: failed rows keep ${targetCol}=NULL and remain pending for the next run.`,
    );
  }
  if (result.failed > 0 && result.embedded === 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[rag:embed] Fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
