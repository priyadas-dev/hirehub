import { z } from "zod";
import type { CorpusMatch } from "@/lib/ai/corpus";
import { isSafeCorpusMatch } from "@/lib/ai/corpus";
import { rerankHybridCandidates } from "@/lib/ai/corpus-rerank";
import {
  embedText,
  resolveEmbeddingProvider,
  type EmbeddingProviderName,
} from "@/lib/ai/embed-provider";
import { matchCorpusRpcName } from "@/lib/ai/embed-space";

export type CorpusRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: CorpusMatch[] | null; error: { message: string } | null }>;
};

const retrieveInputSchema = z.object({
  query: z.string().trim().min(1, "Query is required").max(2000),
  matchCount: z.number().int().min(1).max(50).default(10),
  category: z.string().trim().min(1).max(80).optional(),
});

export type RetrieveCorpusInput = z.input<typeof retrieveInputSchema>;

export type RetrieveCorpusResult =
  | {
      ok: true;
      matches: CorpusMatch[];
      model: string;
      provider: EmbeddingProviderName;
      /** True when Postgres FTS returned candidates that were merged via re-rank. */
      hybrid: boolean;
    }
  | { ok: false; message: string };

function rowToMatch(row: Record<string, unknown>, scoreKey: "similarity" | "fts_rank"): CorpusMatch | null {
  const candidate: CorpusMatch = {
    id: String(row.id),
    corpus_key: (row.corpus_key as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    content: String(row.content ?? ""),
    location: (row.location as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    skills_text: (row.skills_text as string | null) ?? null,
    is_synthetic: row.is_synthetic === true,
    source: (row.source as string | null) ?? null,
    similarity: Number(row[scoreKey]) || 0,
  };
  if (!isSafeCorpusMatch(candidate)) return null;
  return candidate;
}

/**
 * Hybrid retrieval over corpus-only job_corpus rows (job_id IS NULL):
 * dense vector (match_job_corpus / match_job_corpus_gte) + Postgres FTS
 * (search_job_corpus_fts) + RRF/lexical re-rank.
 * Falls back to dense-only when FTS is unavailable.
 * Never returns applyable live jobs.
 */
export async function retrieveCorpusMatches(
  client: CorpusRpcClient,
  input: RetrieveCorpusInput,
  options?: {
    provider?: EmbeddingProviderName | string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
    embedTextsImpl?: (texts: string[]) => Promise<number[][]>;
  },
): Promise<RetrieveCorpusResult> {
  const parsed = retrieveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid retrieval input." };
  }

  let provider: EmbeddingProviderName;
  try {
    provider = resolveEmbeddingProvider(options?.provider);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Invalid embedding provider." };
  }

  const embedded = await embedText(parsed.data.query, {
    provider,
    apiKey: options?.apiKey,
    fetchImpl: options?.fetchImpl,
    embedTextsImpl: options?.embedTextsImpl,
  });
  if (!embedded.ok) return { ok: false, message: embedded.message };

  const limit = parsed.data.matchCount;
  const pool = Math.min(50, Math.max(limit * 3, limit));
  const rpcName = matchCorpusRpcName(provider);
  const { data, error } = await client.rpc(rpcName, {
    query_embedding: embedded.embedding,
    match_count: pool,
    filter_category: parsed.data.category ?? null,
  });

  if (error) {
    const gteHint =
      provider === "gte"
        ? " Apply PROPOSED_0011_gte_small_embeddings.sql and embed with --provider=gte first."
        : " Apply PROPOSED_0009 and PROPOSED_0010 in Supabase first.";
    return {
      ok: false,
      message:
        /function|does not exist|schema cache|column|embedding_gte/i.test(error.message)
          ? `Corpus retrieval is not ready yet.${gteHint}`
          : "Corpus retrieval failed. Try again shortly.",
    };
  }

  const vectorHits: CorpusMatch[] = [];
  for (const row of data ?? []) {
    if (!row || typeof row !== "object") continue;
    const match = rowToMatch(row as Record<string, unknown>, "similarity");
    if (match) vectorHits.push(match);
  }

  const ftsResult = await client.rpc("search_job_corpus_fts", {
    query_text: parsed.data.query,
    match_count: pool,
    filter_category: parsed.data.category ?? null,
  });

  const ftsAvailable =
    !ftsResult.error ||
    !/function|does not exist|schema cache/i.test(ftsResult.error.message);

  const ftsHits: CorpusMatch[] = [];
  if (ftsAvailable && !ftsResult.error) {
    for (const row of ftsResult.data ?? []) {
      if (!row || typeof row !== "object") continue;
      const match = rowToMatch(row as Record<string, unknown>, "fts_rank");
      if (match) ftsHits.push(match);
    }
  }

  const hybrid = ftsAvailable && !ftsResult.error;
  const matches = rerankHybridCandidates(vectorHits, hybrid ? ftsHits : [], {
    query: parsed.data.query,
    limit,
  });

  return {
    ok: true,
    matches,
    model: embedded.model,
    provider: embedded.provider,
    hybrid,
  };
}
