-- PROPOSED — apply during Auth Phase 2 (Option A Google recruiter claim).
-- Purpose: one-shot job_seeker → recruiter for brand-new Google users without
-- deleting the profiles row (replaces the old app-side delete+insert fallback).
--
-- Eligibility (mirrors src/lib/oauth-signup-role.ts):
--   - profile.role is job_seeker
--   - auth.users.created_at within 15 minutes
--   - auth.identities includes provider = google
--
-- Requires PROPOSED_0007 (protect_profile_role allows updates when auth.uid() IS NULL)
-- so service_role RPC sessions can UPDATE roles. Authenticated clients cannot
-- EXECUTE this function.
--
-- Depends on: 0000 (profiles), 0001 (handle_new_user), PROPOSED_0007.

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
