-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: persistent in-app notifications for HireHub, generated only by
-- SECURITY DEFINER triggers (never from client-supplied recipient IDs).
--
-- Security model:
-- - Recipients can SELECT their own rows.
-- - Recipients may UPDATE only via RLS (own rows) AND a BEFORE UPDATE trigger
--   that rejects any change except to read_at (blocks tampering with
--   recipient_id, title, body, type, dedupe_key, and other delivery fields).
-- - No INSERT/DELETE policies and no INSERT/DELETE grants for authenticated.
-- - Triggers insert rows after real status/data events; dedupe_key prevents
--   duplicate notifications on retries.
-- - notify_user and all trg_notify_* revoke PUBLIC EXECUTE (same pattern).
--
-- Notification types below include reject/revision values used by PROPOSED_0006.
-- Reject/revision *triggers* that need rejection_reason / job_revisions live in 0006
-- (they REPLACE the company/job notify functions after columns/tables exist).
--
-- Depends on: 0000 (profiles/companies/jobs/applications + current_role_is).
-- Compatible with: 0001–0003. Apply after PROPOSED_0004; before PROPOSED_0006a/0006b.
--
-- Review on staging before production.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id uuid,
  link_path text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text NOT NULL,
  CONSTRAINT notifications_type_check CHECK (
    type = ANY (
      ARRAY[
        'company_pending_review',
        'company_approved',
        'company_rejected',
        'job_pending_review',
        'job_approved',
        'job_rejected',
        'job_closed',
        'job_revision_pending',
        'job_revision_approved',
        'job_revision_rejected',
        'application_received',
        'application_status',
        'application_submitted'
      ]
    )
  ),
  CONSTRAINT notifications_recipient_dedupe UNIQUE (recipient_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipients read only their own notifications.
DROP POLICY IF EXISTS "recipients read own notifications" ON public.notifications;
CREATE POLICY "recipients read own notifications" ON public.notifications
  FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

-- Recipients may attempt UPDATE only on their own rows.
-- Column lockdown is enforced by protect_notification_update (read_at only).
DROP POLICY IF EXISTS "recipients update own notifications" ON public.notifications;
CREATE POLICY "recipients update own notifications" ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

-- No INSERT/DELETE policies for authenticated — inserts happen via trigger functions below.

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
-- Explicitly no INSERT/DELETE grants for authenticated.

-- ---------------------------------------------------------------------------
-- Enforce: authenticated updates may change only read_at
-- ---------------------------------------------------------------------------
-- Why this prevents tampering:
-- 1) RLS USING/WITH CHECK: caller can only touch rows where recipient_id = auth.uid(),
--    and cannot reassign recipient_id to another user (WITH CHECK fails).
-- 2) This BEFORE UPDATE trigger compares NEW vs OLD and raises if any column other
--    than read_at differs — so title, body, type, dedupe_key, entity_*, link_path,
--    created_at, and id cannot be modified even on the caller's own rows.
-- 3) Delivery path only INSERTs via notify_user (SECURITY DEFINER); it never UPDATEs,
--    so this trigger does not interfere with creating notifications.
CREATE OR REPLACE FUNCTION public.protect_notification_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.link_path IS DISTINCT FROM OLD.link_path
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
  THEN
    RAISE EXCEPTION 'Only read_at may be updated on notifications'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_protect_update ON public.notifications;
CREATE TRIGGER notifications_protect_update
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_notification_update();

REVOKE ALL ON FUNCTION public.protect_notification_update() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Helper: insert one notification (SECURITY DEFINER; skips duplicates)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_user(
  _recipient uuid,
  _type text,
  _title text,
  _body text,
  _entity_type text,
  _entity_id uuid,
  _link_path text,
  _dedupe_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _recipient IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (
    recipient_id, type, title, body, entity_type, entity_id, link_path, dedupe_key
  )
  VALUES (
    _recipient, _type, _title, _body, _entity_type, _entity_id, _link_path, _dedupe_key
  )
  ON CONFLICT (recipient_id, dedupe_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, text, uuid, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Company: approved → recruiter; insert pending → admins
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_company_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    FOR admin_id IN
      SELECT id FROM public.profiles WHERE role = 'admin'
    LOOP
      PERFORM public.notify_user(
        admin_id,
        'company_pending_review',
        'Company awaiting review',
        coalesce(NEW.name, 'A company') || ' was submitted for approval.',
        'company',
        NEW.id,
        '/admin/companies',
        'company_pending:' || NEW.id::text || ':' || admin_id::text
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'approved' THEN
    PERFORM public.notify_user(
      NEW.recruiter_id,
      'company_approved',
      'Company approved',
      coalesce(NEW.name, 'Your company') || ' was approved. You can post jobs when ready.',
      'company',
      NEW.id,
      '/recruiter/company',
      'company_approved:' || NEW.id::text || ':' || NEW.status
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_notify_events ON public.companies;
CREATE TRIGGER companies_notify_events
  AFTER INSERT OR UPDATE OF status ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_company_events();

REVOKE ALL ON FUNCTION public.trg_notify_company_events() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Jobs: pending insert → admins; approved/closed → recruiter
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_job_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    FOR admin_id IN
      SELECT id FROM public.profiles WHERE role = 'admin'
    LOOP
      PERFORM public.notify_user(
        admin_id,
        'job_pending_review',
        'Job awaiting approval',
        coalesce(NEW.title, 'A job') || ' was submitted for approval.',
        'job',
        NEW.id,
        '/admin/jobs',
        'job_pending:' || NEW.id::text || ':' || admin_id::text
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_approved',
        'Job post approved',
        coalesce(NEW.title, 'Your job') || ' is approved and visible to seekers.',
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':' || NEW.status
      );
    ELSIF NEW.status = 'closed' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_closed',
        'Job post closed',
        coalesce(NEW.title, 'Your job') || ' was closed and is no longer open for applications.',
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':' || NEW.status
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_notify_events ON public.jobs;
CREATE TRIGGER jobs_notify_events
  AFTER INSERT OR UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_job_events();

REVOKE ALL ON FUNCTION public.trg_notify_job_events() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Applications: insert → seeker + recruiter; status change → seeker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_application_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job_title text;
  job_recruiter uuid;
BEGIN
  SELECT j.title, j.recruiter_id
    INTO job_title, job_recruiter
  FROM public.jobs j
  WHERE j.id = NEW.job_id;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify_user(
      NEW.seeker_id,
      'application_submitted',
      'Application submitted',
      'Your application for ' || coalesce(job_title, 'a job') || ' was submitted.',
      'application',
      NEW.id,
      '/seeker/applications/' || NEW.id::text,
      'application_submitted:' || NEW.id::text
    );

    PERFORM public.notify_user(
      job_recruiter,
      'application_received',
      'New application',
      'A candidate applied to ' || coalesce(job_title, 'your job') || '.',
      'application',
      NEW.id,
      '/recruiter/applicants',
      'application_received:' || NEW.id::text
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.notify_user(
      NEW.seeker_id,
      'application_status',
      'Application update',
      'Your application for ' || coalesce(job_title, 'a job') || ' is now ' || NEW.status || '.',
      'application',
      NEW.id,
      '/seeker/applications/' || NEW.id::text,
      'application_status:' || NEW.id::text || ':' || NEW.status
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applications_notify_events ON public.applications;
CREATE TRIGGER applications_notify_events
  AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_application_events();

REVOKE ALL ON FUNCTION public.trg_notify_application_events() FROM PUBLIC;

-- Rollback sketch:
-- DROP TRIGGER IF EXISTS applications_notify_events ON public.applications;
-- DROP TRIGGER IF EXISTS jobs_notify_events ON public.jobs;
-- DROP TRIGGER IF EXISTS companies_notify_events ON public.companies;
-- DROP TRIGGER IF EXISTS notifications_protect_update ON public.notifications;
-- DROP FUNCTION IF EXISTS public.trg_notify_application_events();
-- DROP FUNCTION IF EXISTS public.trg_notify_job_events();
-- DROP FUNCTION IF EXISTS public.trg_notify_company_events();
-- DROP FUNCTION IF EXISTS public.protect_notification_update();
-- DROP FUNCTION IF EXISTS public.notify_user(uuid, text, text, text, text, uuid, text, text);
-- DROP TABLE IF EXISTS public.notifications;
