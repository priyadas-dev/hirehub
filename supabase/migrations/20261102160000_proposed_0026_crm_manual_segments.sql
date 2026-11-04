-- Mirror of drizzle/migrations/PROPOSED_0026_crm_manual_segments.sql (do not apply until approved).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_segments'
      AND column_name = 'segment_type'
  ) THEN
    ALTER TABLE public.crm_segments
      ADD COLUMN segment_type text NOT NULL DEFAULT 'filter';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_segments_segment_type_check'
      AND conrelid = 'public.crm_segments'::regclass
  ) THEN
    ALTER TABLE public.crm_segments
      ADD CONSTRAINT crm_segments_segment_type_check
      CHECK (segment_type = ANY (ARRAY['filter', 'manual']));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.crm_segment_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  recruiter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_segment_members_segment_contact_unique UNIQUE (segment_id, contact_id)
);

CREATE INDEX IF NOT EXISTS crm_segment_members_segment_idx
  ON public.crm_segment_members (segment_id);

CREATE INDEX IF NOT EXISTS crm_segment_members_recruiter_idx
  ON public.crm_segment_members (recruiter_id, segment_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_segment_members_segment_same_recruiter_fkey'
      AND conrelid = 'public.crm_segment_members'::regclass
  ) THEN
    ALTER TABLE public.crm_segment_members
      ADD CONSTRAINT crm_segment_members_segment_same_recruiter_fkey
      FOREIGN KEY (segment_id, recruiter_id)
      REFERENCES public.crm_segments (id, recruiter_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'crm_segment_members_contact_same_recruiter_fkey'
      AND conrelid = 'public.crm_segment_members'::regclass
  ) THEN
    ALTER TABLE public.crm_segment_members
      ADD CONSTRAINT crm_segment_members_contact_same_recruiter_fkey
      FOREIGN KEY (contact_id, recruiter_id)
      REFERENCES public.crm_contacts (id, recruiter_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.crm_segment_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm segment members owner or admin select" ON public.crm_segment_members;
CREATE POLICY "crm segment members owner or admin select" ON public.crm_segment_members
  FOR SELECT TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

DROP POLICY IF EXISTS "crm segment members owner insert" ON public.crm_segment_members;
CREATE POLICY "crm segment members owner insert" ON public.crm_segment_members
  FOR INSERT TO authenticated
  WITH CHECK (recruiter_id = auth.uid() AND public.current_role_is('recruiter'));

DROP POLICY IF EXISTS "crm segment members owner or admin delete" ON public.crm_segment_members;
CREATE POLICY "crm segment members owner or admin delete" ON public.crm_segment_members
  FOR DELETE TO authenticated
  USING (recruiter_id = auth.uid() OR public.current_role_is('admin'));

GRANT SELECT, INSERT, DELETE ON public.crm_segment_members TO authenticated;
