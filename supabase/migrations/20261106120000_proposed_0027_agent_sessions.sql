-- Mirror of drizzle/migrations/PROPOSED_0027_agent_sessions.sql
-- PROPOSED — DO NOT APPLY until explicitly approved.
-- See drizzle file for full commentary.

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_sessions_user_conversation_unique UNIQUE (user_id, conversation_id),
  CONSTRAINT agent_sessions_conversation_id_length
    CHECK (char_length(conversation_id) BETWEEN 1 AND 128),
  CONSTRAINT agent_sessions_memory_object
    CHECK (jsonb_typeof(memory) = 'object'),
  CONSTRAINT agent_sessions_memory_size
    CHECK (pg_column_size(memory) <= 65536)
);

COMMENT ON TABLE public.agent_sessions IS
  'Path B durable agent conversation memory. Own-row JWT RLS; app stores PII-redacted JSON only.';

COMMENT ON COLUMN public.agent_sessions.memory IS
  'Redacted payload: turns, skills, preferences, recentJobs. Max ~64KB column size.';

CREATE INDEX IF NOT EXISTS agent_sessions_user_id_idx
  ON public.agent_sessions (user_id);

CREATE INDEX IF NOT EXISTS agent_sessions_updated_at_idx
  ON public.agent_sessions (updated_at DESC);

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
-- Enforce RLS even for table owners; service_role still bypasses via BYPASSRLS.
ALTER TABLE public.agent_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own agent sessions select" ON public.agent_sessions;
DROP POLICY IF EXISTS "own agent sessions insert" ON public.agent_sessions;
DROP POLICY IF EXISTS "own agent sessions update" ON public.agent_sessions;
DROP POLICY IF EXISTS "own agent sessions delete" ON public.agent_sessions;

CREATE POLICY "own agent sessions select"
  ON public.agent_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own agent sessions insert"
  ON public.agent_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own agent sessions update"
  ON public.agent_sessions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own agent sessions delete"
  ON public.agent_sessions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.agent_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_sessions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_sessions TO authenticated;
GRANT ALL ON TABLE public.agent_sessions TO service_role;
