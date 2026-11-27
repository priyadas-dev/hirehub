import {
  classifyAssistantIntent,
  noLiveJobsMatchAnswer,
} from "@/lib/ai/assistant-intent";
import {
  evaluateFairnessBeforeRank,
  mustBlockJobRanking,
  assessDiscoveryConfidence,
  decideDiscoveryConfidence,
  isVagueJobSearchQuery,
  CLARIFY_JOB_SEARCH_MESSAGE,
  redactPii,
} from "@/lib/ai/guardrails";
import type { CorpusMatch } from "@/lib/ai/corpus";
import {
  filterLiveJobsByRoleRelevance,
  isRoleHeavyLiveQuery,
  parseLiveJobQuery,
  type LiveApprovedJob,
} from "@/lib/ai/live-recommend";
import { extractLiveTermsFromCorpusMatches } from "@/lib/ai/live-query-understand";
import { rankJobsBySkills, type SkillMatchedJob } from "@/lib/ai/skill-match";
import { extractSkillsFromQuestion, mergeSkillLists } from "@/lib/ai/skill-extract";

export type DiscoveryAgentDeps = {
  listLiveJobs: (
    question: string,
    opts?: { skillHint?: string | null; skillTerms?: string[] },
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
      /** Optional seeker-facing note (e.g. location broadened). */
      answerNote?: string;
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
  const intentNeedsJobs = classified.searchJobs || classified.useSkillRanking;
  const queryTooVague = isVagueJobSearchQuery(questionUsed);
  const parsedAsk = parseLiveJobQuery(questionUsed);

  // Vague “find jobs” with no skills/memory/hints → clarify before dumping a random job pool.
  if (intentNeedsJobs && queryTooVague && skills.length === 0 && !hints) {
    return {
      ok: false,
      code: "needs_clarification",
      message: CLARIFY_JOB_SEARCH_MESSAGE,
      inventedJobs: false,
      piiRedacted: pii.redacted,
      confidence: { score: 0.2, refused: true, action: "clarify" },
    };
  }

  // Skill searches must put skills first so live ILIKE can find React/SQL/etc.
  const questionForSearch = (
    (classified.useSkillRanking || skills.length > 0) && skills.length
      ? `${skills.join(" ")} ${questionUsed} ${hints}`
      : hints
        ? `${questionUsed} ${hints}`
        : questionUsed
  )
    .trim()
    .slice(0, 240);

  let liveJobs: Array<LiveApprovedJob | SkillMatchedJob> = [];
  let corpusMatches: CorpusMatch[] = [];
  let ragAvailable = true;
  let answerNote: string | undefined;
  let broadenedPastLocation = false;

  if (classified.searchJobs || classified.useSkillRanking) {
    let live = await deps.listLiveJobs(questionForSearch, {
      skillHint: skills[0] ?? null,
      skillTerms: skills,
    });
    if (!live.ok) {
      return {
        ok: false,
        code: "live_search_failed",
        message: live.message,
        inventedJobs: false,
        piiRedacted: pii.redacted,
      };
    }

    // Retry with skills-only when NL (+ location) returned an empty pool.
    // Not gated on useSkillRanking — "React frontend jobs in Dhaka" often has skills
    // but classifyAssistantIntent leaves useSkillRanking false.
    if (live.jobs.length === 0 && skills.length > 0) {
      const skillOnly = await deps.listLiveJobs(skills.join(" "), {
        skillHint: skills[0] ?? null,
        skillTerms: skills,
      });
      if (skillOnly.ok && skillOnly.jobs.length > 0) {
        live = skillOnly;
        if (parsedAsk.locations.length > 0) broadenedPastLocation = true;
      }
    }

    // Empty live hit: use corpus RAG only to expand search terms (never as applyable cards).
    // Preserves the existing ~20k embeddings without mixing them into job card IDs.
    if (live.jobs.length === 0 && deps.retrieveCorpus) {
      const corpusExpand = await deps.retrieveCorpus(questionUsed);
      if (corpusExpand.ok && corpusExpand.matches.length > 0) {
        corpusMatches = corpusExpand.matches.slice(0, 5);
        const extra = extractLiveTermsFromCorpusMatches(corpusExpand.matches, 8);
        if (extra.length > 0) {
          const expandedQ = `${questionUsed} ${extra.join(" ")}`.trim().slice(0, 240);
          const retry = await deps.listLiveJobs(expandedQ, {
            skillHint: skills[0] ?? null,
            skillTerms: skills,
          });
          if (retry.ok && retry.jobs.length > 0) live = retry;
          // Still empty after expand + location: try skills + expand terms without location.
          if (live.jobs.length === 0 && skills.length > 0) {
            const broad = await deps.listLiveJobs(`${skills.join(" ")} ${extra.join(" ")}`.trim(), {
              skillHint: skills[0] ?? null,
              skillTerms: skills,
            });
            if (broad.ok && broad.jobs.length > 0) {
              live = broad;
              if (parsedAsk.locations.length > 0) broadenedPastLocation = true;
            }
          }
        }
      } else if (!corpusExpand.ok) {
        ragAvailable = !corpusExpand.unavailable;
      }
    }

    // Fairness already passed — safe to rank.
    // Never dump unrelated "recent approved" cards for a software/role ask.
    const roleHeavy = isRoleHeavyLiveQuery(parseLiveJobQuery(questionUsed));
    const roleSafePool = filterLiveJobsByRoleRelevance(live.jobs, questionUsed);
    const rankWithSkills = classified.useSkillRanking || skills.length > 0;
    // After a location broaden, do not re-apply Dhaka/etc. filters that emptied the first pool.
    const poolBase = broadenedPastLocation
      ? live.jobs
      : roleHeavy
        ? roleSafePool
        : live.jobs;

    if (rankWithSkills && skills.length > 0) {
      const strict = rankJobsBySkills(poolBase, skills, { limit: 8, requireSkillHit: true });
      if (strict.length > 0) {
        liveJobs = strict;
      } else if (!roleHeavy || broadenedPastLocation) {
        // Soft skill rank when skill-led, or after we intentionally dropped location.
        const soft = rankJobsBySkills(poolBase, skills, { limit: 8, requireSkillHit: false });
        liveJobs = soft.filter((j) => j.matchedSkills.length > 0).slice(0, 8);
      } else {
        liveJobs = poolBase.slice(0, 8);
      }
    } else {
      // Industry / title searches must not be emptied by leftover session skills.
      liveJobs = poolBase.slice(0, 8);
    }

    if (broadenedPastLocation && liveJobs.length > 0 && parsedAsk.locations[0]) {
      answerNote = `No approved jobs matched ${parsedAsk.locations[0]} with those filters, so I broadened the search. Here are the closest HireHub matches — open a card to view or apply.`;
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
  const assessment = assessDiscoveryConfidence({
    liveJobCount: liveJobs.length,
    corpusCount: corpusMatches.length,
    ragAvailable,
    intentNeedsJobs,
  });
  const decision = decideDiscoveryConfidence({
    assessment,
    intentNeedsJobs,
    queryTooVague,
  });

  // Job search with 0 live cards: do not fall through to “synthetic career context”.
  if (intentNeedsJobs && liveJobs.length === 0) {
    const emptyMessage =
      decision.action === "clarify"
        ? decision.message
        : noLiveJobsMatchAnswer({ location: parsedAsk.locations[0] ?? null });
    return {
      ok: false,
      code: decision.action === "clarify" ? "needs_clarification" : "low_confidence",
      message: emptyMessage,
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
    answerNote,
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
