-- Mirror of drizzle/migrations/PROPOSED_0022_crm_ownership_integrity.sql
-- PROPOSED — DO NOT APPLY until explicitly approved.
-- See drizzle file for full security commentary, apply gates, and rollback SQL.
-- Apply executable body inside one explicit transaction: BEGIN; … COMMIT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_segments_id_recruiter_unique'
      AND conrelid = 'public.crm_segments'::regclass
  ) THEN
    ALTER TABLE public.crm_segments
      ADD CONSTRAINT crm_segments_id_recruiter_unique UNIQUE (id, recruiter_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_campaigns_id_recruiter_unique'
      AND conrelid = 'public.crm_campaigns'::regclass
  ) THEN
    ALTER TABLE public.crm_campaigns
      ADD CONSTRAINT crm_campaigns_id_recruiter_unique UNIQUE (id, recruiter_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_contacts_id_recruiter_unique'
      AND conrelid = 'public.crm_contacts'::regclass
  ) THEN
    ALTER TABLE public.crm_contacts
      ADD CONSTRAINT crm_contacts_id_recruiter_unique UNIQUE (id, recruiter_id);
  END IF;
END $$;

ALTER TABLE public.crm_campaigns
  DROP CONSTRAINT IF EXISTS crm_campaigns_segment_id_fkey;

ALTER TABLE public.crm_campaign_recipients
  DROP CONSTRAINT IF EXISTS crm_campaign_recipients_campaign_id_fkey;

ALTER TABLE public.crm_campaign_recipients
  DROP CONSTRAINT IF EXISTS crm_campaign_recipients_contact_id_fkey;

-- PG15+: ON DELETE SET NULL (segment_id) — do NOT use bare SET NULL (would null recruiter_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_campaigns_segment_same_recruiter_fkey'
      AND conrelid = 'public.crm_campaigns'::regclass
  ) THEN
    ALTER TABLE public.crm_campaigns
      ADD CONSTRAINT crm_campaigns_segment_same_recruiter_fkey
      FOREIGN KEY (segment_id, recruiter_id)
      REFERENCES public.crm_segments (id, recruiter_id)
      ON DELETE SET NULL (segment_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_recipients_campaign_same_recruiter_fkey'
      AND conrelid = 'public.crm_campaign_recipients'::regclass
  ) THEN
    ALTER TABLE public.crm_campaign_recipients
      ADD CONSTRAINT crm_recipients_campaign_same_recruiter_fkey
      FOREIGN KEY (campaign_id, recruiter_id)
      REFERENCES public.crm_campaigns (id, recruiter_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_recipients_contact_same_recruiter_fkey'
      AND conrelid = 'public.crm_campaign_recipients'::regclass
  ) THEN
    ALTER TABLE public.crm_campaign_recipients
      ADD CONSTRAINT crm_recipients_contact_same_recruiter_fkey
      FOREIGN KEY (contact_id, recruiter_id)
      REFERENCES public.crm_contacts (id, recruiter_id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON CONSTRAINT crm_campaigns_segment_same_recruiter_fkey ON public.crm_campaigns IS
  'F08: campaign segment_id must belong to the same recruiter_id (NULL segment allowed). ON DELETE SET NULL (segment_id) only — never nulls recruiter_id.';
COMMENT ON CONSTRAINT crm_recipients_campaign_same_recruiter_fkey ON public.crm_campaign_recipients IS
  'F09/F10: recipient recruiter_id must match campaign owner.';
COMMENT ON CONSTRAINT crm_recipients_contact_same_recruiter_fkey ON public.crm_campaign_recipients IS
  'F09: recipient recruiter_id must match contact owner.';
