-- Enforce application deadlines on insert (Asia/Dhaka calendar days).
-- Depends on 0002_jobs_application_deadline (column must exist).
--
-- Combines:
--   1) BEFORE INSERT trigger (defense for all insert paths that fire triggers)
--   2) INSERT RLS WITH CHECK so PostgREST/authenticated clients cannot apply after deadline
--
-- HireHub business timezone: Asia/Dhaka
-- (must match HIREHUB_DEADLINE_TIMEZONE in src/lib/job-fields.ts).
-- Applications stay open through the end of the deadline's Asia/Dhaka calendar day.
-- NULL deadline preserves prior open behavior.
--
-- Existing policy requirements preserved:
--   seeker_id = auth.uid()
--   status = 'applied'
--   current_role_is('job_seeker')
--   job exists with status = 'approved'
--
-- Repo inventory: 0000 defines exactly one INSERT policy on public.applications.
-- Permissive RLS ORs policies; with a single INSERT policy, replacing it cannot be
-- bypassed by another INSERT policy *in this repository*. Live Supabase may have
-- extra policies - verify before claiming production safety.
-- service_role and SECURITY DEFINER paths bypass RLS (unchanged).

CREATE OR REPLACE FUNCTION public.enforce_application_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _deadline date;
BEGIN
  SELECT application_deadline INTO _deadline FROM public.jobs WHERE id = NEW.job_id;
  IF _deadline IS NOT NULL AND (now() AT TIME ZONE 'Asia/Dhaka')::date > _deadline THEN
    RAISE EXCEPTION 'Applications for this job closed on %', _deadline USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS applications_enforce_deadline ON public.applications;
CREATE TRIGGER applications_enforce_deadline
BEFORE INSERT ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.enforce_application_deadline();

DROP POLICY IF EXISTS "seeker applies to approved job" ON public.applications;

CREATE POLICY "seeker applies to approved job" ON public.applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    seeker_id = auth.uid()
    AND status = 'applied'
    AND public.current_role_is('job_seeker')
    AND EXISTS (
      SELECT 1
      FROM public.jobs j
      WHERE j.id = job_id
        AND j.status = 'approved'
        AND (
          j.application_deadline IS NULL
          OR j.application_deadline >= (timezone('Asia/Dhaka', now()))::date
        )
    )
  );
