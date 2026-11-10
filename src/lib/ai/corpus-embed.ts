import {
  formatEmbeddingForPgvector,
  hasValidEmbedding,
  type JobCorpusRow,
} from "@/lib/ai/corpus";
import {
  embedTexts,
  resolveEmbeddingProvider,
  type EmbeddingProviderName,
} from "@/lib/ai/embed-provider";
import {
  embeddingDimensions,
  embeddingStorageColumn,
} from "@/lib/ai/embed-space";
import {
  computeEmbedBackoffMs,
  fetchGeminiEmbedding,
  fetchGeminiEmbeddingsBatch,
  formatEmbedDiagnostic,
  GEMINI_BATCH_EMBED_MAX_REQUESTS,
  GEMINI_SERVER_ENV,
  type GeminiEmbedDiagnostic,
} from "@/lib/ai/gemini";

export type CorpusEmbedClient = {
  from: (table: string) => {
    select: (columns: string) => {
      is: (column: string, value: null) => {
        range: (
          from: number,
          to: number,
        ) => PromiseLike<{ data: JobCorpusRow[] | null; error: { message: string } | null }>;
      };
      not: (
        column: string,
        operator: string,
        value: null,
      ) => {
        range: (
          from: number,
          to: number,
        ) => PromiseLike<{ data: JobCorpusRow[] | null; error: { message: string } | null }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export type BatchEmbedOptions = {
  /** Max pending rows to process this run. */
  limit?: number;
  /**
   * Texts per API/local batch.
   * Gemini capped at 100; local capped at 64 for memory. Defaults: gemini 16, local 32.
   */
  batchSize?: number;
  /** Parallel batch waves. Default 1. */
  concurrency?: number;
  /** Pause between batch waves in ms. */
  pauseMs?: number;
  /** Max attempts per batch (or single fallback) on transient failures (Gemini). */
  maxAttempts?: number;
  /** gemini (default) | local | gte — must match query-time EMBEDDING_PROVIDER. */
  provider?: EmbeddingProviderName | string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Test seam — bypass network / model download. */
  embedTextsImpl?: (texts: string[]) => Promise<number[][]>;
  onProgress?: (event: {
    processed: number;
    embedded: number;
    skipped: number;
    failed: number;
    lastId?: string;
  }) => void;
};

export type BatchEmbedFailure = {
  id: string;
  message: string;
  diagnostic?: GeminiEmbedDiagnostic;
  /** Content length only — never the document text. */
  contentChars?: number;
};

export type BatchEmbedResult = {
  processed: number;
  embedded: number;
  skipped: number;
  failed: number;
  provider: EmbeddingProviderName;
  failures: BatchEmbedFailure[];
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Default concurrency for batch API waves — sequential is safest under Gemini quota. */
export const DEFAULT_EMBED_CONCURRENCY = 1 as const;

/** Default texts per Gemini `:batchEmbedContents` request (well under the 100 hard cap). */
export const DEFAULT_EMBED_BATCH_SIZE = 16 as const;

/** Default texts per local/gte CPU batch (no cloud cap; keep memory bounded). */
export const DEFAULT_LOCAL_EMBED_BATCH_SIZE = 32 as const;

/** Soft memory cap for local / gte CPU batches. */
export const LOCAL_EMBED_BATCH_MAX = 64 as const;

/** Default texts per gte-small CPU batch (slightly smaller for 5k full runs). */
export const DEFAULT_GTE_EMBED_BATCH_SIZE = 16 as const;

/** Default attempts for 429 / transient 5xx recovery. */
export const DEFAULT_EMBED_MAX_ATTEMPTS = 6 as const;

/**
 * Retry Gemini embeds on rate_limit / server / network only.
 * Permanent 4xx (auth, invalid_argument, not_found, permission) are not retried.
 * Respects Retry-After when present; otherwise exponential backoff + jitter.
 */
export async function embedTextWithRetries(
  text: string,
  apiKey: string,
  options: {
    fetchImpl?: typeof fetch;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<
  | { ok: true; embedding: number[]; attempts: number }
  | { ok: false; message: string; diagnostic?: GeminiEmbedDiagnostic; attempts: number }
> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? DEFAULT_EMBED_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastMessage = "Embedding failed.";
  let lastDiagnostic: GeminiEmbedDiagnostic | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const result = await fetchGeminiEmbedding(text, apiKey, fetchImpl);
    if (result.ok) {
      return { ok: true, embedding: result.embedding, attempts };
    }

    lastMessage = result.message;
    lastDiagnostic = result.diagnostic;

    const retryable = result.diagnostic?.retryable === true;
    if (!retryable || attempt === maxAttempts) {
      break;
    }

    const delayMs = computeEmbedBackoffMs(attempt, result.diagnostic?.retryAfterMs ?? null, random);
    await sleep(delayMs);
  }

  return { ok: false, message: lastMessage, diagnostic: lastDiagnostic, attempts };
}

/**
 * Retry Gemini batchEmbedContents for multiple texts (ordered).
 * Retries the whole batch on retryable errors; does not retry permanent 4xx.
 */
export async function embedTextsWithRetries(
  texts: string[],
  apiKey: string,
  options: {
    fetchImpl?: typeof fetch;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<
  | { ok: true; embeddings: number[][]; attempts: number }
  | { ok: false; message: string; diagnostic?: GeminiEmbedDiagnostic; attempts: number }
> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? DEFAULT_EMBED_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastMessage = "Batch embedding failed.";
  let lastDiagnostic: GeminiEmbedDiagnostic | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const result = await fetchGeminiEmbeddingsBatch(texts, apiKey, fetchImpl);
    if (result.ok) {
      return { ok: true, embeddings: result.embeddings, attempts };
    }

    lastMessage = result.message;
    lastDiagnostic = result.diagnostic;

    const retryable = result.diagnostic?.retryable === true;
    if (!retryable || attempt === maxAttempts) {
      break;
    }

    const delayMs = computeEmbedBackoffMs(attempt, result.diagnostic?.retryAfterMs ?? null, random);
    await sleep(delayMs);
  }

  return { ok: false, message: lastMessage, diagnostic: lastDiagnostic, attempts };
}

function clampBatchSize(value: number | undefined, provider: EmbeddingProviderName): number {
  const isCpu = provider === "local" || provider === "gte";
  const raw =
    value ??
    (provider === "gte"
      ? DEFAULT_GTE_EMBED_BATCH_SIZE
      : provider === "local"
        ? DEFAULT_LOCAL_EMBED_BATCH_SIZE
        : DEFAULT_EMBED_BATCH_SIZE);
  const cap = isCpu ? LOCAL_EMBED_BATCH_MAX : GEMINI_BATCH_EMBED_MAX_REQUESTS;
  return Math.max(1, Math.min(raw, cap));
}

type PendingRow = JobCorpusRow & { content: string };

async function persistEmbedding(
  client: CorpusEmbedClient,
  rowId: string,
  embedding: number[],
  provider: EmbeddingProviderName,
): Promise<{ error: { message: string } | null }> {
  const column = embeddingStorageColumn(provider);
  const dims = embeddingDimensions(provider);
  return client
    .from("job_corpus")
    .update({
      [column]: formatEmbeddingForPgvector(embedding, dims),
      updated_at: new Date().toISOString(),
    })
    .eq("id", rowId);
}

/**
 * When a batch hits a permanent validation-style failure, embed each row alone
 * so one bad document does not leave the whole slice pending forever.
 */
async function embedSliceWithSingleFallback(
  slice: PendingRow[],
  apiKey: string,
  options: {
    fetchImpl: typeof fetch;
    maxAttempts: number;
    sleep: (ms: number) => Promise<void>;
    random: () => number;
  },
  result: BatchEmbedResult,
  onProgress?: BatchEmbedOptions["onProgress"],
  client?: CorpusEmbedClient,
): Promise<void> {
  for (const row of slice) {
    result.processed += 1;
    const embedded = await embedTextWithRetries(row.content, apiKey, options);
    if (!embedded.ok) {
      result.failed += 1;
      result.failures.push({
        id: row.id,
        message: embedded.message,
        diagnostic: embedded.diagnostic,
        contentChars: row.content.length,
      });
      if (embedded.diagnostic) {
        console.warn(
          `[rag:embed] fail id=${row.id} attempts=${embedded.attempts} ${formatEmbedDiagnostic(embedded.diagnostic)}`,
        );
      }
      onProgress?.({ ...result, lastId: row.id });
      continue;
    }

    if (!client) {
      result.embedded += 1;
      onProgress?.({ ...result, lastId: row.id });
      continue;
    }

    const { error } = await persistEmbedding(client, row.id, embedded.embedding, "gemini");
    if (error) {
      result.failed += 1;
      result.failures.push({ id: row.id, message: error.message, contentChars: row.content.length });
    } else {
      result.embedded += 1;
    }
    onProgress?.({ ...result, lastId: row.id });
  }
}

async function processOrderedSliceGemini(
  client: CorpusEmbedClient,
  slice: PendingRow[],
  apiKey: string,
  options: {
    fetchImpl: typeof fetch;
    maxAttempts: number;
    sleep: (ms: number) => Promise<void>;
    random: () => number;
  },
  result: BatchEmbedResult,
  onProgress?: BatchEmbedOptions["onProgress"],
): Promise<void> {
  const texts = slice.map((row) => row.content);
  const batch = await embedTextsWithRetries(texts, apiKey, options);

  if (batch.ok) {
    if (batch.embeddings.length !== slice.length) {
      for (const row of slice) {
        result.processed += 1;
        result.failed += 1;
        result.failures.push({
          id: row.id,
          message: "Batch embedding count did not match input order.",
          contentChars: row.content.length,
        });
        onProgress?.({ ...result, lastId: row.id });
      }
      return;
    }

    for (let i = 0; i < slice.length; i++) {
      const row = slice[i]!;
      const embedding = batch.embeddings[i]!;
      result.processed += 1;
      const { error } = await persistEmbedding(client, row.id, embedding, "gemini");
      if (error) {
        result.failed += 1;
        result.failures.push({ id: row.id, message: error.message, contentChars: row.content.length });
      } else {
        result.embedded += 1;
      }
      onProgress?.({ ...result, lastId: row.id });
    }
    return;
  }

  const category = batch.diagnostic?.category;
  const shouldFallbackToSingles =
    batch.diagnostic?.retryable === false &&
    (category === "invalid_argument" || category === "validation" || category === "unexpected_shape");

  if (shouldFallbackToSingles) {
    console.warn(
      `[rag:embed] batch failed (${category}); falling back to single embeds for ${slice.length} row(s)`,
    );
    await embedSliceWithSingleFallback(slice, apiKey, options, result, onProgress, client);
    return;
  }

  for (const row of slice) {
    result.processed += 1;
    result.failed += 1;
    result.failures.push({
      id: row.id,
      message: batch.message,
      diagnostic: batch.diagnostic,
      contentChars: row.content.length,
    });
    if (batch.diagnostic) {
      console.warn(
        `[rag:embed] fail id=${row.id} attempts=${batch.attempts} ${formatEmbedDiagnostic(batch.diagnostic)}`,
      );
    }
    onProgress?.({ ...result, lastId: row.id });
  }
}

async function processOrderedSliceCpu(
  client: CorpusEmbedClient,
  slice: PendingRow[],
  result: BatchEmbedResult,
  provider: "local" | "gte",
  options: {
    embedTextsImpl?: (texts: string[]) => Promise<number[][]>;
  },
  onProgress?: BatchEmbedOptions["onProgress"],
): Promise<void> {
  const texts = slice.map((row) => row.content);
  const batch = await embedTexts(texts, {
    provider,
    embedTextsImpl: options.embedTextsImpl,
  });

  if (!batch.ok || batch.embeddings.length !== slice.length) {
    for (const row of slice) {
      result.processed += 1;
      result.failed += 1;
      result.failures.push({
        id: row.id,
        message: batch.ok
          ? "Embedding count did not match input order."
          : batch.message,
        contentChars: row.content.length,
      });
      onProgress?.({ ...result, lastId: row.id });
    }
    return;
  }

  const dims = embeddingDimensions(provider);
  for (let i = 0; i < slice.length; i++) {
    const row = slice[i]!;
    const embedding = batch.embeddings[i]!;
    result.processed += 1;
    if (!hasValidEmbedding(embedding, dims)) {
      result.failed += 1;
      result.failures.push({
        id: row.id,
        message: `Provider returned a vector that is not ${dims}-dimensional.`,
        contentChars: row.content.length,
      });
      onProgress?.({ ...result, lastId: row.id });
      continue;
    }
    const { error } = await persistEmbedding(client, row.id, embedding, provider);
    if (error) {
      result.failed += 1;
      result.failures.push({ id: row.id, message: error.message, contentChars: row.content.length });
    } else {
      result.embedded += 1;
    }
    onProgress?.({ ...result, lastId: row.id });
  }
}

/**
 * Batch-embed job_corpus rows that lack a valid vector for the chosen provider space.
 * - gemini / local → writes `embedding` (768); pending = embedding IS NULL
 * - gte → writes `embedding_gte` (384) only; never touches `embedding`
 * Failed rows keep the target column NULL for a later resumable run.
 * Server/service-role only — never call from the browser.
 */
export async function batchEmbedJobCorpus(
  client: CorpusEmbedClient,
  options: BatchEmbedOptions = {},
): Promise<BatchEmbedResult> {
  const provider = resolveEmbeddingProvider(options.provider);
  const limit = options.limit ?? 500;
  const batchSize = clampBatchSize(options.batchSize, provider);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_EMBED_CONCURRENCY, 5));
  const pauseMs = options.pauseMs ?? (provider === "gemini" ? 200 : 0);
  const maxAttempts = options.maxAttempts ?? DEFAULT_EMBED_MAX_ATTEMPTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const apiKey = (options.apiKey ?? process.env[GEMINI_SERVER_ENV.apiKey] ?? "").trim();
  const storageColumn = embeddingStorageColumn(provider);
  const dims = embeddingDimensions(provider);

  if (provider === "gemini" && !apiKey && !options.embedTextsImpl) {
    throw new Error(
      `Missing ${GEMINI_SERVER_ENV.apiKey}. Set it in server env, or pass --provider=local or --provider=gte.`,
    );
  }

  // Only request embedding_gte when using the gte space (column added by PROPOSED_0011).
  const selectCols =
    provider === "gte"
      ? "id,content,embedding,embedding_gte,corpus_key,job_id,title,location,category,skills_text,source,is_synthetic"
      : "id,content,embedding,corpus_key,job_id,title,location,category,skills_text,source,is_synthetic";

  // Page pending rows — PostgREST often caps a single range response at ~1000.
  const pageSize = 1000;
  const pendingRows: JobCorpusRow[] = [];
  let from = 0;
  while (pendingRows.length < limit) {
    const take = Math.min(pageSize, limit - pendingRows.length);
    const pending = await client
      .from("job_corpus")
      .select(selectCols)
      .is(storageColumn, null)
      .range(from, from + take - 1);
    if (pending.error) throw new Error(pending.error.message);
    const page = pending.data ?? [];
    if (!page.length) break;
    pendingRows.push(...page);
    if (page.length < take) break;
    from += page.length;
  }

  const result: BatchEmbedResult = {
    processed: 0,
    embedded: 0,
    skipped: 0,
    failed: 0,
    provider,
    failures: [],
  };

  const work: PendingRow[] = [];
  for (const row of pendingRows) {
    const stored =
      provider === "gte" ? (row.embedding_gte ?? null) : row.embedding;
    if (hasValidEmbedding(stored, dims)) {
      result.processed += 1;
      result.skipped += 1;
      options.onProgress?.({ ...result, lastId: row.id });
      continue;
    }
    const content = row.content?.trim();
    if (!content) {
      result.processed += 1;
      result.failed += 1;
      result.failures.push({ id: row.id, message: "Empty content.", contentChars: 0 });
      options.onProgress?.({ ...result, lastId: row.id });
      continue;
    }
    work.push({ ...row, content });
  }

  const retryOpts = { fetchImpl, maxAttempts, sleep, random };
  const waveStep = batchSize * concurrency;

  for (let i = 0; i < work.length; i += waveStep) {
    const waveJobs: Promise<void>[] = [];
    for (let c = 0; c < concurrency; c++) {
      const start = i + c * batchSize;
      const slice = work.slice(start, start + batchSize);
      if (!slice.length) continue;
      if (provider === "local" || provider === "gte") {
        waveJobs.push(
          processOrderedSliceCpu(
            client,
            slice,
            result,
            provider,
            { embedTextsImpl: options.embedTextsImpl },
            options.onProgress,
          ),
        );
      } else if (options.embedTextsImpl) {
        // Test seam on Gemini path without network (still writes 768 embedding column).
        waveJobs.push(
          processOrderedSliceCpu(
            client,
            slice,
            result,
            "local",
            { embedTextsImpl: options.embedTextsImpl },
            options.onProgress,
          ),
        );
      } else {
        waveJobs.push(
          processOrderedSliceGemini(client, slice, apiKey, retryOpts, result, options.onProgress),
        );
      }
    }
    await Promise.all(waveJobs);

    if (i + waveStep < work.length && pauseMs > 0) {
      await sleep(pauseMs);
    }
  }

  return result;
}

/** Skip regenerating when the provider's target column already has a valid vector. */
export function shouldSkipEmbedding(
  row: Pick<JobCorpusRow, "embedding" | "embedding_gte">,
  provider: EmbeddingProviderName | string = "gemini",
): boolean {
  const resolved = resolveEmbeddingProvider(provider);
  const dims = embeddingDimensions(resolved);
  const value = resolved === "gte" ? (row.embedding_gte ?? null) : row.embedding;
  return hasValidEmbedding(value, dims);
}
