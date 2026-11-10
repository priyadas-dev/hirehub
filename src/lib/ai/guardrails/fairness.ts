/**
 * Fairness gate for discovery/ranking — runs BEFORE job ranking.
 * Detects requests to filter or prefer by protected / discriminatory attributes.
 */

export type FairnessDecision =
  | { ok: true; neutralizedQuestion: string; flagged: false }
  | {
      ok: true;
      neutralizedQuestion: string;
      flagged: true;
      action: "neutralize";
      reasons: string[];
    }
  | {
      ok: false;
      action: "refuse";
      reasons: string[];
      message: string;
    };

const REFUSE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\b(only|just)\s+(hire|show|find|want|prefer)\s+(men|women|males?|females?)\b/i,
    reason: "sex_or_gender_exclusive_hiring",
  },
  {
    re: /\b(no|exclude|avoid|don't\s+want)\s+(men|women|males?|females?|muslims?|hindus?|christians?|jews?|black|white|asian)\b/i,
    reason: "exclusion_by_protected_attribute",
  },
  {
    re: /\b(jobs?|roles?|candidates?|applicants?).{0,40}\b(under|over)\s*\d{2}\s*(years?\s*old|yrs?)\b/i,
    reason: "age_cutoff_filter",
  },
  {
    re: /\b(young|older)\s+(candidates?|people|workers?|applicants?).{0,30}\b(only|prefer|must)\b/i,
    reason: "age_preference_filter",
  },
  {
    re: /\b(prefer|want|only)\s+(muslim|hindu|christian|jewish|buddhist)\b/i,
    reason: "religion_preference",
  },
  {
    re: /\b(race|ethnicity|skin\s*color|caste)\b.{0,40}\b(prefer|only|exclude|filter)\b/i,
    reason: "race_or_ethnicity_filter",
  },
  {
    re: /\b(filter|exclude).{0,40}\b(by\s+)?(gender|sex|religion|race|ethnicity|age)\b/i,
    reason: "explicit_discriminatory_filter",
  },
];

const NEUTRALIZE_REPLACEMENTS: Array<{ re: RegExp; with: string }> = [
  { re: /\bonly\s+(for\s+)?(men|women|males?|females?)\b/gi, with: "" },
  { re: /\b(no|exclude)\s+(men|women|muslims?|hindus?|christians?)\b/gi, with: "" },
  { re: /\b(under|over)\s*\d{2}\s*(years?\s*old|yrs?)\b/gi, with: "" },
  { re: /\b(prefer|only)\s+(young|older)\s+(candidates?|people|workers?)\b/gi, with: "candidates" },
  { re: /\b(muslim|hindu|christian|jewish)\s+(only|preferred)\b/gi, with: "" },
  { re: /\bfilter\s+by\s+(gender|sex|religion|race|age)\b/gi, with: "" },
];

export const FAIRNESS_REFUSAL_MESSAGE =
  "I can’t help with job search filters that discriminate by protected attributes such as gender, age, religion, race, or ethnicity. Ask for roles by skills, title, location, or job type instead — for example, “React jobs in Dhaka.”";

/**
 * Evaluate fairness before any ranking / recommend call.
 * Strong exclusive bias → refuse. Mild bias language → neutralize and continue.
 */
export function evaluateFairnessBeforeRank(question: string): FairnessDecision {
  const reasons: string[] = [];
  for (const p of REFUSE_PATTERNS) {
    if (p.re.test(question)) reasons.push(p.reason);
  }

  const exclusive =
    /\bonly\s+(hire|show|find|want)\b/i.test(question) ||
    /\b(no|exclude)\s+(men|women|muslims?|hindus?)\b/i.test(question) ||
    /\bfilter\s+by\s+(gender|sex|religion|race|age)\b/i.test(question);

  if (reasons.length > 0 && exclusive) {
    return {
      ok: false,
      action: "refuse",
      reasons,
      message: FAIRNESS_REFUSAL_MESSAGE,
    };
  }

  if (reasons.length === 0) {
    return { ok: true, neutralizedQuestion: question, flagged: false };
  }

  let neutralized = question;
  for (const rule of NEUTRALIZE_REPLACEMENTS) {
    neutralized = neutralized.replace(rule.re, rule.with);
  }
  neutralized = neutralized.replace(/\s{2,}/g, " ").trim();
  if (neutralized.length < 3) {
    return {
      ok: false,
      action: "refuse",
      reasons,
      message: FAIRNESS_REFUSAL_MESSAGE,
    };
  }

  return {
    ok: true,
    neutralizedQuestion: neutralized,
    flagged: true,
    action: "neutralize",
    reasons,
  };
}

/** True when discovery must not rank/filter jobs for this turn. */
export function mustBlockJobRanking(decision: FairnessDecision): boolean {
  return !decision.ok && decision.action === "refuse";
}
