/**
 * Maps embedding providers to storage columns, RPCs, and dimensions.
 * Never mix spaces: gemini/local → embedding (768); gte → embedding_gte (384).
 */

import { GEMINI_EMBEDDING_DIMENSIONS, GEMINI_EMBEDDING_MODEL } from "@/lib/ai/gemini";
import { GTE_EMBEDDING_DIMENSIONS, GTE_EMBEDDING_MODEL } from "@/lib/ai/gte-embed";
import { LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_MODEL } from "@/lib/ai/local-embed";

export type EmbeddingProviderName = "gemini" | "local" | "gte";

export type EmbeddingStorageColumn = "embedding" | "embedding_gte";

export type MatchCorpusRpcName = "match_job_corpus" | "match_job_corpus_gte";

export function embeddingDimensions(provider: EmbeddingProviderName): number {
  return provider === "gte" ? GTE_EMBEDDING_DIMENSIONS : GEMINI_EMBEDDING_DIMENSIONS;
}

export function embeddingStorageColumn(provider: EmbeddingProviderName): EmbeddingStorageColumn {
  return provider === "gte" ? "embedding_gte" : "embedding";
}

export function matchCorpusRpcName(provider: EmbeddingProviderName): MatchCorpusRpcName {
  return provider === "gte" ? "match_job_corpus_gte" : "match_job_corpus";
}

export function embeddingModelForProvider(provider: EmbeddingProviderName): string {
  if (provider === "gte") return GTE_EMBEDDING_MODEL;
  if (provider === "local") return LOCAL_EMBEDDING_MODEL;
  return GEMINI_EMBEDDING_MODEL;
}

/** Providers that share the 768-dim `embedding` column (must not mix without reset). */
export function usesLegacy768Space(provider: EmbeddingProviderName): boolean {
  return provider === "gemini" || provider === "local";
}

export function usesGte384Space(provider: EmbeddingProviderName): boolean {
  return provider === "gte";
}

export {
  GEMINI_EMBEDDING_DIMENSIONS,
  GTE_EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_DIMENSIONS,
};
