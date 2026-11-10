-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Supersedes PROPOSED_0023 (enum jobs.category). Hybrid catalog + FK (Phase A).
-- Apply after PROPOSED_0022. Additive; does not weaken existing RLS.
--
-- Default category UUIDs (stable across environments):
-- IT         00000000-0000-4000-8000-000000000001
-- Marketing  00000000-0000-4000-8000-000000000002
-- Finance    00000000-0000-4000-8000-000000000003
-- HR         00000000-0000-4000-8000-000000000004
-- Sales      00000000-0000-4000-8000-000000000005
-- Design     00000000-0000-4000-8000-000000000006
-- Operations 00000000-0000-4000-8000-000000000007
-- Other      00000000-0000-4000-8000-000000000008

-- ---------------------------------------------------------------------------
-- 1) Catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  owner_recruiter_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  name text NOT NULL,
  name_normalized text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_categories_scope_check CHECK (scope = ANY (ARRAY['default', 'recruiter', 'global'])),
  CONSTRAINT job_categories_scope_owner_check CHECK (
    (scope = 'recruiter' AND owner_recruiter_id IS NOT NULL)
    OR (scope <> 'recruiter' AND owner_recruiter_id IS NULL)
  ),
  CONSTRAINT job_categories_name_trim_check CHECK (btrim(name) = name AND length(btrim(name)) >= 1 AND length(name) <= 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS job_categories_default_name_unique
  ON public.job_categories (name_normalized)
  WHERE scope = 'default';

CREATE UNIQUE INDEX IF NOT EXISTS job_categories_global_name_unique
  ON public.job_categories (name_normalized)
  WHERE scope = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS job_categories_recruiter_name_unique
  ON public.job_categories (owner_recruiter_id, name_normalized)
  WHERE scope = 'recruiter';

CREATE INDEX IF NOT EXISTS job_categories_scope_active_idx
  ON public.job_categories (scope, active);

CREATE INDEX IF NOT EXISTS job_categories_owner_idx
  ON public.job_categories (owner_recruiter_id)
  WHERE scope = 'recruiter';

COMMENT ON TABLE public.job_categories IS
  'Hybrid job categories: system defaults, recruiter-private, admin-global.';

-- Seed defaults (idempotent)
INSERT INTO public.job_categories (id, scope, owner_recruiter_id, name, name_normalized, active)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'default', NULL, 'IT', 'it', true),
  ('00000000-0000-4000-8000-000000000002', 'default', NULL, 'Marketing', 'marketing', true),
  ('00000000-0000-4000-8000-000000000003', 'default', NULL, 'Finance', 'finance', true),
  ('00000000-0000-4000-8000-000000000004', 'default', NULL, 'HR', 'hr', true),
  ('00000000-0000-4000-8000-000000000005', 'default', NULL, 'Sales', 'sales', true),
  ('00000000-0000-4000-8000-000000000006', 'default', NULL, 'Design', 'design', true),
  ('00000000-0000-4000-8000-000000000007', 'default', NULL, 'Operations', 'operations', true),
  ('00000000-0000-4000-8000-000000000008', 'default', NULL, 'Other', 'other', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Normalize name + protect defaults + block reserved names
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_categories_set_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.name_normalized := lower(NEW.name);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_categories_set_normalized ON public.job_categories;
CREATE TRIGGER job_categories_set_normalized
  BEFORE INSERT OR UPDATE OF name ON public.job_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.job_categories_set_normalized();

CREATE OR REPLACE FUNCTION public.job_categories_protect_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.scope = 'default' THEN
    RAISE EXCEPTION 'Default job categories cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.scope = 'default' THEN
    RAISE EXCEPTION 'Default job categories cannot be modified' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS job_categories_protect_defaults ON public.job_categories;
CREATE TRIGGER job_categories_protect_defaults
  BEFORE UPDATE OR DELETE ON public.job_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.job_categories_protect_defaults();

CREATE OR REPLACE FUNCTION public.job_categories_block_reserved_names()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scope = 'recruiter' OR NEW.scope = 'global' THEN
    IF EXISTS (
      SELECT 1 FROM public.job_categories c
      WHERE c.name_normalized = NEW.name_normalized
        AND c.scope IN ('default', 'global')
        AND (c.scope = 'default' OR (c.scope = 'global' AND c.active))
        AND (TG_OP = 'INSERT' OR c.id IS DISTINCT FROM NEW.id)
    ) THEN
      RAISE EXCEPTION 'Category name conflicts with a default or global category'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  IF NEW.scope = 'global' AND TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM public.job_categories c
      WHERE c.scope = 'default' AND c.name_normalized = NEW.name_normalized
    ) THEN
      RAISE EXCEPTION 'Category name conflicts with a default category'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_categories_block_reserved_names ON public.job_categories;
CREATE TRIGGER job_categories_block_reserved_names
  BEFORE INSERT OR UPDATE OF name, scope, active ON public.job_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.job_categories_block_reserved_names();

-- ---------------------------------------------------------------------------
-- 3) Assignability helper + jobs FK
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_category_assignable(_category_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.job_categories c
    WHERE c.id = _category_id
      AND (
        c.scope = 'default'
        OR (c.scope = 'global' AND c.active)
        OR (c.scope = 'recruiter' AND c.owner_recruiter_id = _user_id AND c.active)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.job_category_assignable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.job_category_assignable(uuid, uuid) TO authenticated;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_category_id uuid;

UPDATE public.jobs
SET job_category_id = '00000000-0000-4000-8000-000000000008'
WHERE job_category_id IS NULL;

ALTER TABLE public.jobs
  ALTER COLUMN job_category_id SET DEFAULT '00000000-0000-4000-8000-000000000008';

ALTER TABLE public.jobs
  ALTER COLUMN job_category_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_job_category_id_fkey'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_job_category_id_fkey
      FOREIGN KEY (job_category_id) REFERENCES public.job_categories (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.job_category_id IS
  'FK to job_categories; retained when category is deactivated.';

CREATE OR REPLACE FUNCTION public.enforce_jobs_job_category_assignable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_role_is('admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.job_category_id IS NOT DISTINCT FROM NEW.job_category_id THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.job_category_assignable(NEW.job_category_id, auth.uid()) THEN
    RAISE EXCEPTION 'Job category is not assignable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_enforce_job_category ON public.jobs;
CREATE TRIGGER jobs_enforce_job_category
  BEFORE INSERT OR UPDATE OF job_category_id ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_jobs_job_category_assignable();

-- ---------------------------------------------------------------------------
-- 4) crm_contacts.job_categories (Phase A CRM sync)
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS job_categories text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.crm_contacts.job_categories IS
  'Job category labels from applications synced into CRM (union of related jobs).';

-- ---------------------------------------------------------------------------
-- 5) job_revisions carry category FK
-- ---------------------------------------------------------------------------
ALTER TABLE public.job_revisions
  ADD COLUMN IF NOT EXISTS job_category_id uuid;

ALTER TABLE public.job_revisions
  ADD COLUMN IF NOT EXISTS baseline_job_category_id uuid;

UPDATE public.job_revisions
SET
  job_category_id = COALESCE(job_category_id, '00000000-0000-4000-8000-000000000008'),
  baseline_job_category_id = COALESCE(baseline_job_category_id, '00000000-0000-4000-8000-000000000008')
WHERE job_category_id IS NULL OR baseline_job_category_id IS NULL;

ALTER TABLE public.job_revisions
  ALTER COLUMN job_category_id SET DEFAULT '00000000-0000-4000-8000-000000000008';

ALTER TABLE public.job_revisions
  ALTER COLUMN baseline_job_category_id SET DEFAULT '00000000-0000-4000-8000-000000000008';

ALTER TABLE public.job_revisions
  ALTER COLUMN job_category_id SET NOT NULL;

ALTER TABLE public.job_revisions
  ALTER COLUMN baseline_job_category_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_revisions_job_category_id_fkey'
      AND conrelid = 'public.job_revisions'::regclass
  ) THEN
    ALTER TABLE public.job_revisions
      ADD CONSTRAINT job_revisions_job_category_id_fkey
      FOREIGN KEY (job_category_id) REFERENCES public.job_categories (id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'job_revisions_baseline_job_category_id_fkey'
      AND conrelid = 'public.job_revisions'::regclass
  ) THEN
    ALTER TABLE public.job_revisions
      ADD CONSTRAINT job_revisions_baseline_job_category_id_fkey
      FOREIGN KEY (baseline_job_category_id) REFERENCES public.job_categories (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Protect approved job content including job_category_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_approved_job_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved'
     AND NOT public.current_role_is('admin')
     AND (
       NEW.title IS DISTINCT FROM OLD.title
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.location IS DISTINCT FROM OLD.location
       OR NEW.salary_range IS DISTINCT FROM OLD.salary_range
       OR NEW.job_type IS DISTINCT FROM OLD.job_type
       OR NEW.application_deadline IS DISTINCT FROM OLD.application_deadline
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
       OR NEW.job_category_id IS DISTINCT FROM OLD.job_category_id
     ) THEN
    RAISE EXCEPTION 'Approved jobs cannot be edited directly. Submit a revision for admin review.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7) RLS — job_categories
-- ---------------------------------------------------------------------------
ALTER TABLE public.job_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job categories select visible" ON public.job_categories;
CREATE POLICY "job categories select visible" ON public.job_categories
  FOR SELECT TO authenticated
  USING (
    scope = 'default'
    OR (scope = 'global' AND active = true)
    OR (scope = 'recruiter' AND owner_recruiter_id = auth.uid())
    OR (
      public.current_role_is('admin')
      AND scope IN ('default', 'global')
    )
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.job_category_id = job_categories.id
        AND j.recruiter_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.job_category_id = job_categories.id
        AND j.status IN ('approved', 'closed')
    )
  );

DROP POLICY IF EXISTS "job categories recruiter insert private" ON public.job_categories;
CREATE POLICY "job categories recruiter insert private" ON public.job_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_role_is('recruiter')
    AND scope = 'recruiter'
    AND owner_recruiter_id = auth.uid()
  );

DROP POLICY IF EXISTS "job categories admin insert global" ON public.job_categories;
CREATE POLICY "job categories admin insert global" ON public.job_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_role_is('admin')
    AND scope = 'global'
    AND owner_recruiter_id IS NULL
  );

DROP POLICY IF EXISTS "job categories recruiter update own" ON public.job_categories;
CREATE POLICY "job categories recruiter update own" ON public.job_categories
  FOR UPDATE TO authenticated
  USING (scope = 'recruiter' AND owner_recruiter_id = auth.uid())
  WITH CHECK (scope = 'recruiter' AND owner_recruiter_id = auth.uid());

DROP POLICY IF EXISTS "job categories admin update global" ON public.job_categories;
CREATE POLICY "job categories admin update global" ON public.job_categories
  FOR UPDATE TO authenticated
  USING (public.current_role_is('admin') AND scope = 'global')
  WITH CHECK (public.current_role_is('admin') AND scope = 'global');

GRANT SELECT, INSERT, UPDATE ON public.job_categories TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) submit_job_revision / admin_review_job_revision
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_job_revision(uuid, text, text, text, public.job_type, text, date);
DROP FUNCTION IF EXISTS public.submit_job_revision(uuid, text, text, text, public.job_type, text, date, text);

CREATE OR REPLACE FUNCTION public.submit_job_revision(
  _job_id uuid,
  _title text,
  _description text,
  _location text,
  _job_type public.job_type,
  _salary_range text,
  _application_deadline date,
  _job_category_id uuid DEFAULT '00000000-0000-4000-8000-000000000008'
) RETURNS public.job_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job public.jobs;
  rev public.job_revisions;
BEGIN
  IF NOT public.current_role_is('recruiter') THEN
    RAISE EXCEPTION 'Only recruiters can submit job revisions' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO job FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF job.recruiter_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not your job' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF job.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Only approved jobs use the revision workflow' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.job_revisions r WHERE r.job_id = _job_id AND r.status = 'pending') THEN
    RAISE EXCEPTION 'A revision is already pending admin review' USING ERRCODE = 'unique_violation';
  END IF;
  IF trim(coalesce(_title, '')) = '' THEN
    RAISE EXCEPTION 'Title is required' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.job_category_assignable(_job_category_id, auth.uid()) THEN
    RAISE EXCEPTION 'Invalid or unavailable job category' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.job_revisions (
    job_id, submitted_by,
    title, description, location, job_type, salary_range, application_deadline, job_category_id,
    baseline_title, baseline_description, baseline_location, baseline_job_type,
    baseline_salary_range, baseline_application_deadline, baseline_job_category_id,
    status
  ) VALUES (
    job.id, auth.uid(),
    trim(_title), nullif(trim(coalesce(_description, '')), ''), nullif(trim(coalesce(_location, '')), ''),
    _job_type, nullif(trim(coalesce(_salary_range, '')), ''), _application_deadline, _job_category_id,
    job.title, job.description, job.location, job.job_type, job.salary_range, job.application_deadline,
    job.job_category_id,
    'pending'
  )
  RETURNING * INTO rev;

  RETURN rev;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_job_revision(uuid, text, text, text, public.job_type, text, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_job_revision(uuid, text, text, text, public.job_type, text, date, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_job_revision(
  _revision_id uuid,
  _decision text,
  _reason text DEFAULT NULL
) RETURNS public.job_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rev public.job_revisions;
  job public.jobs;
  reason_trim text;
BEGIN
  IF NOT public.current_role_is('admin') THEN
    RAISE EXCEPTION 'Only admins can review job revisions' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO rev FROM public.job_revisions WHERE id = _revision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF rev.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Revision is no longer pending review' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO job FROM public.jobs WHERE id = rev.job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF _decision = 'approve' THEN
    IF job.status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'Live job is not approved; cannot apply revision' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.jobs
    SET
      title = rev.title,
      description = rev.description,
      location = rev.location,
      job_type = rev.job_type,
      salary_range = rev.salary_range,
      application_deadline = rev.application_deadline,
      job_category_id = rev.job_category_id,
      rejection_reason = NULL
    WHERE id = job.id;

    UPDATE public.job_revisions
    SET status = 'approved',
        rejection_reason = NULL,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = rev.id
    RETURNING * INTO rev;

  ELSIF _decision = 'reject' THEN
    reason_trim := trim(coalesce(_reason, ''));
    IF length(reason_trim) < 3 THEN
      RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.job_revisions
    SET status = 'rejected',
        rejection_reason = reason_trim,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = rev.id
    RETURNING * INTO rev;
  ELSE
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN rev;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_job_revision(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_job_revision(uuid, text, text) TO authenticated;
