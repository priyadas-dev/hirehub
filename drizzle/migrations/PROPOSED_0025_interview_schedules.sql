-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: interview scheduling records for the Google Calendar integration
-- (Assessment 3, Track 1 — outbound Calendar API + polling sync; no push/watch).
--
-- What this stores (one row per interview, owned by an application):
--   - date/time (start_at, end_at, timezone)
--   - Google Calendar event id + the REAL Google Meet link returned by Google
--     (conferenceData.createRequest + conferenceDataVersion=1 -> event.hangoutLink)
--   - lifecycle status + per-attendee RSVP responses synced by a polling job
--
-- Invite-after-link flow (Phase 3 decisions, revision R1):
--   1. The Calendar event is first created WITHOUT attendees (sendUpdates=none), so
--      nobody is notified while Google is still creating (or failed to create) Meet.
--   2. Only once Google returns the real hangoutLink are the recruiter and seeker
--      added as attendees (sendUpdates=all). That is the single moment invitations
--      go out.
--   3. Only then is ONE database write made: meet_link + invited_at +
--      conference_status='success' + status='scheduled'.
--   Consequences enforced below:
--   - meet_link and invited_at are always both NULL or both set, so a seeker
--     reading their own row can never see a Meet link before being invited.
--   - status='scheduled' is impossible without google_event_id, meet_link,
--     conference_status='success' AND invited_at.
--   - Everything before step 2 happens on an event nobody was invited to, so it
--     can be retried, patched, or deleted invisibly (no duplicate invitations).
--
-- Google Meet rules (enforced in the database as defense in depth):
--   - meet_link may ONLY be a https://meet.google.com/... URL (value returned by
--     Google). Application code must never construct a Meet URL.
--   - While Google is still creating the conference the row stays status='pending'
--     with conference_status='pending' and meet_link NULL.
--   - If Google reports Meet creation failure the row is status='failed' with
--     conference_status='failure', meet_link NULL, invited_at NULL. The recruiter
--     may retry (conference_attempt 1..3) without cancelling the interview.
--
-- Security model:
--   - recruiter_id / seeker_id / job_id are DENORMALIZED onto the row so RLS never
--     needs a cross-table EXISTS (avoids the jobs <-> applications recursion class
--     fixed in PROPOSED_0017).
--   - A trigger (SECURITY DEFINER, reads applications + jobs) guarantees the
--     denormalized ids always match the application's real job/seeker/recruiter and
--     makes those ids immutable.
--   - SELECT only for: the job's recruiter, the application's seeker, admins.
--   - NO INSERT / UPDATE / DELETE policies and NO write grants for anon or
--     authenticated. Only server code (service role, after JWT + ownership
--     authorization) writes, so a browser can never forge google_event_id,
--     meet_link or status.
--   - Does NOT alter any existing table, policy, function, or grant.
--
-- Idempotency model:
--   - Partial UNIQUE index: at most ONE open (pending/scheduled/failed) interview
--     per application. A double-click cannot create a second row, and a failed
--     interview cannot be silently orphaned by creating a new row beside it.
--     Cancelling a failed row (status='cancelled') frees the slot.
--   - Google event id is derived from this row's id:
--       attempt 1: uuid without dashes
--       recreate attempt N: '<uuid-without-dashes>a<N>'
--     so a retried Calendar insert hits HTTP 409 instead of creating a duplicate.
--   - A 'failed' row is retried in place (same row, next conference_attempt).
--   - invited_at records that invitations were sent; the server also re-reads the
--     event from Google and skips the attendee step when both attendees are already
--     present, so a crash between the Google call and this DB write cannot re-send
--     invitations.
--   - lease_until is a short processing lease (set via a conditional UPDATE by the
--     server) so two concurrent requests cannot advance the same interview at once.
--
-- Depends on: public.profiles, public.applications, public.jobs (0000),
--   public.current_role_is (0000).
-- Does NOT depend on any other PROPOSED_* migration.
--
-- Apply: wrap the executable body in one explicit transaction (BEGIN; ... COMMIT;).
-- Never apply via blind `supabase db push`. After apply, regenerate Supabase types
-- (src/integrations/supabase/types.ts) and reload the PostgREST schema if needed.
-- Review on staging first.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interview_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  application_id uuid NOT NULL REFERENCES public.applications (id) ON DELETE CASCADE,
  -- Denormalized ownership (validated by trigger below; immutable after insert).
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  recruiter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  seeker_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  -- Recruiter or admin who created the interview; nullable so deleting that
  -- profile does not erase the interview history.
  scheduled_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,

  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',

  status text NOT NULL DEFAULT 'pending',

  -- Google Calendar
  google_calendar_id text,
  google_event_id text,
  html_link text,
  etag text,

  -- Google Meet (real hangoutLink only). Written together with invited_at
  -- and status='scheduled' — never before invitations go out.
  meet_link text,
  conference_status text NOT NULL DEFAULT 'pending',
  -- Meet creation attempt number. Each recruiter "Retry Meet link" after a
  -- Google conference failure advances this; capped at 3.
  conference_attempt smallint NOT NULL DEFAULT 1,

  -- Set when recruiter + seeker invitations were sent (after the real link exists).
  invited_at timestamptz,

  -- Short processing lease; NULL or in the past = free. Server-side only.
  lease_until timestamptz,

  -- Attendee RSVP, synced by the polling Edge Function (Phase 4).
  recruiter_response text NOT NULL DEFAULT 'needsAction',
  seeker_response text NOT NULL DEFAULT 'needsAction',

  reschedule_count integer NOT NULL DEFAULT 0,
  -- Short machine code only (e.g. google_rate_limited). Never raw provider bodies or PII.
  failure_reason text,
  last_synced_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT interview_schedules_time_order_check CHECK (end_at > start_at),

  CONSTRAINT interview_schedules_status_check CHECK (
    status = ANY (ARRAY['pending', 'scheduled', 'cancelled', 'failed', 'completed'])
  ),

  CONSTRAINT interview_schedules_conference_status_check CHECK (
    conference_status = ANY (ARRAY['pending', 'success', 'failure'])
  ),

  CONSTRAINT interview_schedules_conference_attempt_check CHECK (
    conference_attempt >= 1 AND conference_attempt <= 3
  ),

  CONSTRAINT interview_schedules_recruiter_response_check CHECK (
    recruiter_response = ANY (ARRAY['needsAction', 'accepted', 'declined', 'tentative'])
  ),
  CONSTRAINT interview_schedules_seeker_response_check CHECK (
    seeker_response = ANY (ARRAY['needsAction', 'accepted', 'declined', 'tentative'])
  ),

  CONSTRAINT interview_schedules_reschedule_count_check CHECK (reschedule_count >= 0),

  -- Google client-supplied event ids: base32hex, 5-1024 long.
  -- Attempt 1 is the row uuid without dashes; recreate attempt N appends 'a' || N.
  CONSTRAINT interview_schedules_event_id_format_check CHECK (
    google_event_id IS NULL OR google_event_id ~ '^[a-v0-9]{5,1024}$'
  ),

  -- Meet link must be a Google-issued Meet URL (never a hand-built/fake one).
  CONSTRAINT interview_schedules_meet_link_format_check CHECK (
    meet_link IS NULL OR meet_link LIKE 'https://meet.google.com/%'
  ),

  -- A conference marked 'success' must carry the real link.
  CONSTRAINT interview_schedules_conference_success_has_link_check CHECK (
    conference_status <> 'success' OR meet_link IS NOT NULL
  ),

  -- Meet link and invitation timestamp are written together (invite-after-link).
  CONSTRAINT interview_schedules_link_and_invite_together_check CHECK (
    (meet_link IS NULL AND invited_at IS NULL)
    OR (meet_link IS NOT NULL AND invited_at IS NOT NULL)
  ),

  -- Invitations require a stored Calendar event.
  CONSTRAINT interview_schedules_invited_requires_event_check CHECK (
    invited_at IS NULL OR google_event_id IS NOT NULL
  ),

  -- Once invitations were sent the row cannot return to pending/failed.
  CONSTRAINT interview_schedules_invited_status_check CHECK (
    invited_at IS NULL
    OR status = ANY (ARRAY['scheduled', 'cancelled', 'completed'])
  ),

  -- 'scheduled' requires the real event, the real Meet link, success, and invitations sent.
  CONSTRAINT interview_schedules_scheduled_requires_meet_check CHECK (
    status <> 'scheduled'
    OR (
      google_event_id IS NOT NULL
      AND meet_link IS NOT NULL
      AND conference_status = 'success'
      AND invited_at IS NOT NULL
    )
  ),

  CONSTRAINT interview_schedules_google_event_id_unique UNIQUE (google_event_id)
);

-- At most one open interview per application (pending, scheduled, OR failed).
-- Failed is included so a retry cannot spawn a second row / second Calendar event.
-- Cancelling (status='cancelled') drops the row out of this index and frees the slot.
DROP INDEX IF EXISTS public.interview_schedules_one_active_per_application_idx;
CREATE UNIQUE INDEX IF NOT EXISTS interview_schedules_one_open_per_application_idx
  ON public.interview_schedules (application_id)
  WHERE status IN ('pending', 'scheduled', 'failed');

CREATE INDEX IF NOT EXISTS interview_schedules_recruiter_start_idx
  ON public.interview_schedules (recruiter_id, start_at DESC);

CREATE INDEX IF NOT EXISTS interview_schedules_seeker_start_idx
  ON public.interview_schedules (seeker_id, start_at DESC);

CREATE INDEX IF NOT EXISTS interview_schedules_application_idx
  ON public.interview_schedules (application_id, created_at DESC);

-- Poller (Phase 4) scans pending/scheduled rows, least-recently-synced first.
CREATE INDEX IF NOT EXISTS interview_schedules_active_sync_idx
  ON public.interview_schedules (last_synced_at ASC NULLS FIRST)
  WHERE status IN ('pending', 'scheduled');

-- ---------------------------------------------------------------------------
-- Integrity trigger: denormalized ids must match the application; ids immutable;
-- maintains updated_at.
-- SECURITY DEFINER so it can read applications/jobs regardless of caller RLS
-- (same pattern as public.current_role_is / seeker_has_applied_to_job).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.interview_schedules_enforce_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_job_id uuid;
  app_seeker_id uuid;
  job_recruiter_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.job_id IS DISTINCT FROM OLD.job_id
       OR NEW.recruiter_id IS DISTINCT FROM OLD.recruiter_id
       OR NEW.seeker_id IS DISTINCT FROM OLD.seeker_id THEN
      RAISE EXCEPTION 'interview_schedules ownership columns are immutable'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT a.job_id, a.seeker_id, j.recruiter_id
      INTO app_job_id, app_seeker_id, job_recruiter_id
    FROM public.applications a
    JOIN public.jobs j ON j.id = a.job_id
    WHERE a.id = NEW.application_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'interview_schedules.application_id does not exist'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF NEW.job_id IS DISTINCT FROM app_job_id
       OR NEW.seeker_id IS DISTINCT FROM app_seeker_id
       OR NEW.recruiter_id IS DISTINCT FROM job_recruiter_id THEN
      RAISE EXCEPTION 'interview_schedules ownership columns do not match the application'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.interview_schedules_enforce_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.interview_schedules_enforce_integrity() FROM anon;
REVOKE ALL ON FUNCTION public.interview_schedules_enforce_integrity() FROM authenticated;

DROP TRIGGER IF EXISTS interview_schedules_enforce_integrity_trg ON public.interview_schedules;
CREATE TRIGGER interview_schedules_enforce_integrity_trg
  BEFORE INSERT OR UPDATE ON public.interview_schedules
  FOR EACH ROW EXECUTE FUNCTION public.interview_schedules_enforce_integrity();

-- ---------------------------------------------------------------------------
-- RLS: read-only for participants; writes are server/service-role only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.interview_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "interview schedules participants or admin select"
  ON public.interview_schedules;
CREATE POLICY "interview schedules participants or admin select"
  ON public.interview_schedules
  FOR SELECT
  TO authenticated
  USING (
    recruiter_id = auth.uid()
    OR seeker_id = auth.uid()
    OR public.current_role_is('admin')
  );

-- Deliberately NO INSERT / UPDATE / DELETE policies for authenticated.

-- Defense in depth: Supabase default privileges may auto-grant on new tables.
REVOKE ALL ON public.interview_schedules FROM PUBLIC;
REVOKE ALL ON public.interview_schedules FROM anon;
REVOKE ALL ON public.interview_schedules FROM authenticated;
GRANT SELECT ON public.interview_schedules TO authenticated;
GRANT ALL ON public.interview_schedules TO service_role;

COMMENT ON TABLE public.interview_schedules IS
  'Interview schedule per application. Written only by trusted server code. meet_link is the real Google hangoutLink and is stored only after invitations are sent.';
COMMENT ON COLUMN public.interview_schedules.meet_link IS
  'Google-issued Meet URL (event.hangoutLink). Never hand-constructed. Written together with invited_at.';
COMMENT ON COLUMN public.interview_schedules.google_event_id IS
  'Calendar event id: row uuid without dashes (attempt 1), or that id plus ''a'' || attempt (recreate). Idempotent create via HTTP 409.';
COMMENT ON COLUMN public.interview_schedules.conference_attempt IS
  'Meet creation attempt 1..3. Recruiter Retry after a conference failure advances this in place.';
COMMENT ON COLUMN public.interview_schedules.invited_at IS
  'When recruiter + seeker invitations were sent. NULL until a real hangoutLink exists and sendUpdates=all ran.';
COMMENT ON COLUMN public.interview_schedules.lease_until IS
  'Short server-side processing lease. NULL or in the past means the row is free to advance.';

-- ---------------------------------------------------------------------------
-- Rollback (separate explicit approval required; run in one transaction):
--   DROP TABLE IF EXISTS public.interview_schedules;
--   DROP FUNCTION IF EXISTS public.interview_schedules_enforce_integrity();
-- Dropping the table deletes all interview history; Google Calendar events are
-- NOT deleted automatically.
-- ---------------------------------------------------------------------------
