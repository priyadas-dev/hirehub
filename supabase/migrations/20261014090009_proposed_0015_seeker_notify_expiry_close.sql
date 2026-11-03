-- PROPOSED_0015: Notify applicants when a job is auto-closed for expired deadline.
--
-- Assessment / product: seekers who applied should learn the listing closed
-- because the deadline passed. Recruiter still gets existing job_closed notify.
-- Manual closes (closed_reason recruiter/admin/null) do NOT notify seekers here.
--
-- Depends on: notifications + notify_user (0005), closed_reason (0014).
-- Idempotent: dedupe_key job_expired_closed:{jobId}:{seekerId}

CREATE OR REPLACE FUNCTION public.trg_notify_job_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid;
  seeker_id uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    FOR admin_id IN
      SELECT id FROM public.profiles WHERE role = 'admin'
    LOOP
      PERFORM public.notify_user(
        admin_id,
        'job_pending_review',
        'Job awaiting approval',
        coalesce(NEW.title, 'A job') || ' was submitted for approval.',
        'job',
        NEW.id,
        '/admin/jobs',
        'job_pending:' || NEW.id::text || ':' || admin_id::text
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_approved',
        'Job post approved',
        coalesce(NEW.title, 'Your job') || ' is approved and visible to seekers.',
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':approved'
      );
    ELSIF NEW.status = 'rejected' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_rejected',
        'Job post rejected',
        coalesce(NEW.title, 'Your job') || ' was rejected. Reason: '
          || coalesce(NEW.rejection_reason, 'No reason provided.'),
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':rejected'
      );
    ELSIF NEW.status = 'closed' THEN
      PERFORM public.notify_user(
        NEW.recruiter_id,
        'job_closed',
        'Job post closed',
        coalesce(NEW.title, 'Your job') || ' was closed and is no longer open for applications.',
        'job',
        NEW.id,
        '/recruiter/jobs',
        'job_status:' || NEW.id::text || ':closed'
      );

      -- Auto-close only: notify each seeker who applied to this job.
      IF NEW.closed_reason = 'expired_deadline' THEN
        FOR seeker_id IN
          SELECT DISTINCT a.seeker_id
          FROM public.applications a
          WHERE a.job_id = NEW.id
            AND a.seeker_id IS NOT NULL
        LOOP
          PERFORM public.notify_user(
            seeker_id,
            'job_closed',
            'Job listing closed',
            coalesce(NEW.title, 'A job')
              || ' was closed because the application deadline passed.',
            'job',
            NEW.id,
            '/seeker/applications',
            'job_expired_closed:' || NEW.id::text || ':' || seeker_id::text
          );
        END LOOP;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_notify_job_events() FROM PUBLIC;

-- Rollback sketch:
-- Restore trg_notify_job_events from the pre-0015 body (recruiter-only on closed).
