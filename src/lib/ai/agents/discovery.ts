import { classifyAssistantIntent } from "@/lib/ai/assistant-intent";
import {
  evaluateFairnessBeforeRank,
  mustBlockJobRanking,
  assessDiscoveryConfidence,
  decideDiscoveryConfidence,
  isVagueJobSearchQuery,
  redactPii,
} from "@/lib/ai/guardrails";
import type { CorpusMatch } from "@/lib/ai/corpus";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";
import { rankJobsBySkills, type SkillMatchedJob } from "@/lib/ai/skill-match";
import { extractSkillsFromQuestion, mergeSkillLists } from "@/lib/ai/skill-extract";

export type DiscoveryAgentDeps = {
  listLiveJobs: (
    question: string,
    opts?: { skillHint?: string | null },
  ) => Promise<
    | { ok: true; jobs: LiveApprovedJob[] }
    | { ok: false; message: string }
  >;
  retrieveCorpus?: (
    question: string,
  ) => Promise<
    | { ok: true; matches: CorpusMatch[] }
    | { ok: false; unavailable?: boolean; message: string }
  >;
};

export type DiscoveryAgentResult =
  | {
      ok: true;
      questionUsed: string;
      intent: string;
      liveJobs: Array<LiveApprovedJob | SkillMatchedJob>;
      corpusMatches: CorpusMatch[];
      inventedJobs: false;
      fairness: { action: "pass" | "neutralize"; reasons: string[] };
      piiRedacted: boolean;
      confidence: { score: number; refused: false };
    }
  | {
      ok: false;
      code: "fairness_refuse" | "low_confidence" | "needs_clarification" | "live_search_failed";
      message: string;
      inventedJobs: false;
      fairness?: { action: "refuse"; reasons: string[] };
      piiRedacted: boolean;
      confidence?: { score: number; refused: true; action: "refuse" | "clarify" };
    };

export type DiscoveryMemoryInput = {
  skills?: string[];
  searchHints?: string;
  conversationContext?: string;
};

/**
 * Discovery specialist: live approved jobs + optional synthetic corpus.
 * Never invents vacancies — cards come only from listLiveJobs / retrieveCorpus.
 * Fairness is enforced BEFORE ranking. Shared memory skills/hints are optional.
 */
export async function runDiscoveryAgent(
  input: {
    question: string;
    sessionSkills?: string[];
    /** Prior skills / preference hints from shared server memory (already redacted). */
    memory?: DiscoveryMemoryInput;
  },
  deps: DiscoveryAgentDeps,
): Promise<DiscoveryAgentResult> {
  const pii = redactPii(input.question);
  const fairness = evaluateFairnessBeforeRank(pii.text);

  if (mustBlockJobRanking(fairness)) {
    return {
      ok: false,
      code: "fairness_refuse",
      message: fairness.message,
      inventedJobs: false,
      fairness: { action: "refuse", reasons: fairness.reasons },
      piiRedacted: pii.redacted,
    };
  }

  const questionUsed = fairness.ok ? fairness.neutralizedQuestion : pii.text;
  const classified = classifyAssistantIntent(questionUsed);

  const memorySkills = input.memory?.skills ?? [];
  const skills = mergeSkillLists(
    memorySkills,
    input.sessionSkills ?? [],
    extractSkillsFromQuestion(questionUsed),
    extractSkillsFromQuestion(input.memory?.conversationContext ?? ""),
  );

  const hints = (input.memory?.searchHints ?? "").trim();
  const questionForSearch = hints
    ? `${questionUsed} ${hints}`.trim().slice(0, 240)
    : questionUsed;

  let liveJobs: Array<LiveApprovedJob | SkillMatchedJob> = [];
  let corpusMatches: CorpusMatch[] = [];
  let ragAvailable = true;

  if (classified.searchJobs || classified.useSkillRanking) {
    const skillHint = skills[0] ?? null;
    const live = await deps.listLiveJobs(questionForSearch, { skillHint });
    if (!live.ok) {
      return {
        ok: false,
        code: "live_search_failed",
        message: live.message,
        inventedJobs: false,
        piiRedacted: pii.redacted,
      };
    }

    // Fairness already passed — safe to rank. Memory skills soft-rank; skill intent still requires hits.
    if (classified.useSkillRanking) {
      liveJobs = rankJobsBySkills(live.jobs, skills, { limit: 8, requireSkillHit: true });
    } else if (skills.length > 0) {
      const ranked = rankJobsBySkills(live.jobs, skills, { limit: 8, requireSkillHit: false });
      liveJobs = ranked.length > 0 ? ranked : live.jobs.slice(0, 8);
    } else {
      liveJobs = live.jobs.slice(0, 8);
    }
  }

  if (classified.useCorpusRag && deps.retrieveCorpus) {
    const corpus = await deps.retrieveCorpus(questionUsed);
    if (corpus.ok) {
      corpusMatches = corpus.matches.slice(0, 5);
    } else {
      ragAvailable = !corpus.unavailable;
    }
  }

  // Never fabricate rows. Empty job-seeking turns refuse or clarify — they must
  // not look like confident recommendations (heuristic score, not calibrated).
  const intentNeedsJobs = classified.searchJobs || classified.useSkillRanking;
  const assessment = assessDiscoveryConfidence({
    liveJobCount: liveJobs.length,
    corpusCount: corpusMatches.length,
    ragAvailable,
    intentNeedsJobs,
  });
  const decision = decideDiscoveryConfidence({
    assessment,
    intentNeedsJobs,
    queryTooVague: isVagueJobSearchQuery(questionUsed),
  });

  if (
    intentNeedsJobs &&
    liveJobs.length === 0 &&
    corpusMatches.length === 0 &&
    decision.action !== "allow"
  ) {
    return {
      ok: false,
      code: decision.action === "clarify" ? "needs_clarification" : "low_confidence",
      message: decision.message,
      inventedJobs: false,
      piiRedacted: pii.redacted,
      confidence: {
        score: assessment.score,
        refused: true,
        action: decision.action === "clarify" ? "clarify" : "refuse",
      },
    };
  }

  return {
    ok: true,
    questionUsed,
    intent: classified.intent,
    liveJobs,
    corpusMatches,
    inventedJobs: false,
    fairness: {
      action: fairness.flagged ? "neutralize" : "pass",
      reasons: fairness.flagged ? fairness.reasons : [],
    },
    piiRedacted: pii.redacted,
    confidence: { score: assessment.score, refused: false },
  };
}

/** Guard: discovery results must never invent job ids. */
export function assertDiscoveryDidNotInventJobs(
  result: DiscoveryAgentResult,
  knownLiveIds: Set<string>,
): boolean {
  if (!result.ok) return result.inventedJobs === false;
  return result.liveJobs.every((j) => knownLiveIds.has(j.id)) && result.inventedJobs === false;
}
