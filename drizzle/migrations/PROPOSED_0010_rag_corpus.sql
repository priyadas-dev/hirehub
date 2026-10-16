-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: Track 1 RAG foundation — corpus-only rows in public.job_corpus
--          (5,000+ synthetic/public training docs) without touching live jobs.
--
-- Depends on: PROPOSED_0009_ai_foundation.sql (profiles.skills + job_corpus + vector).
--
-- Why this migration exists:
--   0009 required job_id NOT NULL → jobs(id) and embedding NOT NULL, which blocks
--   seeding a RAG corpus without inserting fake live vacancies. Track 1 must
--   store corpus records ONLY in job_corpus and never in public.jobs.
--
-- Changes (additive / relax constraints only):
--   - job_id nullable (NULL = corpus-only RAG doc; non-null = optional live-job link)
--   - embedding nullable until the batch embed pipeline fills it
--   - corpus metadata: corpus_key, title, location, category, skills_text, source, is_synthetic
--   - match_job_corpus() RPC for server-side cosine similarity (service_role only)
--
-- Does NOT:
--   - insert into public.jobs
--   - alter auth / role guards / existing table RLS policies outside job_corpus
--   - grant job_corpus access to anon/authenticated
--
-- Review on staging before production.

-- ---------------------------------------------------------------------------
-- 1) Relax FK / embedding for corpus-only docs
-- ---------------------------------------------------------------------------
ALTER TABLE public.job_corpus
  ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE public.job_corpus
  ALTER COLUMN embedding DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Corpus metadata (IF NOT EXISTS — safe to re-run)
-- ---------------------------------------------------------------------------
ALTER TABLE public.job_corpus
  ADD COLUMN IF NOT EXISTS corpus_key text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS skills_text text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.job_corpus.job_id IS
  'Optional link to a genuine HireHub job. NULL for corpus-only RAG documents (never applyable).';
COMMENT ON COLUMN public.job_corpus.embedding IS
  'Nullable until batch embed fills a validated 768-dim vector. NULL rows are skipped by retrieval.';
COMMENT ON COLUMN public.job_corpus.corpus_key IS
  'Stable external id for upserts (e.g. synthetic:v1:0042). Unique when set.';
COMMENT ON COLUMN public.job_corpus.is_synthetic IS
  'True for generated/demo corpus docs. Never present these as live HireHub vacancies.';

-- UNIQUE allows multiple NULLs (live-linked rows without a corpus_key).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_corpus_corpus_key_unique'
  ) THEN
    ALTER TABLE public.job_corpus
      ADD CONSTRAINT job_corpus_corpus_key_unique UNIQUE (corpus_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS job_corpus_category_idx
  ON public.job_corpus (category);

CREATE INDEX IF NOT EXISTS job_corpus_pending_embed_idx
  ON public.job_corpus (id)
  WHERE embedding IS NULL;

-- Re-assert deny-by-default grants (idempotent with 0009).
REVOKE ALL ON TABLE public.job_corpus FROM PUBLIC;
REVOKE ALL ON TABLE public.job_corpus FROM anon;
REVOKE ALL ON TABLE public.job_corpus FROM authenticated;
GRANT ALL ON TABLE public.job_corpus TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Server-only similarity search (corpus-only rows: job_id IS NULL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_job_corpus(
  query_embedding extensions.vector(768),
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
    (1 - (c.embedding <=> query_embedding))::double precision AS similarity
  FROM public.job_corpus c
  WHERE c.embedding IS NOT NULL
    AND c.job_id IS NULL
    AND (filter_category IS NULL OR c.category = filter_category)
  ORDER BY c.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(COALESCE(match_count, 10), 50));
$$;

COMMENT ON FUNCTION public.match_job_corpus(extensions.vector, integer, text) IS
  'Track 1 corpus RAG retrieval. Returns corpus docs only (job_id IS NULL). service_role execute only.';

REVOKE ALL ON FUNCTION public.match_job_corpus(extensions.vector, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_job_corpus(extensions.vector, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.match_job_corpus(extensions.vector, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.match_job_corpus(extensions.vector, integer, text) TO service_role;

-- Rollback sketch:
-- DROP FUNCTION IF EXISTS public.match_job_corpus(extensions.vector, integer, text);
-- DROP INDEX IF EXISTS public.job_corpus_pending_embed_idx;
-- DROP INDEX IF EXISTS public.job_corpus_category_idx;
-- ALTER TABLE public.job_corpus DROP CONSTRAINT IF EXISTS job_corpus_corpus_key_unique;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS is_synthetic;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS source;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS skills_text;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS category;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS location;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS title;
-- ALTER TABLE public.job_corpus DROP COLUMN IF EXISTS corpus_key;
-- (Re-adding NOT NULL on job_id/embedding is unsafe if corpus-only rows exist.)
