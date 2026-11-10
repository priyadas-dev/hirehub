-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: idempotent store for Resend/Svix inbound webhook events (Assessment 3 Phase 4).
--
-- Security model:
-- - No INSERT/UPDATE/DELETE policies for authenticated (service role / Edge Function only).
-- - Optional SELECT for admin only (observability); seekers/recruiters do not read raw events.
-- - payload_meta must stay free of secrets; prefer ids + event type only.
--
-- Depends on: profiles/applications exist (application_id is soft uuid, no FK required so
-- webhook ingest never fails on orphan correlation).
-- Compatible with: PROPOSED_0005+. Apply after webhook Edge Function is ready to write.
--
-- Review on staging before production. Never apply via blind db push.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'resend',
  event_id text NOT NULL,
  email_id text,
  event_type text NOT NULL,
  tracking_status text NOT NULL DEFAULT 'other',
  application_id uuid,
  payload_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_delivery_events_provider_check CHECK (provider = 'resend'),
  CONSTRAINT email_delivery_events_tracking_check CHECK (
    tracking_status = ANY (
      ARRAY['sent', 'opened', 'bounced', 'complained', 'other']
    )
  ),
  CONSTRAINT email_delivery_events_event_id_unique UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS email_delivery_events_application_created_idx
  ON public.email_delivery_events (application_id, created_at DESC)
  WHERE application_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_delivery_events_email_id_idx
  ON public.email_delivery_events (email_id)
  WHERE email_id IS NOT NULL;

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;

-- Admins may read delivery events for support; no client writes.
DROP POLICY IF EXISTS "admins read email delivery events" ON public.email_delivery_events;
CREATE POLICY "admins read email delivery events" ON public.email_delivery_events
  FOR SELECT
  TO authenticated
  USING (public.current_role_is('admin'));

-- No INSERT/UPDATE/DELETE policies for authenticated — Edge Function uses service role.

GRANT SELECT ON public.email_delivery_events TO authenticated;
-- Explicitly no INSERT/UPDATE/DELETE grants for authenticated.
