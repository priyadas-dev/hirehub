import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  message: string;
};

/** Probe whether PROPOSED_0009 + 0010 objects are visible (no secret logging). */
export async function probeRagMigrations(client: SupabaseClient): Promise<MigrationProbe> {
  const tableProbe = await client.from("job_corpus").select("id").limit(1);
  if (tableProbe.error && /relation|does not exist|schema cache|Could not find/i.test(tableProbe.error.message)) {
    return {
      jobCorpusExists: false,
      corpusKeyReady: false,
      matchFnReady: false,
      message:
        "job_corpus is missing. Manually review and apply PROPOSED_0009_ai_foundation.sql in Supabase, then PROPOSED_0010_rag_corpus.sql.",
    };
  }
  if (tableProbe.error) {
    return {
      jobCorpusExists: false,
      corpusKeyReady: false,
      matchFnReady: false,
      message: `Could not probe job_corpus: ${tableProbe.error.message}`,
    };
  }

  const keyProbe = await client.from("job_corpus").select("corpus_key").limit(1);
  if (keyProbe.error && /column|schema cache|Could not find/i.test(keyProbe.error.message)) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: false,
      matchFnReady: false,
      message:
        "job_corpus exists but Track 1 columns are missing. Manually review and apply PROPOSED_0010_rag_corpus.sql in Supabase.",
    };
  }
  if (keyProbe.error) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: false,
      matchFnReady: false,
      message: `Could not probe corpus_key: ${keyProbe.error.message}`,
    };
  }

  const rpcProbe = await client.rpc("match_job_corpus", {
    query_embedding: Array.from({ length: 768 }, () => 0),
    match_count: 1,
    filter_category: null,
  });
  if (rpcProbe.error && /function|does not exist|schema cache/i.test(rpcProbe.error.message)) {
    return {
      jobCorpusExists: true,
      corpusKeyReady: true,
      matchFnReady: false,
      message:
        "match_job_corpus() is missing. Manually review and apply PROPOSED_0010_rag_corpus.sql in Supabase.",
    };
  }

  return {
    jobCorpusExists: true,
    corpusKeyReady: true,
    matchFnReady: !rpcProbe.error || /embedding|vector|operator/i.test(rpcProbe.error.message),
    message: "RAG migrations appear available for service-role corpus operations.",
  };
}
