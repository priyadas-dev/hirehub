-- PROPOSED — DO NOT APPLY until explicitly approved.
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
