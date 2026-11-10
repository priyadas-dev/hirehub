-- PROPOSED_0026 — Fix interview_schedules.google_event_id CHECK for Postgres
--
-- WHY:
--   PROPOSED_0025 used:
--     google_event_id ~ '^[a-v0-9]{5,1024}$'
--   Postgres advanced regex caps repetition counts at 255, so ANY write of
--   google_event_id fails with:
--     invalid regular expression: invalid repetition count(s)
--   B4 smoke proved Google auth + events.create work; persist of event id fails.
--
-- FIX:
--   Keep the same charset + length rules (5–1024 base32hex) without a single
--   quantifier upper bound above 255: length check + `^[a-v0-9]+$`.
--
-- APPLY: SQL Editor on the HireHub project (same path as 0025). Do NOT blind db push.
-- ROLLBACK: re-add the old CHECK only if you also lower the max length to <=255.

ALTER TABLE public.interview_schedules
  DROP CONSTRAINT IF EXISTS interview_schedules_event_id_format_check;

ALTER TABLE public.interview_schedules
  ADD CONSTRAINT interview_schedules_event_id_format_check CHECK (
    google_event_id IS NULL
    OR (
      char_length(google_event_id) BETWEEN 5 AND 1024
      AND google_event_id ~ '^[a-v0-9]+$'
    )
  );

COMMENT ON CONSTRAINT interview_schedules_event_id_format_check ON public.interview_schedules IS
  'Google client event ids: base32hex, length 5–1024 (length checked separately; Postgres quantifier max is 255).';
