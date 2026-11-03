-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: Postgres full-text search (FTS) over corpus-only job_corpus rows
--          for hybrid RAG (dense vector + keyword) + app-side re-ranking.
--
-- Depends on: PROPOSED_0009_ai_foundation.sql + PROPOSED_0010_rag_corpus.sql
--             (public.job_corpus with title/content/category/skills_text/location).
--
-- Adds ONLY:
--   job_corpus.search_tsv tsvector (STORED generated) from title/skills/category/location/content
--   GIN index on search_tsv
--   public.search_job_corpus_fts(query_text, match_count, filter_category)
--
-- Does NOT:
--   - alter embeddings / match_job_corpus / match_job_corpus_gte
--   - insert into public.jobs
--   - grant job_corpus / RPC to anon or authenticated
--
-- Access model (mirror 0010/0011):
--   - RLS unchanged (deny by default)
--   - REVOKE ALL on table from PUBLIC / anon / authenticated; GRANT ALL to service_role
--   - New RPC: SECURITY DEFINER, search_path = public
--   - GRANT EXECUTE on search_job_corpus_fts TO service_role only
--
-- Manual apply: Supabase SQL Editor → paste this file → Run (privileged role).
-- Post-apply checks (read-only):
--   SELECT attname FROM pg_attribute
--    WHERE attrelid = 'public.job_corpus'::regclass AND attname = 'search_tsv';
--   SELECT proname FROM pg_proc WHERE proname = 'search_job_corpus_fts';
-- Review on staging before production.

-- ---------------------------------------------------------------------------
-- 1) Generated tsvector (weighted: title A, skills/category B, location C, body D)
-- ---------------------------------------------------------------------------
ALTER TABLE public.job_corpus
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(skills_text, '')), 'B')
    || setweight(to_tsvector('english', coalesce(category, '')), 'B')
    || setweight(to_tsvector('english', coalesce(location, '')), 'C')
    || setweight(to_tsvector('english', coalesce(content, '')), 'D')
  ) STORED;

COMMENT ON COLUMN public.job_corpus.search_tsv IS
  'Weighted english tsvector for hybrid RAG keyword search (PROPOSED_0018).';

CREATE INDEX IF NOT EXISTS job_corpus_search_tsv_gin_idx
  ON public.job_corpus
  USING GIN (search_tsv);

-- Re-assert deny-by-default table grants (idempotent with 0009/0010).
REVOKE ALL ON TABLE public.job_corpus FROM PUBLIC;
REVOKE ALL ON TABLE public.job_corpus FROM anon;
REVOKE ALL ON TABLE public.job_corpus FROM authenticated;
GRANT ALL ON TABLE public.job_corpus TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Server-only FTS search (corpus-only rows: job_id IS NULL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_job_corpus_fts(
  query_text text,
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
  fts_rank double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('english', coalesce(trim(query_text), '')) AS tsq
  )
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
    ts_rank_cd(c.search_tsv, q.tsq)::double precision AS fts_rank
  FROM public.job_corpus c
  CROSS JOIN q
  WHERE c.job_id IS NULL
    AND c.search_tsv IS NOT NULL
    AND q.tsq IS NOT NULL
    AND c.search_tsv @@ q.tsq
    AND (filter_category IS NULL OR c.category = filter_category)
  ORDER BY ts_rank_cd(c.search_tsv, q.tsq) DESC, c.id
  LIMIT GREATEST(1, LEAST(COALESCE(match_count, 10), 50));
$$;

COMMENT ON FUNCTION public.search_job_corpus_fts(text, integer, text) IS
  'Track 1 corpus keyword (FTS) retrieval. Returns corpus docs only (job_id IS NULL). service_role execute only. Pair with dense match_* + app re-rank.';

REVOKE ALL ON FUNCTION public.search_job_corpus_fts(text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_job_corpus_fts(text, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.search_job_corpus_fts(text, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_job_corpus_fts(text, integer, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Rollback sketch (manual; does not touch embeddings / dense RPCs)
-- ---------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.search_job_corpus_fts(text, integer, text);
-- DROP INDEX IF EXISTS public.job_corpus_search_tsv_gin_idx;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS search_tsv;
