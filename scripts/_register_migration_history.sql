INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261013191020', 'proposed_0006_reviews_and_revisions', ARRAY[$hh_20261013191020$-- PROPOSED — DO NOT APPLY as a single file.
--
-- This monolithic draft was split to satisfy PostgreSQL's rule that enum values
-- added with ALTER TYPE ... ADD VALUE cannot be used until after COMMIT:
--
--   1) PROPOSED_0006a_add_rejected_enum_values.sql   — ADD VALUE only, then COMMIT
--   2) PROPOSED_0006b_reviews_and_revisions.sql      — columns, triggers, RPCs, notifies
--
-- Full apply order: PROPOSED_0004 → PROPOSED_0005 → PROPOSED_0006a → PROPOSED_0006b
--
-- Keep this file only as a pointer so older docs that cite PROPOSED_0006 remain findable.
$hh_20261013191020$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261013191020' OR name = 'proposed_0006_reviews_and_revisions'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090001', 'proposed_0007_bootstrap_admin_role_guard', ARRAY[$hh_20261014090001$-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: allow the first admin to be set from the Supabase SQL Editor / service role.
--
-- Problem: protect_profile_role() previously blocked ANY role change when
-- auth.uid() is NULL (typical in the Dashboard SQL Editor). That made it
-- impossible to bootstrap the first admin without disabling the trigger.
--
-- Authenticated users still cannot promote themselves: when a JWT is present,
-- only an existing admin (current_role_is('admin')) may change roles.
-- RLS still blocks non-owners without a JWT; only service_role/postgres
-- bypasses RLS in the SQL Editor.
--
-- Depends on: 0000 (profiles, protect_profile_role, current_role_is).
-- Independent of PROPOSED_0004–0006b (can apply before or after).

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Signed-in callers: only admins may change roles.
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.current_role_is('admin') THEN
      RAISE EXCEPTION 'Only admins can change roles'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- No JWT (Dashboard SQL Editor / service role): allow bootstrap updates.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_role() FROM PUBLIC;

-- One-time bootstrap (run as SQL Editor after this function is replaced):
--   UPDATE public.profiles
--   SET role = 'admin'
--   WHERE email = 'YOUR_ADMIN_EMAIL@example.com';
--
-- Rollback sketch:
-- Restore the prior function body that always required current_role_is('admin').
$hh_20261014090001$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090001' OR name = 'proposed_0007_bootstrap_admin_role_guard'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090002', 'proposed_0008_secure_resume_portfolio_company_logos', ARRAY[$hh_20261014090002$-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: secure private Storage for resumes + company logos, plus metadata columns.
--
-- Adds (nullable; additive only):
--   profiles.resume_storage_path, profiles.resume_file_name
--   applications.resume_storage_path, applications.resume_file_name, applications.portfolio_url
--   companies.logo_url
--
-- Creates private Storage buckets:
--   resumes        — seeker PDFs; path = {seeker_id}/{file}
--   company-logos  — recruiter logos; path = {company_id}/{file}
--
-- Does NOT:
--   - drop or rewrite applications.resume_url (legacy public URL text preserved)
--   - alter existing table RLS policies on profiles/companies/jobs/applications
--   - enable client persistence by itself (app code must stay gated until wired)
--
-- Verified against live HireHub (munqgy) before drafting:
--   current_role_is(_r public.user_role) → job_seeker | recruiter | admin
--   applications has resume_url, cover_note (no portfolio / storage path columns yet)
--   companies has name/industry/website/status (no logo_url yet)
--   profiles has id/full_name/email/role/phone (no resume storage columns yet)
--   storage.buckets is empty
--
-- Signed URLs (app/server responsibility, not SQL):
--   supabase.storage.from('resumes').createSignedUrl(path, ttlSeconds)
--   supabase.storage.from('company-logos').createSignedUrl(path, ttlSeconds)
--   Prefer short TTL (e.g. 60–300s). Never store long-lived signed URLs in the DB.
--   createSignedUrl still requires a passing Storage SELECT policy for the caller
--   (or a trusted Edge Function using the service role with fixed TTL).
--
-- Public job-page logos (anonymous visitors):
--   Buckets stay private (public = false). Anon may SELECT objects only when the
--   path folder is an approved company's id — enough for createSignedUrl / download
--   of that object. Do not make the bucket public.
--
-- Legacy compatibility:
--   Keep reading applications.resume_url for older rows.
--   New uploads should set resume_storage_path + resume_file_name and may leave
--   resume_url null (never store a permanent signed URL there).
--   companies.logo_url stores the Storage object path ({company_id}/{file}) or a
--   legacy external https URL until migrated.
--
-- Depends on: 0000 (profiles, companies, jobs, applications, current_role_is).
-- Review on staging before production.

-- ---------------------------------------------------------------------------
-- 0) Path helpers (IMMUTABLE — used in Storage policies and CHECKs)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.storage_first_folder(object_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(split_part(object_name, '/', 1), '');
$$;

-- Exactly one slash: {uuid-or-id}/{filename} (no nested folders, no traversal).
-- IMPORTANT: position('..' IN …) rejects ANY '..' substring, including inside
-- filenames (e.g. report..pdf). App sanitizeUploadFileName collapses such runs.
CREATE OR REPLACE FUNCTION public.storage_path_is_safe(object_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    object_name IS NOT NULL
    AND length(object_name) BETWEEN 3 AND 512
    AND position('..' IN object_name) = 0
    AND position(chr(92) IN object_name) = 0
    AND object_name !~ '[[:space:]]'
    AND object_name ~ '^[^/]+/[^/]+$'
    AND public.storage_first_folder(object_name) IS NOT NULL;
$$;

COMMENT ON FUNCTION public.storage_path_is_safe(text) IS
  'Requires exactly {folder}/{file}; rejects .. (any substring), backslash, spaces, and nested paths.';

-- Callable from Storage RLS for authenticated + anonymous signed-URL minting.
GRANT EXECUTE ON FUNCTION public.storage_first_folder(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_path_is_safe(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1) Additive columns (IF NOT EXISTS — safe to re-run column section)
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS resume_storage_path text,
  ADD COLUMN IF NOT EXISTS resume_file_name text;

COMMENT ON COLUMN public.profiles.resume_storage_path IS
  'Private Storage object name in bucket resumes ({seeker_id}/{file}). Null until upload wired.';
COMMENT ON COLUMN public.profiles.resume_file_name IS
  'Original display file name for the preferred seeker resume PDF.';

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS resume_storage_path text,
  ADD COLUMN IF NOT EXISTS resume_file_name text,
  ADD COLUMN IF NOT EXISTS portfolio_url text;

COMMENT ON COLUMN public.applications.resume_storage_path IS
  'Private Storage object name in bucket resumes for this application. Exact path used in Storage SELECT RLS.';
COMMENT ON COLUMN public.applications.resume_file_name IS
  'Original display file name for the application resume PDF.';
COMMENT ON COLUMN public.applications.portfolio_url IS
  'Optional seeker portfolio / personal site URL (http/https).';
COMMENT ON COLUMN public.applications.resume_url IS
  'Legacy public resume URL text. Preserved for existing rows; do not delete.';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN public.companies.logo_url IS
  'Private company-logos object path ({company_id}/{file}) or legacy external https URL. Serve via short-lived signed URL when path-based.';

-- Shape + ownership checks (nullable columns still allow NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_portfolio_url_http_chk'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_portfolio_url_http_chk
      CHECK (
        portfolio_url IS NULL
        OR portfolio_url ~* '^https?://'
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_resume_storage_path_owner_chk'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_resume_storage_path_owner_chk
      CHECK (
        resume_storage_path IS NULL
        OR (
          public.storage_path_is_safe(resume_storage_path)
          AND public.storage_first_folder(resume_storage_path) = id::text
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_resume_storage_path_owner_chk'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_resume_storage_path_owner_chk
      CHECK (
        resume_storage_path IS NULL
        OR (
          public.storage_path_is_safe(resume_storage_path)
          AND public.storage_first_folder(resume_storage_path) = seeker_id::text
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_logo_url_shape_chk'
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_logo_url_shape_chk
      CHECK (
        logo_url IS NULL
        OR logo_url ~* '^https?://'
        OR (
          public.storage_path_is_safe(logo_url)
          AND public.storage_first_folder(logo_url) = id::text
        )
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Private Storage buckets (no SVG for logos)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'resumes',
  'resumes',
  false,
  5242880, -- 5 MiB
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos',
  'company-logos',
  false,
  2097152, -- 2 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3) resumes — private; owner / admin / hiring recruiter (exact path + seeker bind)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "resumes_select_owner_admin_or_hiring_recruiter" ON storage.objects;
CREATE POLICY "resumes_select_owner_admin_or_hiring_recruiter"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'resumes'
  AND public.storage_path_is_safe(name)
  AND (
    public.storage_first_folder(name) = auth.uid()::text
    OR public.current_role_is('admin')
    OR EXISTS (
      SELECT 1
      FROM public.applications a
      JOIN public.jobs j ON j.id = a.job_id
      WHERE j.recruiter_id = auth.uid()
        AND a.resume_storage_path IS NOT NULL
        AND a.resume_storage_path = name
        AND a.seeker_id::text = public.storage_first_folder(name)
        AND a.seeker_id::text = public.storage_first_folder(a.resume_storage_path)
    )
  )
);

DROP POLICY IF EXISTS "resumes_insert_job_seeker_own" ON storage.objects;
CREATE POLICY "resumes_insert_job_seeker_own"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'resumes'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('job_seeker')
  AND public.storage_first_folder(name) = auth.uid()::text
);

DROP POLICY IF EXISTS "resumes_update_job_seeker_own" ON storage.objects;
CREATE POLICY "resumes_update_job_seeker_own"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'resumes'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('job_seeker')
  AND public.storage_first_folder(name) = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'resumes'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('job_seeker')
  AND public.storage_first_folder(name) = auth.uid()::text
);

DROP POLICY IF EXISTS "resumes_delete_job_seeker_own" ON storage.objects;
CREATE POLICY "resumes_delete_job_seeker_own"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'resumes'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('job_seeker')
  AND public.storage_first_folder(name) = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- 4) company-logos — private writes; approved-company SELECT for anon + auth
--    (public job pages can mint short-lived signed URLs without a public bucket)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "company_logos_select_owner_admin_or_approved_viewers" ON storage.objects;
DROP POLICY IF EXISTS "company_logos_select_approved_public_job_pages" ON storage.objects;
CREATE POLICY "company_logos_select_approved_public_job_pages"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (
  bucket_id = 'company-logos'
  AND public.storage_path_is_safe(name)
  AND EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id::text = public.storage_first_folder(name)
      AND (
        c.status = 'approved'
        OR c.recruiter_id = auth.uid()
        OR public.current_role_is('admin')
      )
  )
);

DROP POLICY IF EXISTS "company_logos_insert_recruiter_owner" ON storage.objects;
CREATE POLICY "company_logos_insert_recruiter_owner"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'company-logos'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('recruiter')
  AND EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id::text = public.storage_first_folder(name)
      AND c.recruiter_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "company_logos_update_recruiter_owner" ON storage.objects;
CREATE POLICY "company_logos_update_recruiter_owner"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('recruiter')
  AND EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id::text = public.storage_first_folder(name)
      AND c.recruiter_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'company-logos'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('recruiter')
  AND EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id::text = public.storage_first_folder(name)
      AND c.recruiter_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "company_logos_delete_recruiter_owner" ON storage.objects;
CREATE POLICY "company_logos_delete_recruiter_owner"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'company-logos'
  AND public.storage_path_is_safe(name)
  AND public.current_role_is('recruiter')
  AND EXISTS (
    SELECT 1
    FROM public.companies c
    WHERE c.id::text = public.storage_first_folder(name)
      AND c.recruiter_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- Rollback sketch (manual; run only if this proposal was applied and must revert)
-- WARNING: deleting buckets destroys uploaded objects. Export first if needed.
-- ---------------------------------------------------------------------------
-- DROP POLICY IF EXISTS "resumes_select_owner_admin_or_hiring_recruiter" ON storage.objects;
-- DROP POLICY IF EXISTS "resumes_insert_job_seeker_own" ON storage.objects;
-- DROP POLICY IF EXISTS "resumes_update_job_seeker_own" ON storage.objects;
-- DROP POLICY IF EXISTS "resumes_delete_job_seeker_own" ON storage.objects;
-- DROP POLICY IF EXISTS "company_logos_select_approved_public_job_pages" ON storage.objects;
-- DROP POLICY IF EXISTS "company_logos_select_owner_admin_or_approved_viewers" ON storage.objects;
-- DROP POLICY IF EXISTS "company_logos_insert_recruiter_owner" ON storage.objects;
-- DROP POLICY IF EXISTS "company_logos_update_recruiter_owner" ON storage.objects;
-- DROP POLICY IF EXISTS "company_logos_delete_recruiter_owner" ON storage.objects;
-- DELETE FROM storage.objects WHERE bucket_id IN ('resumes', 'company-logos');
-- DELETE FROM storage.buckets WHERE id IN ('resumes', 'company-logos');
-- ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_portfolio_url_http_chk;
-- ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_resume_storage_path_owner_chk;
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_resume_storage_path_owner_chk;
-- ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_logo_url_shape_chk;
-- ALTER TABLE public.applications
--   DROP COLUMN IF EXISTS resume_storage_path,
--   DROP COLUMN IF EXISTS resume_file_name,
--   DROP COLUMN IF EXISTS portfolio_url;
--   -- leave applications.resume_url untouched
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS resume_storage_path,
--   DROP COLUMN IF EXISTS resume_file_name;
-- ALTER TABLE public.companies DROP COLUMN IF EXISTS logo_url;
-- DROP FUNCTION IF EXISTS public.storage_path_is_safe(text);
-- DROP FUNCTION IF EXISTS public.storage_first_folder(text);
$hh_20261014090002$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090002' OR name = 'proposed_0008_secure_resume_portfolio_company_logos'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090003', 'proposed_0009_ai_foundation', ARRAY[$hh_20261014090003$-- PROPOSED — DO NOT APPLY until explicitly approved.
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
$hh_20261014090003$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090003' OR name = 'proposed_0009_ai_foundation'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090004', 'proposed_0010_rag_corpus', ARRAY[$hh_20261014090004$-- PROPOSED — DO NOT APPLY until explicitly approved.
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
$hh_20261014090004$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090004' OR name = 'proposed_0010_rag_corpus'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090005', 'proposed_0011_gte_small_embeddings', ARRAY[$hh_20261014090005$-- PROPOSED — DO NOT APPLY until explicitly approved.
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
$hh_20261014090005$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090005' OR name = 'proposed_0011_gte_small_embeddings'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090006', 'proposed_0012_job_skill_match_notifications', ARRAY[$hh_20261014090006$-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: Smart Job Matching Notification (Assessment 2 automation).
--
-- When a job transitions into status = 'approved', notify job seekers whose
-- profiles.skills overlap the job title/description/location/salary/type/company
-- using the same known-skill vocabulary as src/lib/ai/skill-extract.ts.
--
-- Why SECURITY DEFINER (not client-side):
--   profiles.skills is private (RLS: own or admin). Listing other seekers'
--   skills from the browser would weaken RLS. Matching + notify_user inserts
--   stay server-side, same pattern as PROPOSED_0005 / 0006b.
--
-- Changes:
--   1) Extend notifications_type_check with 'job_skill_match'
--   2) Add extract_known_skills / known_skill_overlap helpers
--   3) Add notify_seekers_matching_approved_job + trg_notify_job_skill_matches
--   4) AFTER UPDATE OF status ON jobs → skill-match notify (separate from
--      recruiter job_approved notify in trg_notify_job_events)
--
-- Does NOT:
--   - alter profiles / jobs table schemas
--   - change RLS policies or INSERT grants on notifications
--   - touch embeddings / job_corpus
--   - notify seekers without skills or without skill overlap
--
-- Depends on: PROPOSED_0005 (notifications + notify_user), PROPOSED_0009
--   (profiles.skills). Compatible with PROPOSED_0006b job notify trigger.
-- Review on staging before production.
--
-- Transaction note (this project): PROPOSED_*.sql files do not wrap BEGIN/COMMIT.
-- Apply as one paste/batch in the Supabase SQL Editor so the DROP+ADD of
-- notifications_type_check is atomic for that session. Do not split the
-- constraint rewrite across separate runs. Nested BEGIN/COMMIT is omitted
-- intentionally to match other HireHub proposed migrations.

-- ---------------------------------------------------------------------------
-- 1) Allow notification type job_skill_match
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (
      ARRAY[
        'company_pending_review',
        'company_approved',
        'company_rejected',
        'job_pending_review',
        'job_approved',
        'job_rejected',
        'job_closed',
        'job_revision_pending',
        'job_revision_approved',
        'job_revision_rejected',
        'job_skill_match',
        'application_received',
        'application_status',
        'application_submitted'
      ]
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Known-skill extraction (mirrors src/lib/ai/skill-extract.ts)
-- ---------------------------------------------------------------------------
-- Returns canonical skill labels that literally appear in _text.
CREATE OR REPLACE FUNCTION public.extract_known_skills(_text text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  hay text := lower(coalesce(_text, ''));
  found text[] := '{}';
  seen text[] := '{}';
  -- Longer aliases first so node.js wins over node where both exist.
  aliases text[] := ARRAY[
    'javascript', 'typescript', 'postgresql', 'mongodb', 'kubernetes',
    'networking', 'communication', 'next.js', 'node.js', 'react.js',
    'asp.net', 'tailwind', 'graphql', 'postgres', 'express', 'laravel',
    'django', 'flask', 'spring', 'aspnet', 'dotnet', '.net', 'docker',
    'python', 'kotlin', 'swift', 'redis', 'reactjs', 'nextjs', 'nodejs',
    'vuejs', 'angular', 'mysql', 'mongo', 'azure', 'linux', 'english',
    'support', 'network', 'csharp', 'golang', 'c#', 'c++', 'cpp',
    'php', 'ruby', 'rust', 'java', 'html', 'css', 'rest', 'aws', 'gcp',
    'git', 'noc', 'sql', 'vue', 'go', 'js', 'ts', 'node', 'react', 'k8s'
  ];
  canonicals text[] := ARRAY[
    'JavaScript', 'TypeScript', 'PostgreSQL', 'MongoDB', 'Kubernetes',
    'Networking', 'Communication', 'Next.js', 'Node.js', 'React',
    'ASP.NET', 'Tailwind', 'GraphQL', 'PostgreSQL', 'Express', 'Laravel',
    'Django', 'Flask', 'Spring', 'ASP.NET', '.NET', '.NET', 'Docker',
    'Python', 'Kotlin', 'Swift', 'Redis', 'React', 'Next.js', 'Node.js',
    'Vue', 'Angular', 'MySQL', 'MongoDB', 'Azure', 'Linux', 'English',
    'Support', 'Networking', 'C#', 'Go', 'C#', 'C++', 'C++',
    'PHP', 'Ruby', 'Rust', 'Java', 'HTML', 'CSS', 'REST', 'AWS', 'GCP',
    'Git', 'NOC', 'SQL', 'Vue', 'Go', 'JavaScript', 'TypeScript', 'Node.js',
    'React', 'Kubernetes'
  ];
  i int;
  alias text;
  canon text;
  pattern text;
  escaped text;
BEGIN
  IF length(trim(hay)) = 0 THEN
    RETURN '{}';
  END IF;

  IF array_length(aliases, 1) IS DISTINCT FROM array_length(canonicals, 1) THEN
    RAISE EXCEPTION 'extract_known_skills alias/canonical length mismatch';
  END IF;

  FOR i IN 1 .. array_length(aliases, 1) LOOP
    alias := aliases[i];
    canon := canonicals[i];
    IF lower(canon) = ANY (SELECT lower(x) FROM unnest(seen) AS x) THEN
      CONTINUE;
    END IF;

    -- Escape only metacharacters that appear in known aliases (. and +).
    -- Do not use E'...\\1' replacements: in E-strings \1 is octal SOH, which breaks .net / c++.
    escaped := replace(replace(alias, '.', '\.'), '+', '\+');
    IF char_length(alias) <= 2 THEN
      pattern := '(^|[^a-z0-9])' || escaped || '([^a-z0-9]|$)';
    ELSE
      pattern := '(^|[^a-z0-9+#])' || escaped || '([^a-z0-9+#]|$)';
    END IF;

    IF hay ~* pattern THEN
      found := array_append(found, canon);
      seen := array_append(seen, canon);
    END IF;
  END LOOP;

  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.extract_known_skills(text) FROM PUBLIC;

-- Intersection of known skills present in both seeker skills and job haystack.
CREATE OR REPLACE FUNCTION public.known_skill_overlap(_skills text, _haystack text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT s
      FROM unnest(public.extract_known_skills(_skills)) AS s
      WHERE lower(s) IN (
        SELECT lower(j) FROM unnest(public.extract_known_skills(_haystack)) AS j
      )
    ),
    '{}'::text[]
  );
$$;

REVOKE ALL ON FUNCTION public.known_skill_overlap(text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) Notify matching seekers for one approved job row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_seekers_matching_approved_job(
  _job_id uuid,
  _title text,
  _description text,
  _location text,
  _salary_range text,
  _job_type text,
  _company_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company_name text;
  haystack text;
  seeker record;
  matched text[];
  skill_phrase text;
  body_text text;
  title_text text;
BEGIN
  IF _job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.name INTO company_name
  FROM public.companies c
  WHERE c.id = _company_id;

  haystack := concat_ws(
    E'\n',
    nullif(trim(coalesce(_title, '')), ''),
    nullif(trim(coalesce(_description, '')), ''),
    nullif(trim(coalesce(_location, '')), ''),
    nullif(trim(coalesce(_salary_range, '')), ''),
    nullif(trim(coalesce(_job_type, '')), ''),
    nullif(trim(coalesce(company_name, '')), '')
  );

  IF length(trim(coalesce(haystack, ''))) = 0 THEN
    RETURN;
  END IF;

  title_text := coalesce(nullif(trim(_title), ''), 'a job');

  FOR seeker IN
    SELECT p.id, p.skills
    FROM public.profiles p
    WHERE p.role = 'job_seeker'
      AND p.skills IS NOT NULL
      AND length(trim(p.skills)) > 0
  LOOP
    matched := public.known_skill_overlap(seeker.skills, haystack);
    IF matched IS NULL OR coalesce(array_length(matched, 1), 0) = 0 THEN
      CONTINUE;
    END IF;

    IF array_length(matched, 1) = 1 THEN
      skill_phrase := matched[1];
    ELSIF array_length(matched, 1) = 2 THEN
      skill_phrase := matched[1] || ' and ' || matched[2];
    ELSE
      skill_phrase := matched[1] || ', ' || matched[2] || ', and ' || matched[3];
      IF array_length(matched, 1) > 3 THEN
        skill_phrase := skill_phrase || ' (+more)';
      END IF;
    END IF;

    body_text := title_text || ' was approved and matches your ' || skill_phrase || ' skills.';

    PERFORM public.notify_user(
      seeker.id,
      'job_skill_match',
      'New job matches your skills',
      body_text,
      'job',
      _job_id,
      '/seeker/jobs/' || _job_id::text,
      'job_skill_match:' || _job_id::text || ':' || seeker.id::text
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_seekers_matching_approved_job(uuid, text, text, text, text, text, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4) Trigger: only on transition into approved
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_job_skill_matches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'approved' THEN
    PERFORM public.notify_seekers_matching_approved_job(
      NEW.id,
      NEW.title,
      NEW.description,
      NEW.location,
      NEW.salary_range,
      NEW.job_type::text,
      NEW.company_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_notify_skill_matches ON public.jobs;
CREATE TRIGGER jobs_notify_skill_matches
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_job_skill_matches();

REVOKE ALL ON FUNCTION public.trg_notify_job_skill_matches() FROM PUBLIC;

-- Rollback sketch
--
-- Preferred (non-destructive): stop matching + keep existing seeker rows.
-- Leave notifications_type_check including 'job_skill_match' so historical
-- rows remain valid and visible under existing RLS. Do NOT delete user data.
-- 1) DROP TRIGGER IF EXISTS jobs_notify_skill_matches ON public.jobs;
-- 2) DROP FUNCTION IF EXISTS public.trg_notify_job_skill_matches();
-- 3) DROP FUNCTION IF EXISTS public.notify_seekers_matching_approved_job(uuid, text, text, text, text, text, uuid);
-- 4) DROP FUNCTION IF EXISTS public.known_skill_overlap(text, text);
-- 5) DROP FUNCTION IF EXISTS public.extract_known_skills(text);
--
-- Hard rollback (DESTRUCTIVE — only if you must restore the exact pre-0012
-- CHECK without 'job_skill_match'). Existing rows of that type would violate
-- the old constraint, so they must be removed or retyped first. Prefer soft
-- rollback above. If hard rollback is required, run in one batch:
-- 6) -- DESTRUCTIVE: permanently deletes seeker job_skill_match notifications
--    DELETE FROM public.notifications WHERE type = 'job_skill_match';
--    (Safer alternative before DELETE: UPDATE ... SET type = 'job_approved'
--     only if product accepts reclassification; otherwise keep soft rollback.)
-- 7) ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
-- 8) ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
--      type = ANY (ARRAY[
--        'company_pending_review','company_approved','company_rejected',
--        'job_pending_review','job_approved','job_rejected','job_closed',
--        'job_revision_pending','job_revision_approved','job_revision_rejected',
--        'application_received','application_status','application_submitted'
--      ])
--    );
$hh_20261014090006$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090006' OR name = 'proposed_0012_job_skill_match_notifications'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090007', 'proposed_0013_auto_close_expired_jobs', ARRAY[$hh_20261014090007$-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: Auto-close approved jobs whose application_deadline has passed
-- (Assessment 2 automation — expired job closure).
--
-- Business rule (matches enforce_application_deadline / Asia/Dhaka calendar):
--   UPDATE jobs SET status = 'closed'
--   WHERE status = 'approved'
--     AND application_deadline IS NOT NULL
--     AND application_deadline < (timezone('Asia/Dhaka', now()))::date
--
-- Side effect: existing jobs_notify_events (PROPOSED_0005/0006b) notifies the
-- recruiter with type job_closed and dedupe job_status:{id}:closed.
--
-- Security (fixes service_role + protect_job_status interaction):
--   protect_job_status normally requires admin OR owning recruiter (auth.uid()).
--   Edge Function invokes RPC with the service_role JWT, so auth.uid() is null.
--   This migration REPLACES protect_job_status to add ONE narrow path:
--     - JWT role is service_role (Supabase auth.jwt()->>'role')
--     - transition is ONLY approved → closed
--     - OLD.application_deadline is non-null AND already past Asia/Dhaka today
--   Clients with authenticated JWTs cannot use this path.
--   service_role still cannot reopen jobs or change to other statuses via this branch.
--   A client-settable GUC is intentionally NOT used (forgeable by any session).
--
-- Scheduling (pg_cron is NOT installed on HireHub today):
--   Edge Function `close-expired-jobs` on a schedule with
--   header x-hirehub-cron-secret = CRON_SECRET, calling this RPC via service_role.
--
-- Does NOT:
--   - alter jobs table columns or RLS policies
--   - close pending/rejected jobs
--   - touch embeddings / corpus
--   - grant EXECUTE on the RPC to authenticated/anon
--   - introduce a recruiter closed→approved reopen path (see PROPOSED_0014)
--   - set closed_reason (column added in PROPOSED_0014, which also replaces this RPC)
--
-- Depends on: 0002 (application_deadline), PROPOSED_0006b (protect_job_status),
--   PROPOSED_0005 (notifications optional but recommended for job_closed).
-- Apply PROPOSED_0014 after this file for closed_reason + recruiter reopen.
-- Review on staging first.

-- ---------------------------------------------------------------------------
-- 1) Narrow service_role expiry-close path in protect_job_status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text;
  dhaka_today date;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.current_role_is('admin') THEN
    RETURN NEW;
  END IF;

  -- Trusted scheduler / service_role JWT only: approved → closed when deadline
  -- already expired (Asia/Dhaka). Does not authorize any other transition.
  jwt_role := coalesce(auth.jwt() ->> 'role', '');
  IF jwt_role = 'service_role'
     AND OLD.status = 'approved'
     AND NEW.status = 'closed'
     AND OLD.application_deadline IS NOT NULL THEN
    dhaka_today := (timezone('Asia/Dhaka', now()))::date;
    IF OLD.application_deadline < dhaka_today THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Recruiter may close an approved job.
  IF OLD.status = 'approved' AND NEW.status = 'closed' AND NEW.recruiter_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Recruiter may resubmit a rejected job for review (rejected → pending only).
  IF OLD.status = 'rejected'
     AND NEW.status = 'pending'
     AND NEW.recruiter_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admins can change job approval status'
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.protect_job_status() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2) RPC: close expired approved jobs (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_expired_approved_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed_count integer := 0;
BEGIN
  -- Caller must present a service_role JWT so protect_job_status allows the
  -- approved → closed transition (see branch above). GRANT is service_role only.
  UPDATE public.jobs j
  SET status = 'closed'
  WHERE j.status = 'approved'
    AND j.application_deadline IS NOT NULL
    AND j.application_deadline < (timezone('Asia/Dhaka', now()))::date;

  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

COMMENT ON FUNCTION public.close_expired_approved_jobs() IS
  'Closes approved jobs past application_deadline (Asia/Dhaka). Invoke with service_role JWT only.';

-- Match PROPOSED_0010/0011: Postgres defaults GRANT EXECUTE TO PUBLIC, and
-- Supabase may also grant anon/authenticated via default privileges. Revoke all
-- three so only service_role (Edge Function) can call this mass-close RPC.
REVOKE ALL ON FUNCTION public.close_expired_approved_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_expired_approved_jobs() FROM anon;
REVOKE ALL ON FUNCTION public.close_expired_approved_jobs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_expired_approved_jobs() TO service_role;

-- Rollback sketch (one transaction):
-- 1) DROP FUNCTION IF EXISTS public.close_expired_approved_jobs();
-- 2) Restore protect_job_status from PROPOSED_0006b (admin / owner-close / rejected→pending only)
--    — re-run the protect_job_status definition from 0006b without the service_role branch.
$hh_20261014090007$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090007' OR name = 'proposed_0013_auto_close_expired_jobs'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090008', 'proposed_0014_job_closed_reason', ARRAY[$hh_20261014090008$-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: Record why a job is closed, and allow owning recruiters to
-- explicitly reopen ONLY jobs auto-closed for an expired deadline.
--
-- Apply AFTER PROPOSED_0013 (service_role expiry-close path + RPC).
--
-- Existing closed rows keep closed_reason NULL (= unknown / pre-migration).
-- Those rows are NOT eligible for recruiter expiry-reopen (safe default).
--
-- Changes:
--   1) Additive jobs.closed_reason (nullable) + CHECK
--   2) close_expired_approved_jobs also sets closed_reason = 'expired_deadline'
--   3) protect_job_status: owner may closed→approved only when
--        OLD.closed_reason = 'expired_deadline'
--        AND NEW.application_deadline >= Asia/Dhaka today
--        AND NEW.closed_reason IS NULL
--      (preserves 0013 service_role approved→closed expiry path)
--   4) RPC recruiter_reopen_expired_job(_job_id, _new_deadline) — atomic
--        deadline extend + reopen; explicit action (not silent on deadline edit)
--
-- Does NOT:
--   - guess reasons for existing closed rows
--   - allow reopen of recruiter/admin/unknown closes
--   - weaken RLS (owner/admin UPDATE policies unchanged)
--   - bypass admin approval for pending/rejected flows
--
-- Depends on: 0002 (application_deadline), PROPOSED_0006b, PROPOSED_0013.

-- ---------------------------------------------------------------------------
-- 1) Additive column
-- ---------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS closed_reason text;

ALTER TABLE public.jobs
  DROP CONSTRAINT IF EXISTS jobs_closed_reason_check;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_closed_reason_check
  CHECK (
    closed_reason IS NULL
    OR closed_reason = ANY (ARRAY['expired_deadline', 'recruiter', 'admin']::text[])
  );

COMMENT ON COLUMN public.jobs.closed_reason IS
  'Why status=closed: expired_deadline | recruiter | admin. Null = unknown (e.g. pre-migration). Cleared on reopen.';

-- ---------------------------------------------------------------------------
-- 2) protect_job_status — 0013 paths + expiry reopen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text;
  dhaka_today date;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.current_role_is('admin') THEN
    RETURN NEW;
  END IF;

  dhaka_today := (timezone('Asia/Dhaka', now()))::date;
  jwt_role := coalesce(auth.jwt() ->> 'role', '');

  -- Trusted scheduler (PROPOSED_0013): approved → closed when deadline already past.
  IF jwt_role = 'service_role'
     AND OLD.status = 'approved'
     AND NEW.status = 'closed'
     AND OLD.application_deadline IS NOT NULL
     AND OLD.application_deadline < dhaka_today THEN
    RETURN NEW;
  END IF;

  -- Recruiter may close an approved job (manual).
  IF OLD.status = 'approved' AND NEW.status = 'closed' AND NEW.recruiter_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Recruiter may reopen ONLY expiry-auto-closed jobs with a valid new deadline.
  -- Editing deadline alone (status unchanged) never hits this branch.
  IF OLD.status = 'closed'
     AND NEW.status = 'approved'
     AND NEW.recruiter_id = auth.uid()
     AND OLD.closed_reason = 'expired_deadline'
     AND NEW.closed_reason IS NULL
     AND NEW.application_deadline IS NOT NULL
     AND NEW.application_deadline >= dhaka_today THEN
    RETURN NEW;
  END IF;

  -- Recruiter may resubmit a rejected job for review (rejected → pending only).
  IF OLD.status = 'rejected'
     AND NEW.status = 'pending'
     AND NEW.recruiter_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admins can change job approval status'
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.protect_job_status() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) Auto-close RPC — also stamp closed_reason
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_expired_approved_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed_count integer := 0;
BEGIN
  UPDATE public.jobs j
  SET status = 'closed',
      closed_reason = 'expired_deadline'
  WHERE j.status = 'approved'
    AND j.application_deadline IS NOT NULL
    AND j.application_deadline < (timezone('Asia/Dhaka', now()))::date;

  GET DIAGNOSTICS closed_count = ROW_COUNT;
  RETURN closed_count;
END;
$$;

-- Match PROPOSED_0010/0011 / 0013: strip PUBLIC + anon + authenticated defaults.
REVOKE ALL ON FUNCTION public.close_expired_approved_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_expired_approved_jobs() FROM anon;
REVOKE ALL ON FUNCTION public.close_expired_approved_jobs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_expired_approved_jobs() TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Explicit recruiter reopen (atomic deadline + status)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recruiter_reopen_expired_job(
  _job_id uuid,
  _new_deadline date
) RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.jobs;
  dhaka_today date;
BEGIN
  IF NOT public.current_role_is('recruiter') THEN
    RAISE EXCEPTION 'Only recruiters can reopen expired jobs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _job_id IS NULL OR _new_deadline IS NULL THEN
    RAISE EXCEPTION 'Job id and new deadline are required'
      USING ERRCODE = 'check_violation';
  END IF;

  dhaka_today := (timezone('Asia/Dhaka', now()))::date;
  IF _new_deadline < dhaka_today THEN
    RAISE EXCEPTION 'New deadline must be today or a future date (Asia/Dhaka)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO row FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF row.recruiter_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not your job' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF row.status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'Only closed jobs can be reopened through this flow'
      USING ERRCODE = 'check_violation';
  END IF;

  IF row.closed_reason IS DISTINCT FROM 'expired_deadline' THEN
    RAISE EXCEPTION 'Only jobs closed automatically for an expired deadline can be reopened by the recruiter'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.jobs
  SET application_deadline = _new_deadline,
      status = 'approved',
      closed_reason = NULL
  WHERE id = _job_id
    AND recruiter_id = auth.uid()
    AND status = 'closed'
    AND closed_reason = 'expired_deadline'
  RETURNING * INTO row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job could not be reopened (concurrent update or no longer eligible)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN row;
END;
$$;

-- Recruiter UI calls this with an authenticated JWT. Deny PUBLIC/anon (and any
-- accidental service_role default); do not grant service_role — not required.
REVOKE ALL ON FUNCTION public.recruiter_reopen_expired_job(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recruiter_reopen_expired_job(uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.recruiter_reopen_expired_job(uuid, date) FROM service_role;
GRANT EXECUTE ON FUNCTION public.recruiter_reopen_expired_job(uuid, date) TO authenticated;

-- Rollback sketch
--
-- Preferred (non-destructive): stop reopen + keep column/history.
-- 1) DROP FUNCTION IF EXISTS public.recruiter_reopen_expired_job(uuid, date);
-- 2) Restore close_expired_approved_jobs from PROPOSED_0013 (status only).
-- 3) Restore protect_job_status from PROPOSED_0013 (no recruiter reopen branch).
--    Leave jobs.closed_reason + CHECK in place so existing stamps remain readable.
--
-- Hard rollback (DESTRUCTIVE — drops reason history):
-- 4) ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_closed_reason_check;
-- 5) ALTER TABLE public.jobs DROP COLUMN IF EXISTS closed_reason;
--    Do this only after UI no longer selects/updates closed_reason.
$hh_20261014090008$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090008' OR name = 'proposed_0014_job_closed_reason'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090009', 'proposed_0015_seeker_notify_expiry_close', ARRAY[$hh_20261014090009$-- PROPOSED_0015: Notify applicants when a job is auto-closed for expired deadline.
--
-- Assessment / product: seekers who applied should learn the listing closed
-- because the deadline passed. Recruiter still gets existing job_closed notify.
-- Manual closes (closed_reason recruiter/admin/null) do NOT notify seekers here.
--
-- Depends on: notifications + notify_user (0005), closed_reason (0014).
-- Idempotent: dedupe_key job_expired_closed:{jobId}:{seekerId}

CREATE OR REPLACE FUNCTION public.trg_notify_job_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
  seeker_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    FOR admin_id IN
      SELECT id FROM public.profiles WHERE role = 'admin'
    LOOP
      PERFORM public.notify_user(
        admin_id,
        'job_pending_review',
        'Job awaiting approval',
        coalesce(NEW.title, 'A job') || ' was submitted for approval.',
        'job',
        NEW.id,
        '/admin/jobs',
        'job_pending:' || NEW.id::text || ':' || admin_id::text
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_approved',
        'Job post approved',
        coalesce(NEW.title, 'Your job') || ' is approved and visible to seekers.',
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':approved'
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_rejected',
        'Job post rejected',
        coalesce(NEW.title, 'Your job') || ' was rejected. Reason: '
          || coalesce(NEW.rejection_reason, 'No reason provided.'),
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':rejected'
      );
    ELSIF NEW.status = 'closed' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_closed',
        'Job post closed',
        coalesce(NEW.title, 'Your job') || ' was closed and is no longer open for applications.',
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':closed'
      );

      -- Auto-close only: notify each seeker who applied to this job.
      IF NEW.closed_reason = 'expired_deadline' THEN
        FOR seeker_id IN
          SELECT DISTINCT a.seeker_id
          FROM public.applications a
          WHERE a.job_id = NEW.id
            AND a.seeker_id IS NOT NULL
        LOOP
          PERFORM public.notify_user(
            seeker_id,
            'job_closed',
            'Job listing closed',
            coalesce(NEW.title, 'A job')
              || ' was closed because the application deadline passed.',
            'job',
            NEW.id,
            '/seeker/applications',
            'job_expired_closed:' || NEW.id::text || ':' || seeker_id::text
          );
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_notify_job_events() FROM PUBLIC;

-- Rollback sketch:
-- Restore trg_notify_job_events from the pre-0015 body (recruiter-only on closed).
$hh_20261014090009$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090009' OR name = 'proposed_0015_seeker_notify_expiry_close'
);

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, created_by, idempotency_key, rollback)
SELECT '20261014090010', 'proposed_0016_seeker_read_applied_jobs', ARRAY[$hh_20261014090010$-- PROPOSED_0016: Allow seekers to SELECT jobs (and thus nested company) they applied to,
-- even after the job is closed/rejected. Fixes My Applications showing "Job" / "Company"
-- when RLS hid non-approved jobs from the nested jobs(...) embed.
--
-- Does NOT widen public browse: only rows with an applications row for auth.uid().
-- Existing "public reads approved jobs" stays; policies are OR'd for SELECT.
--
-- Depends on: applications.seeker_id, jobs RLS enabled.
--
-- REQUIRED FOLLOW-UP: PROPOSED_0017_fix_jobs_applications_rls_recursion.sql
-- The raw EXISTS into applications below recurses with applications→jobs RLS
-- (42P17). Do not re-apply this file alone on a live DB; apply 0017 after it.

DROP POLICY IF EXISTS "seeker reads jobs they applied to" ON public.jobs;

CREATE POLICY "seeker reads jobs they applied to" ON public.jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.applications a
      WHERE a.job_id = jobs.id
        AND a.seeker_id = auth.uid()
    )
  );

-- Rollback:
-- DROP POLICY IF EXISTS "seeker reads jobs they applied to" ON public.jobs;
$hh_20261014090010$]::text[], 'priya.das@sjinnovation.com', NULL, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261014090010' OR name = 'proposed_0016_seeker_read_applied_jobs'
);

