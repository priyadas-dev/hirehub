-- PROPOSED — DO NOT APPLY until explicitly approved.
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
