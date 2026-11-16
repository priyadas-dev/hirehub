-- PROPOSED_0028 — Google Calendar push watch channel registry (inbound webhook)
-- (0027 is already used by agent_sessions; this is the next free number.)
--
-- WHY:
--   Assignment inbound path uses Calendar events.watch → HTTPS webhook with a
--   shared channel token (Google's supported auth; not Svix HMAC).
--   Channels expire; HireHub must store channel_id + resource_id + expiration
--   so renew/stop and webhook verification work without hardcoding.
--
-- SECURITY:
--   Service-role only. No authenticated INSERT/UPDATE/DELETE.
--   Do not store the webhook token in this table (lives in env
--   GOOGLE_CALENDAR_WEBHOOK_TOKEN only).
--
-- APPLY: SQL Editor on HireHub (same path as 0025/0026). Do NOT blind db push.
-- PREREQ: PROPOSED_0025 (+ 0026 event-id CHECK fix) already applied.
-- ROLLBACK: DROP TABLE public.google_calendar_watch_channels;

CREATE TABLE IF NOT EXISTS public.google_calendar_watch_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Google channel id we supplied at events.watch time (UUID string).
  channel_id text NOT NULL,
  -- Google resourceId returned by watch (required for channels.stop).
  resource_id text NOT NULL,
  calendar_id text NOT NULL DEFAULT 'primary',
  -- Unix ms expiration from Google (or null if unknown).
  expiration_ms bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_calendar_watch_channels_channel_id_unique UNIQUE (channel_id)
);

-- At most one active row per calendar_id (organizer primary watch).
CREATE UNIQUE INDEX IF NOT EXISTS google_calendar_watch_channels_one_per_calendar_idx
  ON public.google_calendar_watch_channels (calendar_id);

ALTER TABLE public.google_calendar_watch_channels ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated — service_role bypasses RLS.
REVOKE ALL ON public.google_calendar_watch_channels FROM PUBLIC;
REVOKE ALL ON public.google_calendar_watch_channels FROM anon;
REVOKE ALL ON public.google_calendar_watch_channels FROM authenticated;
GRANT ALL ON public.google_calendar_watch_channels TO service_role;

COMMENT ON TABLE public.google_calendar_watch_channels IS
  'Active Google Calendar events.watch channel metadata for HireHub inbound push. Token is env-only.';
COMMENT ON COLUMN public.google_calendar_watch_channels.channel_id IS
  'Client-supplied channel UUID passed to events.watch and echoed as X-Goog-Channel-ID.';
COMMENT ON COLUMN public.google_calendar_watch_channels.resource_id IS
  'Google resourceId from watch response; required for channels.stop / renew.';
