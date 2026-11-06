/**
 * Discovery grounding confidence — HEURISTIC only.
 *
 * These scores are NOT calibrated probabilities, NOT retrieval similarity, and
 * NOT model logits. They summarize whether live approved jobs / corpus context
 * exist for a job-seeking turn so the Supervisor can refuse or clarify instead
 * of sounding confident with empty grounding.
 *
 * Application and Recruiter specialists do NOT use this numeric score. They gate
 * on required inputs, JWT ownership, confirm-to-apply, and confirmSend instead.
 */

/** Inclusive heuristic floor for Discovery refuse (historical plateau was exactly 0.35). */
export const DISCOVERY_HEURISTIC_REFUSE_MAX = 0.35;

export type ConfidenceAssessment = {
  confident: boolean;
  /** Heuristic grounding score in ~[0, 1]. Not a calibrated probability. */
  score: number;
  reasons: string[];
};

export type DiscoveryConfidenceAction = "allow" | "refuse" | "clarify";

export type DiscoveryConfidenceDecision = {
  assessment: ConfidenceAssessment;
  action: DiscoveryConfidenceAction;
  message: string;
};

export const LOW_CONFIDENCE_MESSAGE =
  "I don’t have enough grounded HireHub context to answer confidently. Try Browse Jobs, narrow by skill or location, or ask again after attaching a resume.";

export const CLARIFY_JOB_SEARCH_MESSAGE =
  "I need a bit more detail to search HireHub confidently. Which role, skill, or location should I focus on?";

/**
 * Detect job-search queries that are recoverable with a clarifying question
 * (generic “find jobs” with no leftover role / skill / location tokens).
 */
export function isVagueJobSearchQuery(question: string): boolean {
  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return true;

  // Strip common scaffolding; any remaining content means the ask is specific enough
  // to refuse on empty results rather than re-prompt for filters.
  const stripped = q
    .replace(
      /\b(please|can you|could you|help me|i want|i need|i'?m|looking for|show me|find|search|list|browse|get me|give me|gimme|recommend|are there|is there|any|some|available)\b/gi,
      " ",
    )
    .replace(/\b(jobs?|openings?|vacancies|positions?|roles?|opportunit(?:y|ies)?)\b/gi, " ")
    .replace(/\b(for|in|at|near|with|a|an|the|me|my|on|to|of)\b/gi, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return stripped.length === 0;
}

/**
 * Heuristic Discovery grounding assessment.
 *
 * Prior bug: baseline started at 0.35 and empty job search never moved it, while
 * refusal used `score < 0.35`, so empty search never refused.
 */
export function assessDiscoveryConfidence(input: {
  liveJobCount: number;
  corpusCount: number;
  ragAvailable: boolean;
  intentNeedsJobs: boolean;
}): ConfidenceAssessment {
  const reasons: string[] = [];
  // Ungrounded baseline sits below the refuse floor so “no evidence” cannot
  // plateau exactly on the historical 0.35 boundary.
  let score = 0.2;

  if (input.liveJobCount > 0) {
    score += 0.55;
  } else if (input.intentNeedsJobs) {
    reasons.push("no_live_approved_jobs");
  }

  if (input.corpusCount > 0) {
    score += 0.25;
  } else if (input.ragAvailable === false) {
    reasons.push("corpus_rag_unavailable");
  }

  if (input.intentNeedsJobs && input.liveJobCount === 0 && input.corpusCount === 0) {
    reasons.push("empty_job_search");
    score = Math.min(score, 0.3);
  }

  if (!input.intentNeedsJobs && input.liveJobCount === 0 && input.corpusCount === 0) {
    reasons.push("empty_grounding");
    score = Math.min(score, 0.25);
  }

  const confident =
    input.liveJobCount > 0 ||
    (input.corpusCount > 0 && score > DISCOVERY_HEURISTIC_REFUSE_MAX) ||
    score > DISCOVERY_HEURISTIC_REFUSE_MAX;

  return { confident, score, reasons };
}

/**
 * Discovery-only refuse predicate.
 * Inclusive of the refuse floor so a plateau at 0.35 cannot slip through.
 */
export function shouldRefuseLowConfidence(assessment: ConfidenceAssessment): boolean {
  if (assessment.confident) return false;
  if (
    assessment.reasons.includes("empty_job_search") ||
    assessment.reasons.includes("empty_grounding")
  ) {
    return true;
  }
  return assessment.score <= DISCOVERY_HEURISTIC_REFUSE_MAX;
}

/** Prefer clarification when the seeker can recover by adding filters. */
export function shouldClarifyDiscovery(input: {
  assessment: ConfidenceAssessment;
  intentNeedsJobs: boolean;
  queryTooVague: boolean;
}): boolean {
  if (!input.intentNeedsJobs || !input.queryTooVague || input.assessment.confident) {
    return false;
  }
  return (
    input.assessment.reasons.includes("empty_job_search") ||
    input.assessment.score <= DISCOVERY_HEURISTIC_REFUSE_MAX
  );
}

/**
 * Single Decision helper for Discovery: clarify → refuse → allow.
 * Application / Recruiter must not call this for ownership or confirm gates.
 */
export function decideDiscoveryConfidence(input: {
  assessment: ConfidenceAssessment;
  intentNeedsJobs: boolean;
  queryTooVague: boolean;
}): DiscoveryConfidenceDecision {
  const { assessment } = input;

  if (
    shouldClarifyDiscovery({
      assessment,
      intentNeedsJobs: input.intentNeedsJobs,
      queryTooVague: input.queryTooVague,
    })
  ) {
    return {
      assessment,
      action: "clarify",
      message: CLARIFY_JOB_SEARCH_MESSAGE,
    };
  }

  if (input.intentNeedsJobs && shouldRefuseLowConfidence(assessment)) {
    return {
      assessment,
      action: "refuse",
      message: LOW_CONFIDENCE_MESSAGE,
    };
  }

  return {
    assessment,
    action: "allow",
    message: "",
  };
}
