-- PROPOSED_0017: Fix jobs ↔ applications RLS infinite recursion from 0016.
--
-- Problem: "seeker reads jobs they applied to" did EXISTS into applications,
-- while applications SELECT/UPDATE already EXISTS into jobs for recruiter
-- ownership → Postgres 42P17 infinite recursion → HTTP 500 for seeker JWT
-- (assistant live job search, dashboard counts, application embeds).
--
-- Fix: keep 0016 product intent (seekers can SELECT jobs they applied to,
-- including closed/rejected) via a SECURITY DEFINER helper that reads
-- applications without re-entering applications RLS — same pattern as
-- public.current_role_is.
--
-- Depends on: PROPOSED_0016 (policy name), applications.seeker_id, jobs RLS.

CREATE OR REPLACE FUNCTION public.seeker_has_applied_to_job(_job_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.job_id = _job_id
      AND a.seeker_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.seeker_has_applied_to_job(uuid) IS
  'RLS helper: true when auth.uid() has an applications row for the job. SECURITY DEFINER avoids jobs↔applications policy recursion.';

REVOKE ALL ON FUNCTION public.seeker_has_applied_to_job(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seeker_has_applied_to_job(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.seeker_has_applied_to_job(uuid) TO authenticated;

DROP POLICY IF EXISTS "seeker reads jobs they applied to" ON public.jobs;

CREATE POLICY "seeker reads jobs they applied to" ON public.jobs
  FOR SELECT
  TO authenticated
  USING (public.seeker_has_applied_to_job(id));

-- Rollback:
-- DROP POLICY IF EXISTS "seeker reads jobs they applied to" ON public.jobs;
-- DROP FUNCTION IF EXISTS public.seeker_has_applied_to_job(uuid);
-- Note: dropping without replacement removes closed/rejected applied-job
-- visibility for seekers (reverts 0016 product intent).
