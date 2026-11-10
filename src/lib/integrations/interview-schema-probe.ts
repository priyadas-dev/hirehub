import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/hirehub-storage";

let interviewReadyCache: boolean | null = null;

export function resetInterviewSchemaReadyCache() {
  interviewReadyCache = null;
}

type LooseFrom = {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

/**
 * True when PROPOSED_0025 `interview_schedules` is visible to PostgREST.
 * Returns false when missing — does not invent schema.
 */
export async function probeInterviewScheduleSchemaReady(): Promise<boolean> {
  if (interviewReadyCache !== null) return interviewReadyCache;

  const client = supabase as unknown as LooseFrom;
  const { error } = await client.from("interview_schedules").select("id").limit(1);

  if (error && isMissingSchemaError(error.message)) {
    interviewReadyCache = false;
    return false;
  }
  if (
    error &&
    /could not find the table|relation .* does not exist|schema cache/i.test(error.message)
  ) {
    interviewReadyCache = false;
    return false;
  }

  interviewReadyCache = true;
  return true;
}

export const INTERVIEW_SCHEMA_PENDING_MESSAGE =
  "Interview scheduling needs PROPOSED_0025 applied in Supabase. Until then, scheduling stays disabled.";
