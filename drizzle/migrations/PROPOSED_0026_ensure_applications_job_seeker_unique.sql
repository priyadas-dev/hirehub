-- PROPOSED_0026: Ensure UNIQUE (job_id, seeker_id) on public.applications
--
-- Evidence already in repo:
--   drizzle/migrations/0000_hirehub_core_schema.sql defines
--   UNIQUE (job_id, seeker_id) on public.applications.
-- Remote baselines under supabase/migrations/ are history markers only
-- (already applied on munqgybiuqpncxbgfvdp) — this file is a safety net if a
-- environment somehow lacks the constraint.
--
-- DO NOT APPLY to live Supabase without explicit approval.
-- apply-to-job.ts relies on Postgres 23505 when concurrent inserts race.
--
-- PRE-CHECK (run manually before apply):
--   SELECT job_id, seeker_id, COUNT(*) AS n
--   FROM public.applications
--   GROUP BY job_id, seeker_id
--   HAVING COUNT(*) > 1;
-- Must return zero rows. Do not delete application data to “fix” this —
-- escalate duplicates for manual review.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.applications'::regclass
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ILIKE '%(job_id, seeker_id)%'
  ) THEN
    RAISE NOTICE 'PROPOSED_0026: UNIQUE (job_id, seeker_id) already present — no-op';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'applications'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%job_id%'
      AND indexdef ILIKE '%seeker_id%'
  ) THEN
    RAISE NOTICE 'PROPOSED_0026: unique index covering (job_id, seeker_id) already present — no-op';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.applications
    GROUP BY job_id, seeker_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'PROPOSED_0026 aborted: duplicate (job_id, seeker_id) rows exist. Resolve manually before adding UNIQUE.';
  END IF;

  ALTER TABLE public.applications
    ADD CONSTRAINT applications_job_id_seeker_id_key UNIQUE (job_id, seeker_id);

  COMMENT ON CONSTRAINT applications_job_id_seeker_id_key ON public.applications IS
    'Hard invariant: at most one application per (job_id, seeker_id). Required for concurrent apply idempotency (23505).';

  RAISE NOTICE 'PROPOSED_0026: added UNIQUE (job_id, seeker_id)';
END $$;
