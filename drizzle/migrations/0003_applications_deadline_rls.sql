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