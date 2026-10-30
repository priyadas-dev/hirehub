-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: Track 0 AI foundation for HireHub Assessment 2.
--
-- Adds (nullable / additive only):
--   profiles.skills — free-text seeker skills (length-capped)
--   public.job_corpus — approved-job document text + vector(768) embeddings
--
-- Does NOT:
--   - seed live jobs or corpus rows
--   - alter auth, role guards, or existing profiles RLS policies
--   - expose Gemini keys (app/server responsibility)
--
-- Embedding model (app): gemini-embedding-001 with outputDimensionality 768
-- (matches vector(768); text-embedding-004 is discontinued).
--
-- Security model for job_corpus:
--   - RLS enabled; no policies for anon/authenticated (deny by default).
--   - Explicit REVOKE from PUBLIC / anon / authenticated.
--   - service_role retains full access for server-side embed + match jobs.
--
-- profiles.skills relies on existing "own or admin update/read profile" policies;
-- ownership is still auth.uid() / admin via current_role_is.
--
-- Depends on: 0000 (profiles, jobs). Compatible with PROPOSED_0004–0008.
-- Review on staging before production.

-- ---------------------------------------------------------------------------
-- 0) pgvector
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1) profiles.skills (additive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS skills text;

-- Length cap (re-runnable): drop then add so IF NOT EXISTS column runs stay safe.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_skills_length_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_skills_length_check
  CHECK (skills IS NULL OR char_length(skills) <= 2000);

COMMENT ON COLUMN public.profiles.skills IS
  'Optional free-text seeker skills for AI matching. Max 2000 characters. Null until set.';

-- ---------------------------------------------------------------------------
-- 2) job_corpus (embedding store for approved jobs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_corpus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_corpus_job_id_unique UNIQUE (job_id),
  CONSTRAINT job_corpus_content_length_check CHECK (char_length(content) BETWEEN 1 AND 20000)
);

COMMENT ON TABLE public.job_corpus IS
  'Server-managed embedding corpus for job matching. Clients must not write rows.';

COMMENT ON COLUMN public.job_corpus.embedding IS
  '768-dim vector from Gemini gemini-embedding-001 (outputDimensionality 768; cosine search).';

CREATE INDEX IF NOT EXISTS job_corpus_job_id_idx
  ON public.job_corpus (job_id);

-- HNSW works on empty tables (unlike IVFFlat, which needs training rows).
CREATE INDEX IF NOT EXISTS job_corpus_embedding_hnsw_idx
  ON public.job_corpus
  USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.job_corpus ENABLE ROW LEVEL SECURITY;

-- Deny-by-default for JWT roles: no SELECT/INSERT/UPDATE/DELETE policies.
DROP POLICY IF EXISTS "service role manages job corpus" ON public.job_corpus;

REVOKE ALL ON TABLE public.job_corpus FROM PUBLIC;
REVOKE ALL ON TABLE public.job_corpus FROM anon;
REVOKE ALL ON TABLE public.job_corpus FROM authenticated;

GRANT ALL ON TABLE public.job_corpus TO service_role;

-- ---------------------------------------------------------------------------
-- Rollback sketch:
-- DROP INDEX IF EXISTS public.job_corpus_embedding_hnsw_idx;
-- DROP INDEX IF EXISTS public.job_corpus_job_id_idx;
-- DROP TABLE IF EXISTS public.job_corpus;
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_skills_length_check;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS skills;
-- (Leave extensions.vector installed — other objects may depend on it.)
