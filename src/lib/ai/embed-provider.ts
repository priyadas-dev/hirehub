/**
 * Embedding provider switch for HireHub RAG.
 * Corpus embed and query retrieve must use the SAME provider so vectors share one space.
 *
 * EMBEDDING_PROVIDER=gemini (default) | local
 * local = free Xenova 768-dim on-machine (no Gemini quota)
 */

import {
  fetchGeminiEmbedding,
  fetchGeminiEmbeddingsBatch,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_SERVER_ENV,
  type GeminiEmbedDiagnostic,
} from "@/lib/ai/gemini";
import { LOCAL_EMBEDDING_MODEL } from "@/lib/ai/local-embed";

export const EMBEDDING_PROVIDER_ENV = "EMBEDDING_PROVIDER" as const;

export type EmbeddingProviderName = "gemini" | "local";

export type EmbedProviderSuccess = {
  ok: true;
  embeddings: number[][];
  model: string;
  provider: EmbeddingProviderName;
};

export type EmbedProviderFailure = {
  ok: false;
  message: string;
  provider: EmbeddingProviderName;
  diagnostic?: GeminiEmbedDiagnostic;
};

export type EmbedProviderResult = EmbedProviderSuccess | EmbedProviderFailure;

export function resolveEmbeddingProvider(
  override?: string | null,
): EmbeddingProviderName {
  const raw = (override ?? process.env[EMBEDDING_PROVIDER_ENV] ?? "gemini")
    .trim()
    .toLowerCase();
  if (raw === "local") return "local";
  if (raw === "gemini" || raw === "") return "gemini";
  throw new Error(
    `Invalid ${EMBEDDING_PROVIDER_ENV}="${raw}". Use "gemini" or "local".`,
  );
}

export function embeddingModelLabel(provider: EmbeddingProviderName): string {
  return provider === "local" ? LOCAL_EMBEDDING_MODEL : GEMINI_EMBEDDING_MODEL;
}

export type EmbedTextsOptions = {
  provider?: EmbeddingProviderName | string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /** Injected for tests — bypasses Gemini/local network & model download. */
  embedTextsImpl?: (texts: string[]) => Promise<number[][]>;
};

/**
 * Embed one or more texts with the configured provider.
 * Returns embeddings[] in the same order as texts[].
 */
export async function embedTexts(
  texts: string[],
  options: EmbedTextsOptions = {},
): Promise<EmbedProviderResult> {
  const provider = resolveEmbeddingProvider(options.provider);

  if (!texts.length) {
    return { ok: true, embeddings: [], model: embeddingModelLabel(provider), provider };
  }

  if (options.embedTextsImpl) {
    try {
      const embeddings = await options.embedTextsImpl(texts);
      if (embeddings.length !== texts.length) {
        return {
          ok: false,
          message: "Embedding count did not match input order.",
          provider,
        };
      }
      return {
        ok: true,
        embeddings,
        model: embeddingModelLabel(provider),
        provider,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Embedding failed.",
        provider,
      };
    }
  }

  if (provider === "local") {
    try {
      const { embedTextsLocal } = await import("@/lib/ai/local-embed");
      const embeddings = await embedTextsLocal(texts);
      return {
        ok: true,
        embeddings,
        model: LOCAL_EMBEDDING_MODEL,
        provider,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Local embedding failed.",
        provider,
      };
    }
  }

  const apiKey = (options.apiKey ?? process.env[GEMINI_SERVER_ENV.apiKey] ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      message: `Missing ${GEMINI_SERVER_ENV.apiKey}. Set it in server env, or use EMBEDDING_PROVIDER=local.`,
      provider,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  if (texts.length === 1) {
    const result = await fetchGeminiEmbedding(texts[0]!, apiKey, fetchImpl);
    if (!result.ok) {
      return {
        ok: false,
        message: result.message,
        provider,
        diagnostic: result.diagnostic,
      };
    }
    return {
      ok: true,
      embeddings: [result.embedding],
      model: result.model,
      provider,
    };
  }

  const batch = await fetchGeminiEmbeddingsBatch(texts, apiKey, fetchImpl);
  if (!batch.ok) {
    return {
      ok: false,
      message: batch.message,
      provider,
      diagnostic: batch.diagnostic,
    };
  }
  return {
    ok: true,
    embeddings: batch.embeddings,
    model: batch.model,
    provider,
  };
}

export async function embedText(
  text: string,
  options: EmbedTextsOptions = {},
): Promise<
  | { ok: true; embedding: number[]; model: string; provider: EmbeddingProviderName }
  | EmbedProviderFailure
> {
  const result = await embedTexts([text], options);
  if (!result.ok) return result;
  const embedding = result.embeddings[0];
  if (!embedding) {
    return { ok: false, message: "Embedding provider returned no vector.", provider: result.provider };
  }
  return {
    ok: true,
    embedding,
    model: result.model,
    provider: result.provider,
  };
}
