import { z } from "zod";
import type { CorpusMatch } from "@/lib/ai/corpus";
import { isSafeCorpusMatch } from "@/lib/ai/corpus";
import {
  embedText,
  resolveEmbeddingProvider,
  type EmbeddingProviderName,
} from "@/lib/ai/embed-provider";

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
  | { ok: true; matches: CorpusMatch[]; model: string; provider: EmbeddingProviderName }
  | { ok: false; message: string };

/**
 * Semantic retrieval over corpus-only job_corpus rows (job_id IS NULL).
 * Uses service-role RPC `match_job_corpus`. Never returns applyable live jobs.
 * Query embedding uses the same EMBEDDING_PROVIDER as bulk corpus embed.
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

  const { data, error } = await client.rpc("match_job_corpus", {
    query_embedding: embedded.embedding,
    match_count: parsed.data.matchCount,
    filter_category: parsed.data.category ?? null,
  });

  if (error) {
    return {
      ok: false,
      message:
        /function|does not exist|schema cache|column/i.test(error.message)
          ? "Corpus retrieval is not ready yet. Apply PROPOSED_0009 and PROPOSED_0010 in Supabase first."
          : "Corpus retrieval failed. Try again shortly.",
    };
  }

  const matches: CorpusMatch[] = [];
  for (const row of data ?? []) {
    if (!row || typeof row !== "object") continue;
    const candidate: CorpusMatch = {
      id: String(row.id),
      corpus_key: row.corpus_key ?? null,
      title: row.title ?? null,
      content: String(row.content ?? ""),
      location: row.location ?? null,
      category: row.category ?? null,
      skills_text: row.skills_text ?? null,
      is_synthetic: row.is_synthetic === true,
      source: row.source ?? null,
      similarity: Number(row.similarity) || 0,
    };
    // Defense in depth: never surface non-corpus / live-looking rows from RAG.
    if (!isSafeCorpusMatch(candidate)) continue;
    matches.push(candidate);
  }

  return { ok: true, matches, model: embedded.model, provider: embedded.provider };
}
