-- Mirror of drizzle/migrations/PROPOSED_0021_crm_tables.sql
-- PROPOSED — DO NOT APPLY until explicitly approved.
-- See drizzle file for full security commentary.

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies (id) ON DELETE SET NULL,
  seeker_profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  email text NOT NULL,
  email_normalized text NOT NULL,
  full_name text,
  skills text[] NOT NULL DEFAULT '{}'::text[],
  job_interests text[] NOT NULL DEFAULT '{}'::text[],
  application_status text,
  segment_kind text NOT NULL DEFAULT 'new',
  hubspot_contact_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_contacts_segment_kind_check CHECK (
    segment_kind = ANY (ARRAY['new', 'active', 'placed'])
  ),
  CONSTRAINT crm_contacts_application_status_check CHECK (
    application_status IS NULL
    OR application_status = ANY (
      ARRAY['applied', 'shortlisted', 'interview', 'hired', 'rejected']
    )
  ),
  CONSTRAINT crm_contacts_recruiter_email_unique UNIQUE (recruiter_id, email_normalized)
);

CREATE INDEX IF NOT EXISTS crm_contacts_recruiter_created_idx
  ON public.crm_contacts (recruiter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_contacts_recruiter_segment_idx
  ON public.crm_contacts (recruiter_id, segment_kind);

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm contacts owner or admin select" ON public.crm_contacts;
CREATE POLICY "crm contacts owner or admin select" ON public.crm_contacts
  FOR SELECT TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm contacts owner insert" ON public.crm_contacts;
CREATE POLICY "crm contacts owner insert" ON public.crm_contacts
  FOR INSERT TO authenticated
  WITH CHECK (recruiter_id = auth.uid() AND public.current_role_is('recruiter'));

DROP POLICY IF EXISTS "crm contacts owner or admin update" ON public.crm_contacts;
CREATE POLICY "crm contacts owner or admin update" ON public.crm_contacts
  FOR UPDATE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'))
  WITH CHECK (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm contacts owner or admin delete" ON public.crm_contacts;
CREATE POLICY "crm contacts owner or admin delete" ON public.crm_contacts
  FOR DELETE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_contacts TO authenticated;

CREATE TABLE IF NOT EXISTS public.crm_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'new',
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_segments_kind_check CHECK (
    kind = ANY (ARRAY['new', 'active', 'placed'])
  )
);

CREATE INDEX IF NOT EXISTS crm_segments_recruiter_created_idx
  ON public.crm_segments (recruiter_id, created_at DESC);

ALTER TABLE public.crm_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm segments owner or admin select" ON public.crm_segments;
CREATE POLICY "crm segments owner or admin select" ON public.crm_segments
  FOR SELECT TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm segments owner insert" ON public.crm_segments;
CREATE POLICY "crm segments owner insert" ON public.crm_segments
  FOR INSERT TO authenticated
  WITH CHECK (recruiter_id = auth.uid() AND public.current_role_is('recruiter'));

DROP POLICY IF EXISTS "crm segments owner or admin update" ON public.crm_segments;
CREATE POLICY "crm segments owner or admin update" ON public.crm_segments
  FOR UPDATE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'))
  WITH CHECK (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm segments owner or admin delete" ON public.crm_segments;
CREATE POLICY "crm segments owner or admin delete" ON public.crm_segments
  FOR DELETE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_segments TO authenticated;

CREATE TABLE IF NOT EXISTS public.crm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  segment_id uuid REFERENCES public.crm_segments (id) ON DELETE SET NULL,
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  html_body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  send_idempotency_key text,
  confirmed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_campaigns_status_check CHECK (
    status = ANY (ARRAY['draft', 'ready', 'sending', 'sent', 'cancelled'])
  ),
  CONSTRAINT crm_campaigns_send_key_unique UNIQUE (send_idempotency_key)
);

CREATE INDEX IF NOT EXISTS crm_campaigns_recruiter_created_idx
  ON public.crm_campaigns (recruiter_id, created_at DESC);

ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm campaigns owner or admin select" ON public.crm_campaigns;
CREATE POLICY "crm campaigns owner or admin select" ON public.crm_campaigns
  FOR SELECT TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm campaigns owner insert" ON public.crm_campaigns;
CREATE POLICY "crm campaigns owner insert" ON public.crm_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (recruiter_id = auth.uid() AND public.current_role_is('recruiter'));

DROP POLICY IF EXISTS "crm campaigns owner or admin update" ON public.crm_campaigns;
CREATE POLICY "crm campaigns owner or admin update" ON public.crm_campaigns
  FOR UPDATE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'))
  WITH CHECK (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm campaigns owner or admin delete" ON public.crm_campaigns;
CREATE POLICY "crm campaigns owner or admin delete" ON public.crm_campaigns
  FOR DELETE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_campaigns TO authenticated;

CREATE TABLE IF NOT EXISTS public.crm_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.crm_campaigns (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.crm_contacts (id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  email text NOT NULL,
  tracking_status text NOT NULL DEFAULT 'pending',
  resend_email_id text,
  send_idempotency_key text,
  hubspot_sync_ok boolean,
  hubspot_sync_reason text,
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_campaign_recipients_tracking_check CHECK (
    tracking_status = ANY (
      ARRAY[
        'pending',
        'sent',
        'delivered',
        'opened',
        'bounced',
        'complained',
        'replied',
        'applied'
      ]
    )
  ),
  CONSTRAINT crm_campaign_recipients_unique UNIQUE (campaign_id, contact_id),
  CONSTRAINT crm_campaign_recipients_send_key_unique UNIQUE (send_idempotency_key)
);

CREATE INDEX IF NOT EXISTS crm_campaign_recipients_campaign_idx
  ON public.crm_campaign_recipients (campaign_id, tracking_status);
CREATE INDEX IF NOT EXISTS crm_campaign_recipients_recruiter_idx
  ON public.crm_campaign_recipients (recruiter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_campaign_recipients_resend_idx
  ON public.crm_campaign_recipients (resend_email_id)
  WHERE resend_email_id IS NOT NULL;

ALTER TABLE public.crm_campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm recipients owner or admin select" ON public.crm_campaign_recipients;
CREATE POLICY "crm recipients owner or admin select" ON public.crm_campaign_recipients
  FOR SELECT TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm recipients owner insert" ON public.crm_campaign_recipients;
CREATE POLICY "crm recipients owner insert" ON public.crm_campaign_recipients
  FOR INSERT TO authenticated
  WITH CHECK (recruiter_id = auth.uid() AND public.current_role_is('recruiter'));

DROP POLICY IF EXISTS "crm recipients owner or admin update" ON public.crm_campaign_recipients;
CREATE POLICY "crm recipients owner or admin update" ON public.crm_campaign_recipients
  FOR UPDATE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'))
  WITH CHECK (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm recipients owner or admin delete" ON public.crm_campaign_recipients;
CREATE POLICY "crm recipients owner or admin delete" ON public.crm_campaign_recipients
  FOR DELETE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_campaign_recipients TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'email_delivery_events'
  ) THEN
    ALTER TABLE public.email_delivery_events
      ADD COLUMN IF NOT EXISTS campaign_recipient_id uuid;
    CREATE INDEX IF NOT EXISTS email_delivery_events_campaign_recipient_idx
      ON public.email_delivery_events (campaign_recipient_id)
      WHERE campaign_recipient_id IS NOT NULL;
  END IF;
END $$;
