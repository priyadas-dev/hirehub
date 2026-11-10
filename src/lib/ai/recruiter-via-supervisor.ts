/**
 * All recruiter API actions enter through the Supervisor (Track 3 orchestration).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runRecruiterSpecialistFromSupervisor,
  type RecruiterAgentRunnerResult,
  type RecruiterShortlistStatus,
} from "@/lib/ai/agents/recruiter-agent-runner";
import {
  runSupervisor,
  type RecruiterSupervisorDirective,
  type RecruiterSupervisorAgentInput,
  type RecruiterSupervisorAgentResult,
  type SupervisedAskResult,
} from "@/lib/ai/agents/supervisor";
import type { DraftOutreachResult, ShortlistResult } from "@/lib/ai/agents/recruiter";

export type RecruiterAgentRequest =
  | {
      action: "shortlist";
      applicationId: string;
      status?: RecruiterShortlistStatus;
      confirm: boolean;
    }
  | {
      action: "draft_outreach";
      jobId: string;
      contactId?: string;
      segmentId?: string;
      confirmSend?: boolean;
    }
  | {
      action: "supervised";
      question: string;
      applicationId?: string;
      jobId?: string;
      confirm?: boolean;
    };

export type RecruiterAgentResponse =
  | ShortlistResult
  | { ok: true; status: "updated"; applicationId: string; plannedStatus: string; message: string }
  | DraftOutreachResult
  | SupervisedAskResult
  | { ok: false; code: string; message: string };

function mapRunnerToSupervisorResult(
  specialist: RecruiterAgentRunnerResult,
): RecruiterSupervisorAgentResult {
  if (!specialist.ok) {
    return {
      ok: false,
      message: specialist.message,
      code: specialist.code,
      specialist,
    };
  }

  if ("status" in specialist && specialist.status === "updated") {
    return {
      ok: true,
      message: specialist.message,
      specialist,
    };
  }

  if ("status" in specialist && (specialist.status === "needs_confirm" || specialist.status === "authorized")) {
    return {
      ok: true,
      message: specialist.message,
      specialist,
    };
  }

  if ("campaign" in specialist) {
    return {
      ok: true,
      message: specialist.message,
      specialist,
    };
  }

  return {
    ok: true,
    message: "Recruiter action completed.",
    specialist,
  };
}

function specialistToApiResponse(
  supervised: SupervisedAskResult,
): RecruiterAgentResponse {
  if (supervised.recruiterSpecialist !== undefined) {
    return supervised.recruiterSpecialist as RecruiterAgentResponse;
  }
  if (!supervised.ok) {
    return {
      ok: false,
      code: supervised.code ?? "unknown",
      message: supervised.message,
    };
  }
  return supervised;
}

function requestToDirective(data: RecruiterAgentRequest): RecruiterSupervisorDirective | undefined {
  if (data.action === "shortlist") {
    return {
      kind: "shortlist",
      applicationId: data.applicationId,
      status: data.status,
      confirm: data.confirm,
    };
  }
  if (data.action === "draft_outreach") {
    return {
      kind: "draft_outreach",
      jobId: data.jobId,
      contactId: data.contactId,
      segmentId: data.segmentId,
      confirmSend: Boolean(data.confirmSend),
    };
  }
  return undefined;
}

function questionForRequest(data: RecruiterAgentRequest): string {
  if (data.action === "shortlist") {
    return `Shortlist application ${data.applicationId}${data.confirm ? " with confirm" : ""}.`;
  }
  if (data.action === "draft_outreach") {
    return `Draft outreach email campaign for job ${data.jobId}.`;
  }
  return data.question;
}

export async function invokeRecruiterAgentViaSupervisor(
  ctx: { supabase: SupabaseClient; userId: string; role: "recruiter" | "admin" },
  data: RecruiterAgentRequest,
): Promise<RecruiterAgentResponse> {
  const runRecruiterAgent = async (
    input: RecruiterSupervisorAgentInput,
  ): Promise<RecruiterSupervisorAgentResult> => {
    const specialist = await runRecruiterSpecialistFromSupervisor(input, {
      supabase: ctx.supabase,
      callerId: ctx.userId,
      callerRole: ctx.role,
    });
    return mapRunnerToSupervisorResult(specialist);
  };

  const supervised = await runSupervisor(
    {
      question: questionForRequest(data),
      recruiterDirective: requestToDirective(data),
      recruiterApplicationId: data.action === "supervised" ? data.applicationId : undefined,
      recruiterJobId: data.action === "supervised" ? data.jobId : undefined,
      confirmRecruiter: data.action === "supervised" ? data.confirm : undefined,
    },
    {
      role: ctx.role,
      userId: ctx.userId,
      conversationId: "recruiter-agent",
      listLiveJobs: async () => ({ ok: true, jobs: [] }),
      retrieveCorpus: async () => ({ ok: true, matches: [] }),
      runRecruiterAgent,
      runLegacyPipeline: async () => ({
        ok: true,
        answer:
          "I only act on jobs you own. Try: list my jobs · shortlist from <job title> · propose shortlist for the selected applicant · draft outreach for this job. Incomplete asks are OK — name a job or skill and I’ll browse your owned jobs first. Shortlist always needs confirm; emails are never sent from this page.",
        insufficientContext: false,
        ragAvailable: false,
        liveJobsAvailable: false,
        soughtLiveJobs: false,
        corpusCitations: [],
        liveCitations: [],
        model: "recruiter-supervisor",
      }),
    },
  );

  if (data.action === "supervised") {
    return supervised;
  }

  return specialistToApiResponse(supervised);
}
