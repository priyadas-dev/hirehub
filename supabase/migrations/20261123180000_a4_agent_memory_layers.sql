-- Assessment 4 — durable multi-layer agent memory
-- PROPOSED / restored to repo for closeout — DO NOT APPLY until explicitly approved.
-- Idempotent IF NOT EXISTS + own-row RLS; does not weaken existing policies.
--
-- Layers:
--   1) public.agent_sessions          — working/durable conversation blob (Path B)
--   2) public.agent_memory_events     — episodic per-user log
--   3) public.agent_semantic_memories — long-term facts + embedding_gte (384)
--
-- Security: own-row RLS (user_id = auth.uid()). No anon access.
-- Writes: server/Supervisor with user JWT only — never browser service-role.

-- ---------------------------------------------------------------------------
-- 1) Path B conversation sessions (idempotent if PROPOSED_0027 already applied)
-- ---------------------------------------------------------------------------
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
  'A4 Path B durable agent conversation memory. Own-row JWT RLS; PII-redacted JSON only.';

CREATE INDEX IF NOT EXISTS agent_sessions_user_id_idx
  ON public.agent_sessions (user_id);

CREATE INDEX IF NOT EXISTS agent_sessions_updated_at_idx
  ON public.agent_sessions (updated_at DESC);

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own agent sessions select" ON public.agent_sessions;
DROP POLICY IF EXISTS "own agent sessions insert" ON public.agent_sessions;
DROP POLICY IF EXISTS "own agent sessions update" ON public.agent_sessions;
DROP POLICY IF EXISTS "own agent sessions delete" ON public.agent_sessions;

CREATE POLICY "own agent sessions select"
  ON public.agent_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own agent sessions insert"
  ON public.agent_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own agent sessions update"
  ON public.agent_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own agent sessions delete"
  ON public.agent_sessions FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.agent_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_sessions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_sessions TO authenticated;
GRANT ALL ON TABLE public.agent_sessions TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Episodic memory — append-only event log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  conversation_id text NOT NULL,
  event_type text NOT NULL,
  summary_text text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_memory_events_conversation_id_length
    CHECK (char_length(conversation_id) BETWEEN 1 AND 128),
  CONSTRAINT agent_memory_events_type_length
    CHECK (char_length(event_type) BETWEEN 1 AND 64),
  CONSTRAINT agent_memory_events_summary_length
    CHECK (char_length(summary_text) BETWEEN 1 AND 1000),
  CONSTRAINT agent_memory_events_meta_object
    CHECK (jsonb_typeof(meta) = 'object')
);

COMMENT ON TABLE public.agent_memory_events IS
  'A4 episodic memory: redacted per-user event log across sessions. Written by Supervisor only.';

CREATE INDEX IF NOT EXISTS agent_memory_events_user_created_idx
  ON public.agent_memory_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_memory_events_user_conversation_idx
  ON public.agent_memory_events (user_id, conversation_id);

ALTER TABLE public.agent_memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own memory events select" ON public.agent_memory_events;
DROP POLICY IF EXISTS "own memory events insert" ON public.agent_memory_events;
DROP POLICY IF EXISTS "own memory events update" ON public.agent_memory_events;
DROP POLICY IF EXISTS "own memory events delete" ON public.agent_memory_events;

CREATE POLICY "own memory events select"
  ON public.agent_memory_events FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own memory events insert"
  ON public.agent_memory_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Episodic is append-oriented; allow update only for same-user repair paths.
CREATE POLICY "own memory events update"
  ON public.agent_memory_events FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own memory events delete"
  ON public.agent_memory_events FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.agent_memory_events FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_memory_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_memory_events TO authenticated;
GRANT ALL ON TABLE public.agent_memory_events TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Semantic / long-term memory + pgvector
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_semantic_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding_gte extensions.vector(384),
  importance real NOT NULL DEFAULT 0.5,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_semantic_memories_kind_length
    CHECK (char_length(kind) BETWEEN 1 AND 64),
  CONSTRAINT agent_semantic_memories_content_length
    CHECK (char_length(content) BETWEEN 1 AND 500),
  CONSTRAINT agent_semantic_memories_hash_length
    CHECK (char_length(content_hash) BETWEEN 8 AND 128),
  CONSTRAINT agent_semantic_memories_importance
    CHECK (importance >= 0 AND importance <= 1),
  CONSTRAINT agent_semantic_memories_user_kind_hash_unique
    UNIQUE (user_id, kind, content_hash)
);

COMMENT ON TABLE public.agent_semantic_memories IS
  'A4 semantic memory: learned preferences/facts with gte-small 384-d embeddings. Own-row RLS.';

CREATE INDEX IF NOT EXISTS agent_semantic_memories_user_idx
  ON public.agent_semantic_memories (user_id);

CREATE INDEX IF NOT EXISTS agent_semantic_memories_user_seen_idx
  ON public.agent_semantic_memories (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS agent_semantic_memories_embedding_gte_hnsw_idx
  ON public.agent_semantic_memories
  USING hnsw (embedding_gte extensions.vector_cosine_ops)
  WHERE embedding_gte IS NOT NULL;

ALTER TABLE public.agent_semantic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_semantic_memories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own semantic memories select" ON public.agent_semantic_memories;
DROP POLICY IF EXISTS "own semantic memories insert" ON public.agent_semantic_memories;
DROP POLICY IF EXISTS "own semantic memories update" ON public.agent_semantic_memories;
DROP POLICY IF EXISTS "own semantic memories delete" ON public.agent_semantic_memories;

CREATE POLICY "own semantic memories select"
  ON public.agent_semantic_memories FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own semantic memories insert"
  ON public.agent_semantic_memories FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own semantic memories update"
  ON public.agent_semantic_memories FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own semantic memories delete"
  ON public.agent_semantic_memories FOR DELETE TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.agent_semantic_memories FROM PUBLIC;
REVOKE ALL ON TABLE public.agent_semantic_memories FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_semantic_memories TO authenticated;
GRANT ALL ON TABLE public.agent_semantic_memories TO service_role;

-- Similarity + light recency: caller must be authenticated; rows limited to auth.uid().
CREATE OR REPLACE FUNCTION public.match_agent_semantic_memories(
  query_embedding extensions.vector(384),
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  kind text,
  content text,
  importance real,
  last_seen_at timestamptz,
  similarity double precision,
  score double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    m.id,
    m.kind,
    m.content,
    m.importance,
    m.last_seen_at,
    (1 - (m.embedding_gte <=> query_embedding))::double precision AS similarity,
    (
      (1 - (m.embedding_gte <=> query_embedding)) * 0.75
      + GREATEST(
          0.0,
          1.0 - (EXTRACT(EPOCH FROM (now() - m.last_seen_at)) / 2592000.0)
        ) * 0.15
      + m.importance * 0.10
    )::double precision AS score
  FROM public.agent_semantic_memories m
  WHERE m.user_id = auth.uid()
    AND m.embedding_gte IS NOT NULL
  ORDER BY score DESC, m.last_seen_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(match_count, 5), 20));
$$;

COMMENT ON FUNCTION public.match_agent_semantic_memories(extensions.vector, integer) IS
  'A4 semantic recall for the signed-in user (auth.uid). Similarity + recency blend. SECURITY INVOKER.';

REVOKE ALL ON FUNCTION public.match_agent_semantic_memories(extensions.vector, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_agent_semantic_memories(extensions.vector, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_agent_semantic_memories(extensions.vector, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_agent_semantic_memories(extensions.vector, integer) TO service_role;
