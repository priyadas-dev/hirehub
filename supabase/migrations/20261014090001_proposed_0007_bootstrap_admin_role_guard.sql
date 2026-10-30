-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: allow the first admin to be set from the Supabase SQL Editor / service role.
--
-- Problem: protect_profile_role() previously blocked ANY role change when
-- auth.uid() is NULL (typical in the Dashboard SQL Editor). That made it
-- impossible to bootstrap the first admin without disabling the trigger.
--
-- Authenticated users still cannot promote themselves: when a JWT is present,
-- only an existing admin (current_role_is('admin')) may change roles.
-- RLS still blocks non-owners without a JWT; only service_role/postgres
-- bypasses RLS in the SQL Editor.
--
-- Depends on: 0000 (profiles, protect_profile_role, current_role_is).
-- Independent of PROPOSED_0004–0006b (can apply before or after).

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Signed-in callers: only admins may change roles.
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.current_role_is('admin') THEN
      RAISE EXCEPTION 'Only admins can change roles'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- No JWT (Dashboard SQL Editor / service role): allow bootstrap updates.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_role() FROM PUBLIC;

-- One-time bootstrap (run as SQL Editor after this function is replaced):
--   UPDATE public.profiles
--   SET role = 'admin'
--   WHERE email = 'YOUR_ADMIN_EMAIL@example.com';
--
-- Rollback sketch:
-- Restore the prior function body that always required current_role_is('admin').
