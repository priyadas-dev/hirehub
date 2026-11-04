-- PROPOSED — DO NOT APPLY until explicitly approved (separate from authoring).
-- Purpose: Database-enforced CRM ownership cohesion (Assessment 3 Phase 5 hardening).
-- Fixes audit findings F08–F10 (ASSESSMENT_3_CRM_SECURITY_AUDIT.md).
-- Plan: docs/ASSESSMENT_3_CRM_SECURITY_HARDENING_PLAN.md
--
-- Controls (additive):
-- 1) UNIQUE (id, recruiter_id) on crm_segments, crm_campaigns, crm_contacts
-- 2) Replace single-column segment/campaign/contact FKs with composite FKs that
--    require the child row's recruiter_id to match the referenced parent owner.
--
-- Security model (unchanged RLS):
-- - Does NOT create, drop, or weaken RLS policies.
-- - Does NOT grant new privileges.
-- - Does NOT alter email_delivery_events.
-- - Enforced for all writers (authenticated JWT, service role, SQL Editor).
--
-- Depends on: PROPOSED_0021 CRM tables applied and live.
-- Pre-apply data validation (required): hardening plan §5 diagnostics must return
-- zero mismatch rows. Clean-slate verification (2026-11-02): all five CRM tables
-- empty — compatible with this migration.
--
-- Apply: wrap the executable body below in one explicit transaction:
--   BEGIN;
--   -- body
--   COMMIT;
-- SQL Editor / psql autocommit is unsafe (DROP old FKs could commit before ADD).
-- Never apply via blind `supabase db push`. Register migration history only after
-- successful apply + PostgREST schema reload if needed.
--
-- Undo SQL (requires separate explicit approval): see footer comments.

-- ---------------------------------------------------------------------------
-- 1) Parent uniqueness enabling composite FKs
--    (id is already PK; composite UNIQUE is required by Postgres for FK targets)
--    Existence checks are scoped by conname + conrelid (expected table).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) Drop single-column FKs that will be replaced by composites
--    Default Postgres names from PROPOSED_0021 inline REFERENCES.
--    If live names differ, discover via:
--      SELECT conname FROM pg_constraint
--      WHERE conrelid = 'public.crm_campaigns'::regclass AND contype = 'f';
--    and adjust before apply. Do not leave contradictory single + composite FKs.
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_campaigns
  DROP CONSTRAINT IF EXISTS crm_campaigns_segment_id_fkey;

ALTER TABLE public.crm_campaign_recipients
  DROP CONSTRAINT IF EXISTS crm_campaign_recipients_campaign_id_fkey;

ALTER TABLE public.crm_campaign_recipients
  DROP CONSTRAINT IF EXISTS crm_campaign_recipients_contact_id_fkey;

-- ---------------------------------------------------------------------------
-- 3) Composite foreign keys (MATCH SIMPLE)
--    - segment_id IS NULL → campaign→segment FK not enforced (draft without audience)
--    - non-null segment_id → campaign.recruiter_id must equal segment.recruiter_id
--    - recipient.recruiter_id must equal both campaign and contact owners
--    Keep UNIQUE (campaign_id, contact_id) from 0021 for owner-local dedupe.
--
-- CRITICAL (campaign → segment):
-- Bare `ON DELETE SET NULL` on a *composite* FK nulls ALL FK columns, which would
-- attempt to null `recruiter_id` (NOT NULL) and break ownership. Use the PostgreSQL
-- 15+ column-list form so only `segment_id` is cleared (same product behavior as
-- PROPOSED_0021’s single-column FK). Requires Supabase Postgres ≥ 15.
-- Recipient composites use ON DELETE CASCADE (deletes child rows; does not null
-- recruiter_id) — same semantics as 0021.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Rollback (DO NOT RUN unless explicitly approved to undo 0022)
-- ---------------------------------------------------------------------------
-- BEGIN;
-- ALTER TABLE public.crm_campaign_recipients
--   DROP CONSTRAINT IF EXISTS crm_recipients_contact_same_recruiter_fkey;
-- ALTER TABLE public.crm_campaign_recipients
--   DROP CONSTRAINT IF EXISTS crm_recipients_campaign_same_recruiter_fkey;
-- ALTER TABLE public.crm_campaigns
--   DROP CONSTRAINT IF EXISTS crm_campaigns_segment_same_recruiter_fkey;
-- -- Re-add prior single-column FKs from PROPOSED_0021:
-- ALTER TABLE public.crm_campaigns
--   ADD CONSTRAINT crm_campaigns_segment_id_fkey
--   FOREIGN KEY (segment_id) REFERENCES public.crm_segments (id) ON DELETE SET NULL;
-- ALTER TABLE public.crm_campaign_recipients
--   ADD CONSTRAINT crm_campaign_recipients_campaign_id_fkey
--   FOREIGN KEY (campaign_id) REFERENCES public.crm_campaigns (id) ON DELETE CASCADE;
-- ALTER TABLE public.crm_campaign_recipients
--   ADD CONSTRAINT crm_campaign_recipients_contact_id_fkey
--   FOREIGN KEY (contact_id) REFERENCES public.crm_contacts (id) ON DELETE CASCADE;
-- ALTER TABLE public.crm_contacts
--   DROP CONSTRAINT IF EXISTS crm_contacts_id_recruiter_unique;
-- ALTER TABLE public.crm_campaigns
--   DROP CONSTRAINT IF EXISTS crm_campaigns_id_recruiter_unique;
-- ALTER TABLE public.crm_segments
--   DROP CONSTRAINT IF EXISTS crm_segments_id_recruiter_unique;
-- COMMIT;
-- Do NOT db reset, drop CRM tables, or weaken SELECT policies.
