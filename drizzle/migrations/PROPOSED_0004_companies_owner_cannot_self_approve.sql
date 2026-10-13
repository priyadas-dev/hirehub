-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: only admins may change companies.status. Recruiters may still edit
-- name/industry/website without changing approval status.
--
-- Does not change schema columns or weaken existing RLS.
-- Depends on: 0000 (companies, current_role_is).
-- Apply before PROPOSED_0005 and PROPOSED_0006a/0006b.
--
-- Note: rejected → pending resubmit is added in PROPOSED_0006b after the
-- 'rejected' enum value exists (do not reference that label here).
--
-- Review on staging before production.

CREATE OR REPLACE FUNCTION public.protect_company_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.current_role_is('admin') THEN
    RAISE EXCEPTION 'Only admins can change company status'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_protect_status ON public.companies;
CREATE TRIGGER companies_protect_status
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_company_status();

REVOKE ALL ON FUNCTION public.protect_company_status() FROM PUBLIC;

-- 0000 policy "owner or admin edits company" is left unchanged (not weakened).

-- Rollback:
-- DROP TRIGGER IF EXISTS companies_protect_status ON public.companies;
-- DROP FUNCTION IF EXISTS public.protect_company_status();
