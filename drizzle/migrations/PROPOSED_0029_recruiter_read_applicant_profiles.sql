-- PROPOSED_0029: Recruiter can read seeker profiles for applicants on own jobs
--
-- Problem: Recruiter Applicants UI selects profiles(full_name,email) via
-- applications.seeker_id → profiles, but RLS "own or admin read profile" hides
-- those rows for recruiters → PostgREST returns profiles: null → UI shows
-- "Applicant".
--
-- Fix: Additive SELECT policy so a recruiter may read a profile only when that
-- person has applied to a job owned by auth.uid(). Admin/own policies unchanged.
--
-- SECURITY: Does not open all profiles to all recruiters. Row-level only;
-- recruiters who already see the application can read that seeker's profile row
-- (same identity they need for pipeline / interview scheduling).
--
-- Recursion: Helper is SECURITY DEFINER reading applications + jobs without
-- re-entering profiles RLS (same pattern as seeker_has_applied_to_job in 0017).
--
-- Depends on: 0000 (profiles, applications, jobs, current_role_is).
-- APPLY: SQL Editor on HireHub when approved. Do NOT blind db push.
-- ROLLBACK: DROP POLICY + DROP FUNCTION (see bottom).

CREATE OR REPLACE FUNCTION public.recruiter_owns_job_for_applicant(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.applications a
    INNER JOIN public.jobs j ON j.id = a.job_id
    WHERE a.seeker_id = _profile_id
      AND j.recruiter_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.recruiter_owns_job_for_applicant(uuid) IS
  'RLS helper: true when auth.uid() owns a job that this profile applied to. SECURITY DEFINER avoids profiles↔applications recursion.';

REVOKE ALL ON FUNCTION public.recruiter_owns_job_for_applicant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recruiter_owns_job_for_applicant(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.recruiter_owns_job_for_applicant(uuid) TO authenticated;

DROP POLICY IF EXISTS "recruiter reads applicant profiles for own jobs" ON public.profiles;

CREATE POLICY "recruiter reads applicant profiles for own jobs"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.recruiter_owns_job_for_applicant(id));

-- Rollback:
-- DROP POLICY IF EXISTS "recruiter reads applicant profiles for own jobs" ON public.profiles;
-- DROP FUNCTION IF EXISTS public.recruiter_owns_job_for_applicant(uuid);
