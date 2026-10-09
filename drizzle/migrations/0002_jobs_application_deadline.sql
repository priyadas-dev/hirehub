ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS application_deadline DATE;

UPDATE public.jobs
SET application_deadline = to_date(substring(description from '^\[\[hh:deadline:(\d{4}-\d{2}-\d{2})\]\]'), 'YYYY-MM-DD')
WHERE application_deadline IS NULL
  AND description ~ '^\[\[hh:deadline:\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\]\]'
  AND to_char(to_date(substring(description from '^\[\[hh:deadline:(\d{4}-\d{2}-\d{2})\]\]'), 'YYYY-MM-DD'), 'YYYY-MM-DD')
      = substring(description from '^\[\[hh:deadline:(\d{4}-\d{2}-\d{2})\]\]');

UPDATE public.jobs
SET description = regexp_replace(description, '^\[\[hh:deadline:\d{4}-\d{2}-\d{2}\]\]\n?', '')
WHERE application_deadline IS NOT NULL
  AND description ~ '^\[\[hh:deadline:\d{4}-\d{2}-\d{2}\]\]';

COMMENT ON COLUMN public.jobs.application_deadline IS 'Last day (Asia/Dhaka calendar date) seekers may apply. NULL = no deadline.';