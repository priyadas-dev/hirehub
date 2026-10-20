-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: additive gte-small (384-dim) embedding space for HireHub RAG.
--
-- Depends on: PROPOSED_0009_ai_foundation.sql + PROPOSED_0010_rag_corpus.sql
--             (public.job_corpus + match_job_corpus(vector(768), …) already live).
--
-- Adds ONLY:
--   job_corpus.embedding_gte extensions.vector(384)  — nullable
--   partial index for pending gte embeds (embedding_gte IS NULL)
--   HNSW index on embedding_gte using extensions.vector_cosine_ops (<=>)
--   public.match_job_corpus_gte(query_embedding vector(384), match_count, filter_category)
--
-- Does NOT:
--   - alter / drop job_corpus.embedding (vector(768))
--   - alter / drop / recreate match_job_corpus
--   - delete corpus rows or overwrite existing 768 vectors
--   - disable RLS or add policies for anon/authenticated
--   - grant job_corpus / new RPC to anon or authenticated
--
-- Access model (mirror 0009/0010 exactly):
--   - job_corpus RLS remains enabled from 0009 (no JWT policies = deny by default)
--   - REVOKE ALL on table from PUBLIC / anon / authenticated; GRANT ALL to service_role
--   - New RPC: SECURITY DEFINER, search_path = public, extensions
--   - REVOKE EXECUTE on new RPC from PUBLIC / anon / authenticated
--   - GRANT EXECUTE on match_job_corpus_gte TO service_role only
--
-- RPC behavior (parity with match_job_corpus):
--   - searches only embedding_gte IS NOT NULL AND job_id IS NULL
--   - optional category filter; ORDER BY cosine distance; LIMIT clamped 1..50
--   - returns same columns as match_job_corpus (id, corpus_key, title, content, …)
--
-- App switch (after embed): EMBEDDING_PROVIDER=gte
-- Rollback (no data loss): EMBEDDING_PROVIDER=gemini|local (uses embedding + match_job_corpus)
--
-- Manual apply: Supabase SQL Editor → paste this file → Run (privileged role).
-- Post-apply checks (read-only):
--   SELECT attname, format_type(atttypid, atttypmod)
--     FROM pg_attribute
--    WHERE attrelid = 'public.job_corpus'::regclass AND attname IN ('embedding','embedding_gte');
--   SELECT proname FROM pg_proc WHERE proname IN ('match_job_corpus','match_job_corpus_gte');
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--    WHERE routine_name = 'match_job_corpus_gte';
-- Review on staging before production.

-- ---------------------------------------------------------------------------
-- 1) Additive 384-dim column (never mix with embedding vector(768))
-- ---------------------------------------------------------------------------
ALTER TABLE public.job_corpus
  ADD COLUMN IF NOT EXISTS embedding_gte extensions.vector(384);

COMMENT ON COLUMN public.job_corpus.embedding_gte IS
  'Nullable 384-dim vector from local Xenova/gte-small (mean pool + L2 normalize). Separate from embedding (768). Never pad/truncate across spaces.';

-- Pending-embed helper index (resumable batch jobs: WHERE embedding_gte IS NULL)
CREATE INDEX IF NOT EXISTS job_corpus_pending_embed_gte_idx
  ON public.job_corpus (id)
  WHERE embedding_gte IS NULL;

-- Cosine HNSW for gte retrieval (safe on empty / mostly-null columns)
CREATE INDEX IF NOT EXISTS job_corpus_embedding_gte_hnsw_idx
  ON public.job_corpus
  USING hnsw (embedding_gte extensions.vector_cosine_ops);

-- Re-assert deny-by-default table grants (idempotent with 0009/0010).
REVOKE ALL ON TABLE public.job_corpus FROM PUBLIC;
REVOKE ALL ON TABLE public.job_corpus FROM anon;
REVOKE ALL ON TABLE public.job_corpus FROM authenticated;
GRANT ALL ON TABLE public.job_corpus TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Server-only similarity search over embedding_gte (corpus-only rows)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_job_corpus_gte(
  query_embedding extensions.vector(384),
  match_count integer DEFAULT 10,
  filter_category text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  corpus_key text,
  title text,
  content text,
  location text,
  category text,
  skills_text text,
  is_synthetic boolean,
  source text,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.corpus_key,
    c.title,
    c.content,
    c.location,
    c.category,
    c.skills_text,
    c.is_synthetic,
    c.source,
    (1 - (c.embedding_gte <=> query_embedding))::double precision AS similarity
  FROM public.job_corpus c
  WHERE c.embedding_gte IS NOT NULL
    AND c.job_id IS NULL
    AND (filter_category IS NULL OR c.category = filter_category)
  ORDER BY c.embedding_gte <=> query_embedding
  LIMIT GREATEST(1, LEAST(COALESCE(match_count, 10), 50));
$$;

COMMENT ON FUNCTION public.match_job_corpus_gte(extensions.vector, integer, text) IS
  'Track 1 corpus RAG retrieval using gte-small 384-dim vectors (embedding_gte). Corpus-only (job_id IS NULL). service_role execute only. Does not use embedding (768).';

REVOKE ALL ON FUNCTION public.match_job_corpus_gte(extensions.vector, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_job_corpus_gte(extensions.vector, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.match_job_corpus_gte(extensions.vector, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_job_corpus_gte(extensions.vector, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Rollback sketch (manual; does not touch embedding / match_job_corpus)
-- WARNING: dropping embedding_gte destroys gte vectors (corpus text rows remain).
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.match_job_corpus_gte(extensions.vector, integer, text);
-- DROP INDEX IF EXISTS public.job_corpus_embedding_gte_hnsw_idx;
-- DROP INDEX IF EXISTS public.job_corpus_pending_embed_gte_idx;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS embedding_gte;
