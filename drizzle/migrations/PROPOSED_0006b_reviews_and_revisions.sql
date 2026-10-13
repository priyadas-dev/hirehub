-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: company/job rejection, approved-job revision workflow, secure admin
-- review RPCs, job status/content protections, and reject/revision notifications.
--
-- Depends on: 0000–0003, PROPOSED_0004, PROPOSED_0005, PROPOSED_0006a (committed).
-- Apply order: 0004 → 0005 → 0006a (COMMIT) → 0006b.
-- Does not weaken existing SELECT RLS. Seekers still only see approved jobs/companies.
--
-- Prerequisite: company_status and job_status already include 'rejected' (0006a).

-- ---------------------------------------------------------------------------
-- review_status + rejection_reason columns
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.review_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS rejection_reason text;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- ---------------------------------------------------------------------------
-- Extend company status protect: owner may resubmit rejected → pending
-- (0004 only allowed admins; 'rejected' enum now exists after 0006a)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_company_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.current_role_is('admin') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'rejected'
     AND NEW.status = 'pending'
     AND NEW.recruiter_id = auth.uid() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only admins can change company status'
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.protect_company_status() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Job status protection (mirror companies)
-- Non-admin may only change approved → closed or rejected → pending.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_job_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.current_role_is('admin') THEN
    RETURN NEW;
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

DROP TRIGGER IF EXISTS jobs_protect_status ON public.jobs;
CREATE TRIGGER jobs_protect_status
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_job_status();

REVOKE ALL ON FUNCTION public.protect_job_status() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Approved job content lock — live fields change only via admin revision apply
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
     ) THEN
    RAISE EXCEPTION 'Approved jobs cannot be edited directly. Submit a revision for admin review.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_protect_approved_content ON public.jobs;
CREATE TRIGGER jobs_protect_approved_content
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_approved_job_content();

REVOKE ALL ON FUNCTION public.protect_approved_job_content() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- job_revisions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  location text,
  job_type public.job_type NOT NULL,
  salary_range text,
  application_deadline date,
  baseline_title text NOT NULL,
  baseline_description text,
  baseline_location text,
  baseline_job_type public.job_type NOT NULL,
  baseline_salary_range text,
  baseline_application_deadline date,
  status public.review_status NOT NULL DEFAULT 'pending',
  rejection_reason text,
  reviewed_by uuid REFERENCES public.profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_revisions_reject_reason_check CHECK (
    status <> 'rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) >= 3)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS job_revisions_one_pending_per_job
  ON public.job_revisions (job_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS job_revisions_status_created_idx
  ON public.job_revisions (status, created_at DESC);

ALTER TABLE public.job_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner or admin read job revisions" ON public.job_revisions;
CREATE POLICY "owner or admin read job revisions" ON public.job_revisions
  FOR SELECT
  TO authenticated
  USING (
    public.current_role_is('admin')
    OR submitted_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = job_id AND j.recruiter_id = auth.uid()
    )
  );

-- No direct INSERT/UPDATE/DELETE for authenticated — use RPCs below.
GRANT SELECT ON public.job_revisions TO authenticated;
GRANT ALL ON public.job_revisions TO service_role;

-- ---------------------------------------------------------------------------
-- Extend company/job notify triggers (rejection_reason now exists)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_company_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    FOR admin_id IN SELECT id FROM public.profiles WHERE role = 'admin'
    LOOP
      PERFORM public.notify_user(
        admin_id, 'company_pending_review', 'Company awaiting review',
        coalesce(NEW.name, 'A company') || ' was submitted for approval.',
        'company', NEW.id, '/admin/companies',
        'company_pending:' || NEW.id::text || ':' || admin_id::text
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id, 'company_approved', 'Company approved',
        coalesce(NEW.name, 'Your company') || ' was approved. You can post jobs when ready.',
        'company', NEW.id, '/recruiter/company',
        'company_approved:' || NEW.id::text
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id, 'company_rejected', 'Company rejected',
        coalesce(NEW.name, 'Your company') || ' was rejected. Reason: '
          || coalesce(NEW.rejection_reason, 'No reason provided.'),
        'company', NEW.id, '/recruiter/company',
        'company_rejected:' || NEW.id::text
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_notify_job_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    FOR admin_id IN SELECT id FROM public.profiles WHERE role = 'admin'
    LOOP
      PERFORM public.notify_user(
        admin_id, 'job_pending_review', 'Job awaiting approval',
        coalesce(NEW.title, 'A job') || ' was submitted for approval.',
        'job', NEW.id, '/admin/jobs',
        'job_pending:' || NEW.id::text || ':' || admin_id::text
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id, 'job_approved', 'Job post approved',
        coalesce(NEW.title, 'Your job') || ' is approved and visible to seekers.',
        'job', NEW.id, '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':approved'
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id, 'job_rejected', 'Job post rejected',
        coalesce(NEW.title, 'Your job') || ' was rejected. Reason: '
          || coalesce(NEW.rejection_reason, 'No reason provided.'),
        'job', NEW.id, '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':rejected'
      );
    ELSIF NEW.status = 'closed' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id, 'job_closed', 'Job post closed',
        coalesce(NEW.title, 'Your job') || ' was closed and is no longer open for applications.',
        'job', NEW.id, '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':closed'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Revision notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_job_revision_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
  job_title text;
  job_recruiter uuid;
BEGIN
  SELECT j.title, j.recruiter_id INTO job_title, job_recruiter
  FROM public.jobs j WHERE j.id = NEW.job_id;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    FOR admin_id IN SELECT id FROM public.profiles WHERE role = 'admin'
    LOOP
      PERFORM public.notify_user(
        admin_id, 'job_revision_pending', 'Job edit awaiting review',
        'Proposed changes to ' || coalesce(job_title, 'a job') || ' need review.',
        'job_revision', NEW.id, '/admin/job-revisions?id=' || NEW.id::text,
        'job_revision_pending:' || NEW.id::text || ':' || admin_id::text
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.notify_user(
        job_recruiter, 'job_revision_approved', 'Job changes approved',
        'Your proposed edits to ' || coalesce(job_title, 'your job') || ' were approved and are now live.',
        'job_revision', NEW.id, '/recruiter/jobs/' || NEW.job_id::text || '/edit',
        'job_revision:' || NEW.id::text || ':approved'
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.notify_user(
        job_recruiter, 'job_revision_rejected', 'Job changes rejected',
        'Your proposed edits to ' || coalesce(job_title, 'your job') || ' were rejected. Reason: '
          || coalesce(NEW.rejection_reason, 'No reason provided.'),
        'job_revision', NEW.id, '/recruiter/jobs/' || NEW.job_id::text || '/edit',
        'job_revision:' || NEW.id::text || ':rejected'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_revisions_notify_events ON public.job_revisions;
CREATE TRIGGER job_revisions_notify_events
  AFTER INSERT OR UPDATE OF status ON public.job_revisions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_job_revision_events();

REVOKE ALL ON FUNCTION public.trg_notify_job_revision_events() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- RPCs: admin company review
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_review_company(
  _company_id uuid,
  _decision text,
  _reason text DEFAULT NULL
) RETURNS public.companies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.companies;
  reason_trim text;
BEGIN
  IF NOT public.current_role_is('admin') THEN
    RAISE EXCEPTION 'Only admins can review companies' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO row FROM public.companies WHERE id = _company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF row.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Company is no longer pending review' USING ERRCODE = 'check_violation';
  END IF;

  IF _decision = 'approve' THEN
    UPDATE public.companies
    SET status = 'approved', rejection_reason = NULL
    WHERE id = _company_id
    RETURNING * INTO row;
  ELSIF _decision = 'reject' THEN
    reason_trim := trim(coalesce(_reason, ''));
    IF length(reason_trim) < 3 THEN
      RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.companies
    SET status = 'rejected', rejection_reason = reason_trim
    WHERE id = _company_id
    RETURNING * INTO row;
  ELSE
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_company(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_company(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPCs: admin pending-job review
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_review_job(
  _job_id uuid,
  _decision text,
  _reason text DEFAULT NULL
) RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.jobs;
  reason_trim text;
BEGIN
  IF NOT public.current_role_is('admin') THEN
    RAISE EXCEPTION 'Only admins can review jobs' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO row FROM public.jobs WHERE id = _job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF row.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Job is no longer pending review' USING ERRCODE = 'check_violation';
  END IF;

  IF _decision = 'approve' THEN
    UPDATE public.jobs
    SET status = 'approved', rejection_reason = NULL
    WHERE id = _job_id
    RETURNING * INTO row;
  ELSIF _decision = 'reject' THEN
    reason_trim := trim(coalesce(_reason, ''));
    IF length(reason_trim) < 3 THEN
      RAISE EXCEPTION 'Rejection reason is required' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.jobs
    SET status = 'rejected', rejection_reason = reason_trim
    WHERE id = _job_id
    RETURNING * INTO row;
  ELSE
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_review_job(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_job(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: recruiter submits revision (live job stays approved/unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_job_revision(
  _job_id uuid,
  _title text,
  _description text,
  _location text,
  _job_type public.job_type,
  _salary_range text,
  _application_deadline date
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

  INSERT INTO public.job_revisions (
    job_id, submitted_by,
    title, description, location, job_type, salary_range, application_deadline,
    baseline_title, baseline_description, baseline_location, baseline_job_type,
    baseline_salary_range, baseline_application_deadline,
    status
  ) VALUES (
    job.id, auth.uid(),
    trim(_title), nullif(trim(coalesce(_description, '')), ''), nullif(trim(coalesce(_location, '')), ''),
    _job_type, nullif(trim(coalesce(_salary_range, '')), ''), _application_deadline,
    job.title, job.description, job.location, job.job_type, job.salary_range, job.application_deadline,
    'pending'
  )
  RETURNING * INTO rev;

  RETURN rev;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_job_revision(uuid, text, text, text, public.job_type, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_job_revision(uuid, text, text, text, public.job_type, text, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: admin reviews revision (atomic apply or reject; live job untouched on reject)
-- ---------------------------------------------------------------------------
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

    -- Admin role satisfies protect_approved_job_content / protect_job_status.
    UPDATE public.jobs
    SET
      title = rev.title,
      description = rev.description,
      location = rev.location,
      job_type = rev.job_type,
      salary_range = rev.salary_range,
      application_deadline = rev.application_deadline,
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

    -- Live job intentionally unchanged.
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

-- Rollback sketch (enums remain):
-- DROP FUNCTION IF EXISTS public.admin_review_job_revision(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.submit_job_revision(uuid, text, text, text, public.job_type, text, date);
-- DROP FUNCTION IF EXISTS public.admin_review_job(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.admin_review_company(uuid, text, text);
-- DROP TRIGGER IF EXISTS job_revisions_notify_events ON public.job_revisions;
-- DROP FUNCTION IF EXISTS public.trg_notify_job_revision_events();
-- DROP TABLE IF EXISTS public.job_revisions;
-- DROP TRIGGER IF EXISTS jobs_protect_approved_content ON public.jobs;
-- DROP TRIGGER IF EXISTS jobs_protect_status ON public.jobs;
-- DROP FUNCTION IF EXISTS public.protect_approved_job_content();
-- DROP FUNCTION IF EXISTS public.protect_job_status();
-- ALTER TABLE public.jobs DROP COLUMN IF EXISTS rejection_reason;
-- ALTER TABLE public.companies DROP COLUMN IF EXISTS rejection_reason;
-- DROP TYPE IF EXISTS public.review_status;
