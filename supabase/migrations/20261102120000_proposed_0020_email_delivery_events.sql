-- Mirror of drizzle/migrations/PROPOSED_0020_email_delivery_events.sql
-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: idempotent store for Resend/Svix inbound webhook events (Assessment 3 Phase 4).

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

DROP POLICY IF EXISTS "admins read email delivery events" ON public.email_delivery_events;
CREATE POLICY "admins read email delivery events" ON public.email_delivery_events
  FOR SELECT
  TO authenticated
  USING (public.current_role_is('admin'));

GRANT SELECT ON public.email_delivery_events TO authenticated;
