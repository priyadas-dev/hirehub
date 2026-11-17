import { classifyAssistantIntent, liveJobsFoundAnswer, noLiveJobsMatchAnswer } from "@/lib/ai/assistant-intent";
import {
  redactPii,
  evaluateFairnessBeforeRank,
  mustBlockJobRanking,
  validateSupervisedTurn,
  buildStructuredAssistantPayload,
  FAIRNESS_REFUSAL_MESSAGE,
} from "@/lib/ai/guardrails";
import {
  runDiscoveryAgent,
  type DiscoveryAgentResult,
} from "@/lib/ai/agents/discovery";
import {
  defaultServerAgentMemory,
  extractSearchPreferences,
  type AgentMemoryRecentJob,
  type ServerAgentMemory,
} from "@/lib/ai/memory/server-memory";
import type {
  AskJobAssistantInput,
  AskJobAssistantResult,
  JobAssistantDeps,
} from "@/lib/ai/job-assistant";
import {
  assertSeekerRole,
  insufficientContextAnswer,
  toCorpusCitations,
  toLiveCitations,
} from "@/lib/ai/job-assistant";
import type { CorpusMatch } from "@/lib/ai/corpus";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";
import { extractSkillsFromQuestion } from "@/lib/ai/skill-extract";
import {
  extractApplyJobId,
  extractSaveJobId,
  filterRecentJobsByQuestion,
  looksLikeApplyIntent,
  looksLikeCheckStatusIntent,
  looksLikeSaveJobIntent,
  type CheckStatusAgentInput,
  type CheckStatusAgentResult,
  type SaveJobAgentInput,
  type SaveJobAgentResult,
} from "@/lib/ai/agents/application";
import {
  extractRecruiterApplicationId,
  extractRecruiterJobId,
  looksLikeOutreachDraftIntent,
  looksLikeShortlistIntent,
} from "@/lib/ai/agents/recruiter";
import type { ApplicationStatus } from "@/components/status/status";
import type {
  ApplicationStatusItemPayload,
  ApplyOutcomePayload,
  PendingApplyPayload,
  SaveJobOutcomePayload,
} from "@/lib/ai/job-assistant";

/** Structured recruiter API actions — routed without NL ambiguity. */
export type RecruiterSupervisorDirective = {
  kind: "shortlist" | "draft_outreach";
  applicationId?: string;
  jobId?: string;
  status?: Extract<ApplicationStatus, "shortlisted" | "interview" | "rejected" | "hired">;
  confirm?: boolean;
  contactId?: string;
  segmentId?: string;
  confirmSend?: boolean;
};

export type SupervisorTurnInput = AskJobAssistantInput & {
  recruiterApplicationId?: string;
  recruiterJobId?: string;
  confirmRecruiter?: boolean;
  /** When set, supervisor routes directly to the recruiter specialist (structured API). */
  recruiterDirective?: RecruiterSupervisorDirective;
};

export type RecruiterSupervisorAgentInput = {
  kind: "shortlist" | "draft_outreach";
  applicationId?: string;
  jobId?: string;
  status?: Extract<ApplicationStatus, "shortlisted" | "interview" | "rejected" | "hired">;
  confirm: boolean;
  contactId?: string;
  segmentId?: string;
  /** Draft-only from NL; structured callers may pass explicit confirmSend. */
  confirmSend?: boolean;
};

export type RecruiterSupervisorAgentResult = {
  ok: boolean;
  message: string;
  code?: "forbidden" | "validation" | "unauthorized" | "db";
  /** Opaque specialist payload for backward-compatible API mapping. */
  specialist?: unknown;
};

export type SupervisorDeps = {
  role: JobAssistantDeps["role"];
  userId?: string;
  conversationId?: string;
  memory?: ServerAgentMemory;
  listLiveJobs: JobAssistantDeps["listLiveJobs"];
  retrieveCorpus: JobAssistantDeps["retrieveCorpus"];
  /** Phase 7: confirm-to-apply specialist (JWT only). */
  runApplicationAgent?: JobAssistantDeps["runApplicationAgent"];
  /** Application Agent — Save Job tool (JWT saved_jobs). */
  runSaveJobTool?: (input: SaveJobAgentInput) => Promise<SaveJobAgentResult>;
  /** Application Agent — Check Application Status tool (own apps only). */
  runCheckApplicationStatusTool?: (
    input: CheckStatusAgentInput,
  ) => Promise<CheckStatusAgentResult>;
  /** Recruiter specialist — must be wired for recruiter/admin supervisor turns. */
  runRecruiterAgent?: (
    input: RecruiterSupervisorAgentInput,
  ) => Promise<RecruiterSupervisorAgentResult>;
  /**
   * Fallback for non-discovery turns (resume, interview, general knowledge, etc.).
   */
  runLegacyPipeline: (input: AskJobAssistantInput) => Promise<AskJobAssistantResult>;
};

export type SupervisorTrace = {
  routedTo:
    | "discovery"
    | "legacy"
    | "application"
    | "recruiter"
    | "fairness_refuse"
    | "validation_refuse";
  piiRedacted: boolean;
  fairnessAction: "pass" | "neutralize" | "refuse" | "skipped";
  memoryWritten: boolean;
  structured?: ReturnType<typeof buildStructuredAssistantPayload>;
};

export type SupervisedAskResult = AskJobAssistantResult & {
  supervisor?: SupervisorTrace;
  /** Raw recruiter specialist result for legacy API response shaping. */
  recruiterSpecialist?: unknown;
};

function conversationIdFor(deps: SupervisorDeps): string {
  return deps.conversationId?.trim() || "default";
}

function resolveRecentJobsForApplication(
  input: AskJobAssistantInput,
  memory: ServerAgentMemory,
  userId: string | undefined,
  conversationId: string,
): NonNullable<AskJobAssistantInput["recentJobs"]> | AgentMemoryRecentJob[] | undefined {
  if (input.recentJobs?.length) return input.recentJobs;
  if (!userId) return undefined;
  const fromMemory = memory.getApplicationBundle(userId, conversationId).recentJobs;
  return fromMemory.length ? fromMemory : undefined;
}

function isRecruiterSupervisorRole(role: JobAssistantDeps["role"]): boolean {
  return role === "recruiter" || role === "admin";
}

function validateRecruiterSupervisorQuestion(question: string): { ok: true } | { ok: false; message: string } {
  const trimmed = question.trim();
  if (trimmed.length < 3) {
    return { ok: false, message: "Ask a shortlist or outreach question (at least 3 characters)." };
  }
  if (trimmed.length > 1500) {
    return { ok: false, message: "Question is too long (max 1500 characters)." };
  }
  return { ok: true };
}

function recruiterTrace(piiRedacted: boolean): SupervisorTrace {
  return {
    routedTo: "recruiter",
    piiRedacted,
    fairnessAction: "skipped",
    memoryWritten: false,
  };
}

async function dispatchRecruiterSpecialist(
  agentInput: RecruiterSupervisorAgentInput,
  deps: SupervisorDeps,
  piiRedacted: boolean,
): Promise<SupervisedAskResult> {
  if (!deps.runRecruiterAgent) {
    return {
      ok: false,
      code: "validation",
      message: "Recruiter agent is not configured for this request.",
      supervisor: {
        routedTo: "validation_refuse",
        piiRedacted,
        fairnessAction: "skipped",
        memoryWritten: false,
      },
    };
  }

  const result = await deps.runRecruiterAgent(agentInput);

  if (!result.ok) {
    return {
      ok: false,
      code:
        result.code === "forbidden"
          ? "forbidden"
          : result.code === "unauthorized"
            ? "unauthorized"
            : "validation",
      message: result.message,
      supervisor: recruiterTrace(piiRedacted),
      recruiterSpecialist: result.specialist,
    };
  }

  return {
    ...okAssistant({
      answer: result.message,
      model: "recruiter-agent",
      soughtLiveJobs: false,
      liveJobsAvailable: false,
      insufficientContext: false,
    }),
    supervisor: recruiterTrace(piiRedacted),
    recruiterSpecialist: result.specialist,
  };
}

/**
 * Recruiter/admin branch — central orchestration for shortlist and outreach draft specialists.
 * Does not write shared memory (seeker memory module unchanged).
 */
async function runRecruiterSupervisorTurn(
  input: SupervisorTurnInput,
  deps: SupervisorDeps,
): Promise<SupervisedAskResult> {
  if (!isRecruiterSupervisorRole(deps.role)) {
    return {
      ok: false,
      code: "forbidden",
      message: "Recruiter supervisor routing requires a recruiter or admin role.",
      supervisor: {
        routedTo: "validation_refuse",
        piiRedacted: false,
        fairnessAction: "skipped",
        memoryWritten: false,
      },
    };
  }

  const questionCheck = validateRecruiterSupervisorQuestion(input.question);
  if (!questionCheck.ok) {
    return {
      ok: false,
      code: "validation",
      message: questionCheck.message,
      supervisor: {
        routedTo: "validation_refuse",
        piiRedacted: false,
        fairnessAction: "skipped",
        memoryWritten: false,
      },
    };
  }

  const pii = redactPii(input.question);
  const questionForRoute = pii.text;

  const directive = input.recruiterDirective;
  if (directive) {
    if (directive.kind === "shortlist") {
      return dispatchRecruiterSpecialist(
        {
          kind: "shortlist",
          applicationId: directive.applicationId,
          status: directive.status,
          confirm: Boolean(directive.confirm),
          confirmSend: false,
        },
        deps,
        pii.redacted,
      );
    }
    return dispatchRecruiterSpecialist(
      {
        kind: "draft_outreach",
        jobId: directive.jobId,
        contactId: directive.contactId,
        segmentId: directive.segmentId,
        confirm: false,
        confirmSend: Boolean(directive.confirmSend),
      },
      deps,
      pii.redacted,
    );
  }

  const confirm = Boolean(input.confirmRecruiter);

  const wantsShortlist =
    looksLikeShortlistIntent(questionForRoute) ||
    Boolean(input.recruiterApplicationId) ||
    (confirm && Boolean(input.recruiterApplicationId));

  const wantsOutreach =
    looksLikeOutreachDraftIntent(questionForRoute) || Boolean(input.recruiterJobId);

  let applicationId: string | null = null;
  let jobId: string | null = null;

  if (wantsShortlist) {
    applicationId = extractRecruiterApplicationId({
      question: questionForRoute,
      applicationId: input.recruiterApplicationId,
    });
  }
  if (wantsOutreach) {
    jobId = extractRecruiterJobId({
      question: questionForRoute,
      jobId: input.recruiterJobId,
    });
  }

  // One UUID in text must not satisfy both specialists — shortlist / explicit application wins.
  if (
    wantsShortlist &&
    wantsOutreach &&
    applicationId &&
    jobId &&
    applicationId === jobId
  ) {
    jobId = null;
  }
  if (wantsShortlist && input.recruiterApplicationId) {
    jobId = null;
  }

  if (wantsShortlist) {
    if (!applicationId) {
      return {
        ...okAssistant({
          answer:
            "Tell me which application to shortlist (include applicationId or the application UUID). I will not change status until you confirm.",
          model: "recruiter-agent",
          soughtLiveJobs: false,
          liveJobsAvailable: false,
          insufficientContext: false,
        }),
        supervisor: recruiterTrace(pii.redacted),
      };
    }
    return dispatchRecruiterSpecialist(
      {
        kind: "shortlist",
        applicationId,
        confirm,
        confirmSend: false,
      },
      deps,
      pii.redacted,
    );
  }

  if (wantsOutreach) {
    if (!jobId) {
      return {
        ...okAssistant({
          answer:
            "Tell me which owned job this outreach is for (include jobId or the job UUID). I will draft only — nothing is sent until you confirm in CRM.",
          model: "recruiter-agent",
          soughtLiveJobs: false,
          liveJobsAvailable: false,
          insufficientContext: false,
        }),
        supervisor: recruiterTrace(pii.redacted),
      };
    }
    return dispatchRecruiterSpecialist(
      {
        kind: "draft_outreach",
        jobId,
        confirm: false,
        confirmSend: false,
      },
      deps,
      pii.redacted,
    );
  }

  const legacy = await deps.runLegacyPipeline({ ...input, question: questionForRoute });
  return {
    ...legacy,
    supervisor: {
      routedTo: "legacy",
      piiRedacted: pii.redacted,
      fairnessAction: "skipped",
      memoryWritten: false,
    },
  };
}

function okAssistant(partial: {
  answer: string;
  model: string;
  corpus?: ReturnType<typeof toCorpusCitations>;
  live?: ReturnType<typeof toLiveCitations>;
  insufficientContext?: boolean;
  ragAvailable?: boolean;
  liveJobsAvailable?: boolean;
  soughtLiveJobs?: boolean;
  sessionSkills?: string[];
  pendingApply?: PendingApplyPayload;
  applyOutcome?: ApplyOutcomePayload;
  saveOutcome?: SaveJobOutcomePayload;
  applicationStatuses?: ApplicationStatusItemPayload[];
}): AskJobAssistantResult {
  const live = partial.live ?? [];
  const corpus = partial.corpus ?? [];
  return {
    ok: true,
    answer: partial.answer,
    model: partial.model,
    insufficientContext: partial.insufficientContext ?? live.length + corpus.length === 0,
    ragAvailable: partial.ragAvailable ?? true,
    liveJobsAvailable: partial.liveJobsAvailable ?? live.length > 0,
    soughtLiveJobs: partial.soughtLiveJobs ?? true,
    corpusCitations: corpus,
    liveCitations: live,
    sessionSkills: partial.sessionSkills,
    pendingApply: partial.pendingApply,
    applyOutcome: partial.applyOutcome,
    saveOutcome: partial.saveOutcome,
    applicationStatuses: partial.applicationStatuses,
  };
}

/**
 * Supervisor / router — guardrails first, then discovery or legacy specialist path.
 * Evolves the seeker assistant; does not replace UI or invent jobs.
 */
export async function runSupervisor(
  input: SupervisorTurnInput,
  deps: SupervisorDeps,
): Promise<SupervisedAskResult> {
  if (isRecruiterSupervisorRole(deps.role)) {
    return runRecruiterSupervisorTurn(input, deps);
  }

  const roleGate = assertSeekerRole(deps.role);
  if (roleGate) return roleGate;

  const validation = validateSupervisedTurn({
    question: input.question,
    role: deps.role ?? "seeker",
    userId: deps.userId,
    conversationId: deps.conversationId,
  });
  if (!validation.ok) {
    return {
      ok: false,
      code: deps.role && deps.role !== "seeker" ? "forbidden" : "validation",
      message: validation.message,
      supervisor: {
        routedTo: "validation_refuse",
        piiRedacted: false,
        fairnessAction: "skipped",
        memoryWritten: false,
      },
    };
  }

  const pii = redactPii(input.question);
  const redactedInput: AskJobAssistantInput = { ...input, question: pii.text };

  const memory = deps.memory ?? defaultServerAgentMemory;
  const userId = deps.userId;
  const conversationId = conversationIdFor(deps);

  if (userId) {
    memory.appendTurn(userId, conversationId, {
      role: "user",
      text: pii.text,
      meta: { piiRedacted: pii.redacted },
    });
    const turnSkills = extractSkillsFromQuestion(pii.text);
    const skillsToMerge = [...(input.sessionSkills ?? []), ...turnSkills];
    if (skillsToMerge.length) {
      memory.mergeSkills(userId, conversationId, skillsToMerge);
    }
    memory.mergePreferences(userId, conversationId, extractSearchPreferences(pii.text));
    if (input.recentJobs?.length) {
      memory.rememberRecentJobs(userId, conversationId, input.recentJobs);
    }
  }

  const fairness = evaluateFairnessBeforeRank(pii.text);
  if (mustBlockJobRanking(fairness)) {
    const message = FAIRNESS_REFUSAL_MESSAGE;
    if (userId) {
      memory.appendTurn(userId, conversationId, {
        role: "assistant",
        text: message,
        meta: { fairness: "refuse" },
      });
    }
    return {
      ...okAssistant({
        answer: message,
        model: "guardrail-fairness",
        live: [],
        corpus: [],
        insufficientContext: false,
        soughtLiveJobs: false,
        liveJobsAvailable: false,
      }),
      supervisor: {
        routedTo: "fairness_refuse",
        piiRedacted: pii.redacted,
        fairnessAction: "refuse",
        memoryWritten: Boolean(userId),
        structured: buildStructuredAssistantPayload({
          answer: message,
          liveJobIds: [],
          corpusKeys: [],
          guardrails: { fairness: "refuse", piiRedacted: pii.redacted },
        }),
      },
    };
  }

  const questionForRoute = fairness.ok ? fairness.neutralizedQuestion : pii.text;
  const classified = classifyAssistantIntent(questionForRoute);

  // Phase 7: application agent (confirm-to-apply) before discovery/legacy.
  const wantsApply =
    Boolean(deps.runApplicationAgent) &&
    (Boolean(input.confirmApply) ||
      Boolean(input.applyJobId) ||
      looksLikeApplyIntent(questionForRoute));

  // Task 2: Save Job / Check Status — same Application Agent, after apply priority.
  const wantsSaveJob =
    !wantsApply && Boolean(deps.runSaveJobTool) && looksLikeSaveJobIntent(questionForRoute);
  const wantsCheckStatus =
    !wantsApply &&
    !wantsSaveJob &&
    Boolean(deps.runCheckApplicationStatusTool) &&
    looksLikeCheckStatusIntent(questionForRoute);

  if (wantsSaveJob && deps.runSaveJobTool) {
    const recentJobs = resolveRecentJobsForApplication(input, memory, userId, conversationId);
    const jobId = extractSaveJobId({
      question: questionForRoute,
      applyJobId: input.applyJobId,
      recentJobs,
    });
    if (!jobId) {
      const clarifyJobs = filterRecentJobsByQuestion(questionForRoute, recentJobs ?? []);
      return {
        ...okAssistant({
          answer:
            clarifyJobs.length > 1
              ? "I found a few matching jobs. Tell me which one to save (pick a card, or say “save the first job”)."
              : "Tell me which approved job to save (pick a card, or say “save the first job”).",
          model: "application-agent",
          soughtLiveJobs: false,
          liveJobsAvailable: false,
          insufficientContext: false,
          live: clarifyJobs.map((j) => ({
            kind: "live_approved_job" as const,
            id: j.id,
            title: j.title,
            location: j.location ?? null,
            description: j.description ?? null,
            job_type: j.job_type ?? null,
            company_name: j.company_name ?? null,
          })),
        }),
        supervisor: {
          routedTo: "application",
          piiRedacted: pii.redacted,
          fairnessAction: fairness.flagged ? "neutralize" : "pass",
          memoryWritten: Boolean(userId),
        },
      };
    }

    const saved = await deps.runSaveJobTool({
      jobId,
      jobTitle: recentJobs?.find((j) => j.id === jobId)?.title,
      recentJobs,
    });

    if (!saved.ok) {
      return {
        ok: false,
        code:
          saved.code === "unauthorized"
            ? "unauthorized"
            : saved.code === "validation"
              ? "validation"
              : "unknown",
        message: saved.message,
        supervisor: {
          routedTo: "application",
          piiRedacted: pii.redacted,
          fairnessAction: "skipped",
          memoryWritten: false,
        },
      };
    }

    if (userId) {
      memory.appendTurn(userId, conversationId, {
        role: "assistant",
        text: saved.message.slice(0, 500),
        meta: { intent: "save_job", status: saved.status },
      });
    }
    return {
      ...okAssistant({
        answer: saved.message,
        model: "application-agent",
        soughtLiveJobs: false,
        liveJobsAvailable: false,
        insufficientContext: false,
        saveOutcome: {
          status: saved.status,
          savedJobId: saved.savedJobId,
          jobId: saved.jobId,
          title: saved.title,
        },
      }),
      supervisor: {
        routedTo: "application",
        piiRedacted: pii.redacted,
        fairnessAction: fairness.flagged ? "neutralize" : "pass",
        memoryWritten: Boolean(userId),
      },
    };
  }

  if (wantsCheckStatus && deps.runCheckApplicationStatusTool) {
    const recentJobs = resolveRecentJobsForApplication(input, memory, userId, conversationId);
    const status = await deps.runCheckApplicationStatusTool({
      question: questionForRoute,
      recentJobs,
      jobId: input.applyJobId,
    });

    if (!status.ok) {
      return {
        ok: false,
        code: status.code === "unauthorized" ? "unauthorized" : status.code === "validation" ? "validation" : "unknown",
        message: status.message,
        supervisor: {
          routedTo: "application",
          piiRedacted: pii.redacted,
          fairnessAction: "skipped",
          memoryWritten: false,
        },
      };
    }

    if (userId) {
      memory.appendTurn(userId, conversationId, {
        role: "assistant",
        text: status.message.slice(0, 500),
        meta: { intent: "check_status", count: status.applications.length },
      });
    }
    return {
      ...okAssistant({
        answer: status.message,
        model: "application-agent",
        soughtLiveJobs: false,
        liveJobsAvailable: false,
        insufficientContext: false,
        applicationStatuses: status.applications,
      }),
      supervisor: {
        routedTo: "application",
        piiRedacted: pii.redacted,
        fairnessAction: fairness.flagged ? "neutralize" : "pass",
        memoryWritten: Boolean(userId),
      },
    };
  }

  if (wantsApply && deps.runApplicationAgent) {
    const recentJobs = resolveRecentJobsForApplication(input, memory, userId, conversationId);
    const jobId = extractApplyJobId({
      question: questionForRoute,
      applyJobId: input.applyJobId,
      recentJobs,
    });
    if (!jobId) {
      const clarifyJobs = filterRecentJobsByQuestion(questionForRoute, recentJobs ?? []);
      return {
        ...okAssistant({
          answer:
            clarifyJobs.length > 1
              ? "I found a few matching jobs. Tell me which one to apply to (pick a card, or say “apply to the first job”). I will not submit until you confirm."
              : "Tell me which approved job to apply to (pick a card, pass applyJobId, or say “apply to the first job”). I will not submit until you confirm.",
          model: "application-agent",
          soughtLiveJobs: false,
          liveJobsAvailable: false,
          insufficientContext: false,
          live: clarifyJobs.map((j) => ({
            kind: "live_approved_job" as const,
            id: j.id,
            title: j.title,
            location: j.location ?? null,
            description: j.description ?? null,
            job_type: j.job_type ?? null,
            company_name: j.company_name ?? null,
          })),
        }),
        supervisor: {
          routedTo: "application",
          piiRedacted: pii.redacted,
          fairnessAction: fairness.flagged ? "neutralize" : "pass",
          memoryWritten: Boolean(userId),
        },
      };
    }

    const applied = await deps.runApplicationAgent({
      jobId,
      jobTitle: recentJobs?.find((j) => j.id === jobId)?.title,
      confirm: Boolean(input.confirmApply),
      recentJobs,
    });

    if (!applied.ok) {
      return {
        ok: false,
        code:
          applied.code === "unauthorized"
            ? "unauthorized"
            : applied.code === "forbidden"
              ? "forbidden"
              : applied.code === "validation"
                ? "validation"
                : "unknown",
        message: applied.message,
        supervisor: {
          routedTo: "application",
          piiRedacted: pii.redacted,
          fairnessAction: "skipped",
          memoryWritten: false,
        },
      };
    }

    if (applied.status === "needs_confirm") {
      if (userId) {
        memory.appendTurn(userId, conversationId, {
          role: "assistant",
          text: applied.message.slice(0, 500),
          meta: { intent: "apply_needs_confirm" },
        });
      }
      return {
        ...okAssistant({
          answer: applied.message,
          model: "application-agent",
          soughtLiveJobs: false,
          liveJobsAvailable: false,
          insufficientContext: false,
          pendingApply: applied.pendingApply,
        }),
        supervisor: {
          routedTo: "application",
          piiRedacted: pii.redacted,
          fairnessAction: fairness.flagged ? "neutralize" : "pass",
          memoryWritten: Boolean(userId),
        },
      };
    }

    if (userId) {
      memory.appendTurn(userId, conversationId, {
        role: "assistant",
        text: applied.message.slice(0, 500),
        meta: { intent: "apply_submitted" },
      });
    }
    return {
      ...okAssistant({
        answer: applied.message,
        model: "application-agent",
        soughtLiveJobs: false,
        liveJobsAvailable: false,
        insufficientContext: false,
        applyOutcome: {
          status: applied.status,
          applicationId: applied.applicationId,
          jobId: applied.jobId,
        },
      }),
      supervisor: {
        routedTo: "application",
        piiRedacted: pii.redacted,
        fairnessAction: fairness.flagged ? "neutralize" : "pass",
        memoryWritten: Boolean(userId),
      },
    };
  }

  const wantsDiscovery = classified.searchJobs || classified.useSkillRanking;

  if (wantsDiscovery) {
    const discoveryMemory = userId
      ? memory.getDiscoveryBundle(userId, conversationId)
      : { skills: [], preferences: { locations: [], remotePreferred: false, keywords: [] }, conversationContext: "", searchHints: "" };

    const discovery = await runDiscoveryAgent(
      {
        question: questionForRoute,
        sessionSkills: input.sessionSkills,
        memory: {
          skills: discoveryMemory.skills,
          searchHints: discoveryMemory.searchHints,
          conversationContext: discoveryMemory.conversationContext,
        },
      },
      {
        listLiveJobs: async (question, opts) => {
          const skillTerms =
            opts?.skillTerms?.filter((s) => s.trim().length > 0) ??
            (opts?.skillHint?.trim() ? [opts.skillHint.trim()] : undefined);
          return deps.listLiveJobs(question, {
            skillTerms,
            // Wider pool so skill ranking has something to score on live.
            limit: skillTerms?.length ? 20 : 8,
          });
        },
        retrieveCorpus: async (question) => {
          const result = await deps.retrieveCorpus(question);
          if (!result.ok) {
            return {
              ok: false as const,
              unavailable: result.unavailable,
              message: result.message,
            };
          }
          return { ok: true as const, matches: result.matches };
        },
      },
    );

    return finalizeDiscovery(discovery, {
      userId,
      conversationId,
      memory,
      piiRedacted: pii.redacted,
      fairnessAction: fairness.flagged ? "neutralize" : "pass",
    });
  }

  const legacyInput: AskJobAssistantInput = {
    ...redactedInput,
    question: questionForRoute,
    conversationContext:
      userId && !input.conversationContext
        ? memory.toConversationContext(userId, conversationId) || input.conversationContext
        : input.conversationContext,
  };
  const legacy = await deps.runLegacyPipeline(legacyInput);

  if (userId && legacy.ok) {
    memory.appendTurn(userId, conversationId, {
      role: "assistant",
      text: legacy.answer.slice(0, 500),
      meta: { intent: classified.intent },
    });
    if (legacy.sessionSkills?.length) {
      memory.mergeSkills(userId, conversationId, legacy.sessionSkills);
    }
  }

  return {
    ...legacy,
    supervisor: {
      routedTo: "legacy",
      piiRedacted: pii.redacted,
      fairnessAction: "skipped",
      memoryWritten: Boolean(userId && legacy.ok),
    },
  };
}

function finalizeDiscovery(
  discovery: DiscoveryAgentResult,
  ctx: {
    userId?: string;
    conversationId: string;
    memory: ServerAgentMemory;
    piiRedacted: boolean;
    fairnessAction: "pass" | "neutralize";
  },
): SupervisedAskResult {
  if (!discovery.ok) {
    if (ctx.userId) {
      ctx.memory.appendTurn(ctx.userId, ctx.conversationId, {
        role: "assistant",
        text: discovery.message.slice(0, 500),
        meta: {
          fairness: discovery.code === "fairness_refuse" ? "refuse" : undefined,
        },
      });
    }
    if (discovery.code === "fairness_refuse") {
      return {
        ...okAssistant({
          answer: discovery.message,
          model: "guardrail-fairness",
          live: [],
          corpus: [],
          soughtLiveJobs: false,
          liveJobsAvailable: false,
          insufficientContext: false,
        }),
        supervisor: {
          routedTo: "fairness_refuse",
          piiRedacted: ctx.piiRedacted,
          fairnessAction: "refuse",
          memoryWritten: Boolean(ctx.userId),
        },
      };
    }
    if (discovery.code === "low_confidence" || discovery.code === "needs_clarification") {
      const clarify = discovery.code === "needs_clarification";
      return {
        ...okAssistant({
          answer: discovery.message || insufficientContextAnswer(),
          model: clarify ? "guardrail-clarify" : "guardrail-confidence",
          live: [],
          corpus: [],
          insufficientContext: true,
          soughtLiveJobs: true,
          liveJobsAvailable: false,
        }),
        supervisor: {
          routedTo: "discovery",
          piiRedacted: ctx.piiRedacted,
          fairnessAction: ctx.fairnessAction,
          memoryWritten: Boolean(ctx.userId),
          structured: buildStructuredAssistantPayload({
            answer: discovery.message,
            liveJobIds: [],
            corpusKeys: [],
            guardrails: {
              lowConfidence: !clarify,
              needsClarification: clarify,
              piiRedacted: ctx.piiRedacted,
            },
          }),
        },
      };
    }
    return {
      ok: false,
      code: "unknown",
      message: discovery.message,
      supervisor: {
        routedTo: "discovery",
        piiRedacted: ctx.piiRedacted,
        fairnessAction: ctx.fairnessAction,
        memoryWritten: Boolean(ctx.userId),
      },
    };
  }

  const liveCitations = toLiveCitations(discovery.liveJobs);
  const corpusCitations = toCorpusCitations(discovery.corpusMatches as CorpusMatch[]);
  const answer =
    liveCitations.length > 0
      ? liveJobsFoundAnswer(liveCitations.length)
      : discovery.corpusMatches.length > 0
        ? "I found related synthetic career context (not real vacancies). Browse Jobs for live openings, or ask with a clearer role or skill."
        : noLiveJobsMatchAnswer();

  if (ctx.userId) {
    ctx.memory.appendTurn(ctx.userId, ctx.conversationId, {
      role: "assistant",
      text: answer.slice(0, 500),
      meta: {
        intent: discovery.intent,
        liveJobIds: liveCitations.map((c) => c.id),
        fairness: ctx.fairnessAction,
        piiRedacted: ctx.piiRedacted,
      },
    });
    if (liveCitations.length) {
      ctx.memory.rememberRecentJobs(
        ctx.userId,
        ctx.conversationId,
        liveCitations.map((c) => ({
          id: c.id,
          title: c.title,
          location: c.location,
          company_name: c.company_name,
          job_type: c.job_type,
          description: c.description,
        })),
      );
    }
  }

  return {
    ...okAssistant({
      answer,
      model: "discovery-agent",
      live: liveCitations,
      corpus: corpusCitations,
      insufficientContext: liveCitations.length === 0 && corpusCitations.length === 0,
      soughtLiveJobs: true,
      liveJobsAvailable: liveCitations.length > 0,
      ragAvailable: true,
    }),
    supervisor: {
      routedTo: "discovery",
      piiRedacted: ctx.piiRedacted,
      fairnessAction: ctx.fairnessAction,
      memoryWritten: Boolean(ctx.userId),
      structured: buildStructuredAssistantPayload({
        answer,
        liveJobIds: liveCitations.map((c) => c.id),
        corpusKeys: corpusCitations.map((c) => c.corpus_key),
        guardrails: {
          fairness: ctx.fairnessAction,
          piiRedacted: ctx.piiRedacted,
        },
      }),
    },
  };
}

/** Test helper: ensure live citations only contain known ids (no invention). */
export function discoveryLiveIdsAreSubset(
  live: LiveApprovedJob[],
  knownIds: string[],
): boolean {
  const known = new Set(knownIds);
  return live.every((j) => known.has(j.id));
}
