-- PROPOSED — DO NOT APPLY until explicitly approved.
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
