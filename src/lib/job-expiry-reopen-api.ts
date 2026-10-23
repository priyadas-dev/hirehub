import { supabase } from "@/integrations/supabase/client";
import {
  RECRUITER_REOPEN_EXPIRED_JOB_RPC,
  canRecruiterReopenExpiredJob,
  isReopenRpcUnavailable,
  type ExpiryReopenJob,
} from "@/lib/job-expiry-reopen";

/**
 * Explicit recruiter action: set a new deadline and reopen an expiry-auto-closed job.
 * Requires PROPOSED_0014. Does not reopen from a silent deadline field edit.
 */
export async function recruiterReopenExpiredJob(input: {
  job: ExpiryReopenJob;
  callerId: string;
  newDeadline: string;
}): Promise<unknown> {
  const gate = canRecruiterReopenExpiredJob({
    job: input.job,
    callerId: input.callerId,
    newDeadline: input.newDeadline,
  });
  if (!gate.ok) throw new Error(gate.reason);

  const { data, error } = await supabase.rpc(RECRUITER_REOPEN_EXPIRED_JOB_RPC, {
    _job_id: input.job.id,
    _new_deadline: input.newDeadline,
  });

  if (error) {
    if (isReopenRpcUnavailable(error)) {
      throw new Error(
        "Reopening expired jobs requires proposed migration PROPOSED_0014_job_closed_reason.sql (not applied yet).",
      );
    }
    throw error;
  }
  return data;
}
