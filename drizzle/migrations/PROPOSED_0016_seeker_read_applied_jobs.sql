-- PROPOSED_0016: Allow seekers to SELECT jobs (and thus nested company) they applied to,
-- even after the job is closed/rejected. Fixes My Applications showing "Job" / "Company"
-- when RLS hid non-approved jobs from the nested jobs(...) embed.
--
-- Does NOT widen public browse: only rows with an applications row for auth.uid().
-- Existing "public reads approved jobs" stays; policies are OR'd for SELECT.
--
-- Depends on: applications.seeker_id, jobs RLS enabled.

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
