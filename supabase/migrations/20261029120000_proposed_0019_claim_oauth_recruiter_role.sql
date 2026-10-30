-- Mirror of drizzle/migrations/PROPOSED_0019_claim_oauth_recruiter_role.sql
-- Apply via Supabase SQL Editor during Auth Phase 2 if not applied via drizzle.

CREATE OR REPLACE FUNCTION public.claim_oauth_recruiter_role(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
  v_created timestamptz;
  v_has_google boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'invalid_user';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'profile_missing';
  END IF;

  IF v_role = 'recruiter' THEN
    RETURN 'already_recruiter';
  END IF;

  IF v_role = 'admin' THEN
    RETURN 'role_not_eligible';
  END IF;

  IF v_role IS DISTINCT FROM 'job_seeker' THEN
    RETURN 'role_not_eligible';
  END IF;

  SELECT u.created_at INTO v_created
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_created IS NULL THEN
    RETURN 'user_missing';
  END IF;

  IF v_created > now() OR (now() - v_created) > interval '15 minutes' THEN
    RETURN 'outside_claim_window';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.identities i
    WHERE i.user_id = p_user_id
      AND i.provider = 'google'
  ) INTO v_has_google;

  IF NOT v_has_google THEN
    RETURN 'no_google_identity';
  END IF;

  UPDATE public.profiles
  SET role = 'recruiter'
  WHERE id = p_user_id
    AND role = 'job_seeker';

  IF NOT FOUND THEN
    RETURN 'update_failed';
  END IF;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_oauth_recruiter_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_oauth_recruiter_role(uuid) TO service_role;

COMMENT ON FUNCTION public.claim_oauth_recruiter_role(uuid) IS
  'HireHub Auth Phase 2: service_role-only Google recruiter claim; never delete+insert profiles.';
