-- Add nullable application deadline on jobs.
-- Calendar-day semantics for this DATE are defined by HireHub business timezone Asia/Dhaka
-- (see migration 0003 and src/lib/job-fields.ts). The column itself stores a bare DATE.
--
-- Regex notes (PostgreSQL ARE, standard_conforming_strings=on):
--   Dollar-quoted patterns ($hh$...$hh$) pass backslashes through unchanged.
--   \[ and \] match literal '[' / ']'; unescaped '[' would open a character class.
--   The ~ operator is regex-match (not '\~'). [0-9] is a digit class.
--   regexp_match and regexp_replace both use ^marker\r?\n? (no end-of-string $ after ]]),
--   so a marker is recognized at start whether followed by EOF, LF, CRLF, or more text.
--   Only calendar-valid markers are backfilled/stripped; malformed markers stay in description.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS application_deadline date;

-- Backfill + strip together for null-deadline rows with a real calendar marker.
-- Never overwrite a non-null application_deadline.
UPDATE public.jobs AS j
SET
  application_deadline = c.marker_date::date,
  description = NULLIF(c.description_rest, '')
FROM (
  SELECT
    id,
    marker_date,
    regexp_replace(
      description,
      $hh$^\[\[hh:deadline:[0-9]{4}-[0-9]{2}-[0-9]{2}\]\]\r?\n?$hh$,
      ''
    ) AS description_rest
  FROM (
    SELECT
      id,
      description,
      (regexp_match(
        description,
        $hh$^\[\[hh:deadline:([0-9]{4}-[0-9]{2}-[0-9]{2})\]\]\r?\n?$hh$
      ))[1] AS marker_date
    FROM public.jobs
    WHERE application_deadline IS NULL
      AND description IS NOT NULL
  ) AS extracted
  WHERE marker_date IS NOT NULL
    AND CASE
      WHEN marker_date ~ $hh$^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$$hh$
        THEN to_char(to_date(marker_date, 'YYYY-MM-DD'), 'YYYY-MM-DD') = marker_date
      ELSE false
    END
) AS c
WHERE j.id = c.id
  AND j.application_deadline IS NULL;

-- Rows that already have application_deadline: strip only calendar-valid markers.
-- Do not modify application_deadline. Leave malformed / non-calendar markers untouched
-- (never strip an invalid or unbackfilled marker).
UPDATE public.jobs AS j
SET description = NULLIF(c.description_rest, '')
FROM (
  SELECT
    id,
    regexp_replace(
      description,
      $hh$^\[\[hh:deadline:[0-9]{4}-[0-9]{2}-[0-9]{2}\]\]\r?\n?$hh$,
      ''
    ) AS description_rest
  FROM (
    SELECT
      id,
      description,
      (regexp_match(
        description,
        $hh$^\[\[hh:deadline:([0-9]{4}-[0-9]{2}-[0-9]{2})\]\]\r?\n?$hh$
      ))[1] AS marker_date
    FROM public.jobs
    WHERE application_deadline IS NOT NULL
      AND description IS NOT NULL
  ) AS extracted
  WHERE marker_date IS NOT NULL
    AND CASE
      WHEN marker_date ~ $hh$^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$$hh$
        THEN to_char(to_date(marker_date, 'YYYY-MM-DD'), 'YYYY-MM-DD') = marker_date
      ELSE false
    END
) AS c
WHERE j.id = c.id;
