import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { GEMINI_EMBEDDING_DIMENSIONS } from "@/lib/ai/gemini";
import { GTE_EMBEDDING_DIMENSIONS } from "@/lib/ai/gte-embed";
import { requireRagServiceEnv } from "@/lib/ai/rag-env";

/**
 * Untyped service-role client for Track 1 corpus tables/RPCs that are not yet
 * in generated Database types. Server/CLI only — never import from browser code.
 */
export function createRagAdminClient(env = requireRagServiceEnv()): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type MigrationProbe = {
  jobCorpusExists: boolean;
  corpusKeyReady: boolean;
  matchFnReady: boolean;
  /** True when embedding_gte + match_job_corpus_gte are available (PROPOSED_0011). */
  gteSpaceReady: boolean;
  message: string;
};

/** Probe whether PROPOSED_0009 + 0010 (+ optional 0011) objects are visible (no secret logging). */
export async function probeRagMigrations(client: SupabaseClient): Promise<MigrationProbe> {
  const tableProbe = await client.from("job_corpus").select("id").limit(1);
  if (tableProbe.error && /relation|does not exist|schema cache|Could not find/i.test(tableProbe.error.message)) {
    return {
      jobCorpusExists: false,
      corpusKeyReady: false,
      matchFnReady: false,
      gteSpaceReady: false,
      message:
        "job_corpus is missing. Manually review and apply PROPOSED_0009_ai_foundation.sql in Supabase, then PROPOSED_0010_rag_corpus.sql.",
    };
  }
  if (tableProbe.error) {
    return {
      jobCorpusExists: false,
      corpusKeyReady: false,
      matchFnReady: false,
      gteSpaceReady: false,
      message: `Could not probe job_corpus: ${tableProbe.error.message}`,
    };
  }

  const keyProbe = await client.from("job_corpus").select("corpus_key").limit(1);
  if (keyProbe.error && /column|schema cache|Could not find/i.test(keyProbe.error.message)) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: false,
      matchFnReady: false,
      gteSpaceReady: false,
      message:
        "job_corpus exists but Track 1 columns are missing. Manually review and apply PROPOSED_0010_rag_corpus.sql in Supabase.",
    };
  }
  if (keyProbe.error) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: false,
      matchFnReady: false,
      gteSpaceReady: false,
      message: `Could not probe corpus_key: ${keyProbe.error.message}`,
    };
  }

  const rpcProbe = await client.rpc("match_job_corpus", {
    query_embedding: Array.from({ length: GEMINI_EMBEDDING_DIMENSIONS }, () => 0),
    match_count: 1,
    filter_category: null,
  });
  if (rpcProbe.error && /function|does not exist|schema cache/i.test(rpcProbe.error.message)) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: true,
      matchFnReady: false,
      gteSpaceReady: false,
      message:
        "match_job_corpus() is missing. Manually review and apply PROPOSED_0010_rag_corpus.sql in Supabase.",
    };
  }

  const matchFnReady = !rpcProbe.error || /embedding|vector|operator/i.test(rpcProbe.error.message);

  const gteColProbe = await client.from("job_corpus").select("embedding_gte").limit(1);
  if (gteColProbe.error && /column|schema cache|Could not find/i.test(gteColProbe.error.message)) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: true,
      matchFnReady,
      gteSpaceReady: false,
      message: matchFnReady
        ? "RAG 0009/0010 appear available. For gte-small (384), apply PROPOSED_0011_gte_small_embeddings.sql."
        : "match_job_corpus() probe failed; review PROPOSED_0010. gte space (0011) not detected.",
    };
  }
  if (gteColProbe.error) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: true,
      matchFnReady,
      gteSpaceReady: false,
      message: `Could not probe embedding_gte: ${gteColProbe.error.message}`,
    };
  }

  const gteRpcProbe = await client.rpc("match_job_corpus_gte", {
    query_embedding: Array.from({ length: GTE_EMBEDDING_DIMENSIONS }, () => 0),
    match_count: 1,
    filter_category: null,
  });
  if (gteRpcProbe.error && /function|does not exist|schema cache/i.test(gteRpcProbe.error.message)) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: true,
      matchFnReady,
      gteSpaceReady: false,
      message:
        "embedding_gte exists but match_job_corpus_gte() is missing. Apply the full PROPOSED_0011_gte_small_embeddings.sql.",
    };
  }

  const gteSpaceReady =
    !gteRpcProbe.error || /embedding|vector|operator/i.test(gteRpcProbe.error.message);

  return {
    jobCorpusExists: true,
    corpusKeyReady: true,
    matchFnReady,
    gteSpaceReady,
    message: gteSpaceReady
      ? "RAG migrations appear available (including gte-small 384 space from PROPOSED_0011)."
      : "RAG 0009/0010 appear available; gte-small space not ready yet.",
  };
}
