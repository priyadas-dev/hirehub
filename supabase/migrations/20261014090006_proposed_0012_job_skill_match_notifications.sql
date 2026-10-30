-- PROPOSED — DO NOT APPLY until explicitly approved.
-- Purpose: Smart Job Matching Notification (Assessment 2 automation).
--
-- When a job transitions into status = 'approved', notify job seekers whose
-- profiles.skills overlap the job title/description/location/salary/type/company
-- using the same known-skill vocabulary as src/lib/ai/skill-extract.ts.
--
-- Why SECURITY DEFINER (not client-side):
--   profiles.skills is private (RLS: own or admin). Listing other seekers'
--   skills from the browser would weaken RLS. Matching + notify_user inserts
--   stay server-side, same pattern as PROPOSED_0005 / 0006b.
--
-- Changes:
--   1) Extend notifications_type_check with 'job_skill_match'
--   2) Add extract_known_skills / known_skill_overlap helpers
--   3) Add notify_seekers_matching_approved_job + trg_notify_job_skill_matches
--   4) AFTER UPDATE OF status ON jobs → skill-match notify (separate from
--      recruiter job_approved notify in trg_notify_job_events)
--
-- Does NOT:
--   - alter profiles / jobs table schemas
--   - change RLS policies or INSERT grants on notifications
--   - touch embeddings / job_corpus
--   - notify seekers without skills or without skill overlap
--
-- Depends on: PROPOSED_0005 (notifications + notify_user), PROPOSED_0009
--   (profiles.skills). Compatible with PROPOSED_0006b job notify trigger.
-- Review on staging before production.
--
-- Transaction note (this project): PROPOSED_*.sql files do not wrap BEGIN/COMMIT.
-- Apply as one paste/batch in the Supabase SQL Editor so the DROP+ADD of
-- notifications_type_check is atomic for that session. Do not split the
-- constraint rewrite across separate runs. Nested BEGIN/COMMIT is omitted
-- intentionally to match other HireHub proposed migrations.

-- ---------------------------------------------------------------------------
-- 1) Allow notification type job_skill_match
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (
      ARRAY[
        'company_pending_review',
        'company_approved',
        'company_rejected',
        'job_pending_review',
        'job_approved',
        'job_rejected',
        'job_closed',
        'job_revision_pending',
        'job_revision_approved',
        'job_revision_rejected',
        'job_skill_match',
        'application_received',
        'application_status',
        'application_submitted'
      ]
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Known-skill extraction (mirrors src/lib/ai/skill-extract.ts)
-- ---------------------------------------------------------------------------
-- Returns canonical skill labels that literally appear in _text.
CREATE OR REPLACE FUNCTION public.extract_known_skills(_text text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  hay text := lower(coalesce(_text, ''));
  found text[] := '{}';
  seen text[] := '{}';
  -- Longer aliases first so node.js wins over node where both exist.
  aliases text[] := ARRAY[
    'javascript', 'typescript', 'postgresql', 'mongodb', 'kubernetes',
    'networking', 'communication', 'next.js', 'node.js', 'react.js',
    'asp.net', 'tailwind', 'graphql', 'postgres', 'express', 'laravel',
    'django', 'flask', 'spring', 'aspnet', 'dotnet', '.net', 'docker',
    'python', 'kotlin', 'swift', 'redis', 'reactjs', 'nextjs', 'nodejs',
    'vuejs', 'angular', 'mysql', 'mongo', 'azure', 'linux', 'english',
    'support', 'network', 'csharp', 'golang', 'c#', 'c++', 'cpp',
    'php', 'ruby', 'rust', 'java', 'html', 'css', 'rest', 'aws', 'gcp',
    'git', 'noc', 'sql', 'vue', 'go', 'js', 'ts', 'node', 'react', 'k8s'
  ];
  canonicals text[] := ARRAY[
    'JavaScript', 'TypeScript', 'PostgreSQL', 'MongoDB', 'Kubernetes',
    'Networking', 'Communication', 'Next.js', 'Node.js', 'React',
    'ASP.NET', 'Tailwind', 'GraphQL', 'PostgreSQL', 'Express', 'Laravel',
    'Django', 'Flask', 'Spring', 'ASP.NET', '.NET', '.NET', 'Docker',
    'Python', 'Kotlin', 'Swift', 'Redis', 'React', 'Next.js', 'Node.js',
    'Vue', 'Angular', 'MySQL', 'MongoDB', 'Azure', 'Linux', 'English',
    'Support', 'Networking', 'C#', 'Go', 'C#', 'C++', 'C++',
    'PHP', 'Ruby', 'Rust', 'Java', 'HTML', 'CSS', 'REST', 'AWS', 'GCP',
    'Git', 'NOC', 'SQL', 'Vue', 'Go', 'JavaScript', 'TypeScript', 'Node.js',
    'React', 'Kubernetes'
  ];
  i int;
  alias text;
  canon text;
  pattern text;
  escaped text;
BEGIN
  IF length(trim(hay)) = 0 THEN
    RETURN '{}';
  END IF;

  IF array_length(aliases, 1) IS DISTINCT FROM array_length(canonicals, 1) THEN
    RAISE EXCEPTION 'extract_known_skills alias/canonical length mismatch';
  END IF;

  FOR i IN 1 .. array_length(aliases, 1) LOOP
    alias := aliases[i];
    canon := canonicals[i];
    IF lower(canon) = ANY (SELECT lower(x) FROM unnest(seen) AS x) THEN
      CONTINUE;
    END IF;

    -- Escape only metacharacters that appear in known aliases (. and +).
    -- Do not use E'...\\1' replacements: in E-strings \1 is octal SOH, which breaks .net / c++.
    escaped := replace(replace(alias, '.', '\.'), '+', '\+');
    IF char_length(alias) <= 2 THEN
      pattern := '(^|[^a-z0-9])' || escaped || '([^a-z0-9]|$)';
    ELSE
      pattern := '(^|[^a-z0-9+#])' || escaped || '([^a-z0-9+#]|$)';
    END IF;

    IF hay ~* pattern THEN
      found := array_append(found, canon);
      seen := array_append(seen, canon);
    END IF;
  END LOOP;

  RETURN found;
END;
$$;

REVOKE ALL ON FUNCTION public.extract_known_skills(text) FROM PUBLIC;

-- Intersection of known skills present in both seeker skills and job haystack.
CREATE OR REPLACE FUNCTION public.known_skill_overlap(_skills text, _haystack text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT s
      FROM unnest(public.extract_known_skills(_skills)) AS s
      WHERE lower(s) IN (
        SELECT lower(j) FROM unnest(public.extract_known_skills(_haystack)) AS j
      )
    ),
    '{}'::text[]
  );
$$;

REVOKE ALL ON FUNCTION public.known_skill_overlap(text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3) Notify matching seekers for one approved job row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_seekers_matching_approved_job(
  _job_id uuid,
  _title text,
  _description text,
  _location text,
  _salary_range text,
  _job_type text,
  _company_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  company_name text;
  haystack text;
  seeker record;
  matched text[];
  skill_phrase text;
  body_text text;
  title_text text;
BEGIN
  IF _job_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.name INTO company_name
  FROM public.companies c
  WHERE c.id = _company_id;

  haystack := concat_ws(
    E'\n',
    nullif(trim(coalesce(_title, '')), ''),
    nullif(trim(coalesce(_description, '')), ''),
    nullif(trim(coalesce(_location, '')), ''),
    nullif(trim(coalesce(_salary_range, '')), ''),
    nullif(trim(coalesce(_job_type, '')), ''),
    nullif(trim(coalesce(company_name, '')), '')
  );

  IF length(trim(coalesce(haystack, ''))) = 0 THEN
    RETURN;
  END IF;

  title_text := coalesce(nullif(trim(_title), ''), 'a job');

  FOR seeker IN
    SELECT p.id, p.skills
    FROM public.profiles p
    WHERE p.role = 'job_seeker'
      AND p.skills IS NOT NULL
      AND length(trim(p.skills)) > 0
  LOOP
    matched := public.known_skill_overlap(seeker.skills, haystack);
    IF matched IS NULL OR coalesce(array_length(matched, 1), 0) = 0 THEN
      CONTINUE;
    END IF;

    IF array_length(matched, 1) = 1 THEN
      skill_phrase := matched[1];
    ELSIF array_length(matched, 1) = 2 THEN
      skill_phrase := matched[1] || ' and ' || matched[2];
    ELSE
      skill_phrase := matched[1] || ', ' || matched[2] || ', and ' || matched[3];
      IF array_length(matched, 1) > 3 THEN
        skill_phrase := skill_phrase || ' (+more)';
      END IF;
    END IF;

    body_text := title_text || ' was approved and matches your ' || skill_phrase || ' skills.';

    PERFORM public.notify_user(
      seeker.id,
      'job_skill_match',
      'New job matches your skills',
      body_text,
      'job',
      _job_id,
      '/seeker/jobs/' || _job_id::text,
      'job_skill_match:' || _job_id::text || ':' || seeker.id::text
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_seekers_matching_approved_job(uuid, text, text, text, text, text, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4) Trigger: only on transition into approved
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_job_skill_matches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'approved' THEN
    PERFORM public.notify_seekers_matching_approved_job(
      NEW.id,
      NEW.title,
      NEW.description,
      NEW.location,
      NEW.salary_range,
      NEW.job_type::text,
      NEW.company_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_notify_skill_matches ON public.jobs;
CREATE TRIGGER jobs_notify_skill_matches
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_notify_job_skill_matches();

REVOKE ALL ON FUNCTION public.trg_notify_job_skill_matches() FROM PUBLIC;

-- Rollback sketch
--
-- Preferred (non-destructive): stop matching + keep existing seeker rows.
-- Leave notifications_type_check including 'job_skill_match' so historical
-- rows remain valid and visible under existing RLS. Do NOT delete user data.
-- 1) DROP TRIGGER IF EXISTS jobs_notify_skill_matches ON public.jobs;
-- 2) DROP FUNCTION IF EXISTS public.trg_notify_job_skill_matches();
-- 3) DROP FUNCTION IF EXISTS public.notify_seekers_matching_approved_job(uuid, text, text, text, text, text, uuid);
-- 4) DROP FUNCTION IF EXISTS public.known_skill_overlap(text, text);
-- 5) DROP FUNCTION IF EXISTS public.extract_known_skills(text);
--
-- Hard rollback (DESTRUCTIVE — only if you must restore the exact pre-0012
-- CHECK without 'job_skill_match'). Existing rows of that type would violate
-- the old constraint, so they must be removed or retyped first. Prefer soft
-- rollback above. If hard rollback is required, run in one batch:
-- 6) -- DESTRUCTIVE: permanently deletes seeker job_skill_match notifications
--    DELETE FROM public.notifications WHERE type = 'job_skill_match';
--    (Safer alternative before DELETE: UPDATE ... SET type = 'job_approved'
--     only if product accepts reclassification; otherwise keep soft rollback.)
-- 7) ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
-- 8) ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
--      type = ANY (ARRAY[
--        'company_pending_review','company_approved','company_rejected',
--        'job_pending_review','job_approved','job_rejected','job_closed',
--        'job_revision_pending','job_revision_approved','job_revision_rejected',
--        'application_received','application_status','application_submitted'
--      ])
--    );
