import { supabase } from "@/integrations/supabase/client";
import {
  queryOpenInterviewScheduleForApplication,
  querySeekerScheduledInterview,
  type InterviewScheduleView,
} from "@/lib/integrations/interview-schedule-queries";

export type { InterviewScheduleView } from "@/lib/integrations/interview-schedule-queries";

/** Browser Supabase client reads (do not import from SSR route graph). */
export async function fetchOpenInterviewScheduleForApplication(
  applicationId: string,
): Promise<InterviewScheduleView | null> {
  return queryOpenInterviewScheduleForApplication(supabase, applicationId);
}

export async function fetchSeekerScheduledInterview(
  applicationId: string,
): Promise<InterviewScheduleView | null> {
  return querySeekerScheduledInterview(supabase, applicationId);
}
