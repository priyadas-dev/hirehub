-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: close the PostgREST hole where a recruiter can UPDATE companies.status to 'approved'
-- after the app stopped self-approving. Does not change schema columns.
--
-- Assignment product rule: company stays pending until an admin approves.
-- App code already follows that; this policy hardens the API.
--
-- Review carefully on a staging project before production.

DROP POLICY IF EXISTS "owner or admin edits company" ON public.companies;

CREATE POLICY "owner or admin edits company" ON public.companies
  FOR UPDATE
  TO authenticated
  USING (
    recruiter_id = auth.uid()
    OR public.current_role_is('admin')
  )
  WITH CHECK (
    public.current_role_is('admin')
    OR (
      recruiter_id = auth.uid()
      AND status = (
        SELECT c.status
        FROM public.companies c
        WHERE c.id = companies.id
      )
    )
  );

-- Rollback sketch (restores 0000 policy — no WITH CHECK):
-- DROP POLICY IF EXISTS "owner or admin edits company" ON public.companies;
-- CREATE POLICY "owner or admin edits company" ON public.companies
--   FOR UPDATE TO authenticated
--   USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));
