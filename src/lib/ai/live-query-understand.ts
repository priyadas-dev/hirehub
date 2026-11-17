/**
 * Seeker live-job query understanding: normalize noisy NL, expand industries /
 * abbreviations / synonyms, and fuzzy-correct common typos before ILIKE search.
 *
 * Does not call embeddings — keeps chat latency stable. Corpus RAG may still
 * expand empty searches separately in Discovery.
 */

import { tokensFuzzyEqual } from "@/lib/ai/corpus-rerank";

/** Short tokens allowed through the min-length gate (abbreviations). */
export const SHORT_ABBREV_TOKENS = new Set(["it", "hr", "qa", "ml", "ai", "ui", "ux"]);

/**
 * Industry / synonym expansion. Values become searchable ILIKE terms.
 * For "it", omit the raw "it" token — substring "it" false-positives (Writer, Manor IT).
 */
export const LIVE_TERM_ALIASES: Record<string, string[]> = {
  // Informal coding
  coding: ["software", "developer", "engineer", "programming"],
  code: ["software", "developer", "engineer"],
  programming: ["software", "developer", "engineer", "programming"],
  programmer: ["software", "developer", "engineer", "programmer"],
  engineering: ["engineer", "software"],
  frontend: ["frontend", "front-end", "react", "ui"],
  backend: ["backend", "back-end", "api", "server"],
  fullstack: ["full-stack", "fullstack", "software", "developer"],
  "full-stack": ["full-stack", "fullstack", "software", "developer"],
  devops: ["devops", "sre", "infrastructure"],
  // IT / tech industry (do not emit bare "it")
  it: ["software", "developer", "engineer", "programming", "devops", "frontend", "backend", "testing", "qa"],
  tech: ["software", "developer", "engineer", "technology"],
  technology: ["software", "developer", "engineer", "technology"],
  computers: ["software", "developer", "engineer", "computer"],
  computer: ["software", "developer", "engineer", "computer"],
  // Finance
  finance: ["finance", "financial", "banking", "accounting", "accountant"],
  financial: ["finance", "financial", "banking", "accounting"],
  banking: ["banking", "finance", "bank", "financial"],
  bank: ["banking", "finance", "bank"],
  accounting: ["accounting", "accountant", "finance", "financial"],
  accountant: ["accountant", "accounting", "finance"],
  // HR / people
  hr: ["hr", "human", "resources", "recruitment", "recruiting", "admin", "people"],
  "human-resources": ["hr", "human", "resources", "recruitment", "admin"],
  // QA / ML / AI
  qa: ["qa", "quality", "testing", "test", "assurance"],
  ml: ["machine", "learning", "ml", "ai"],
  ai: ["ai", "artificial", "intelligence", "machine", "learning"],
  // Marketing / sales / design
  marketing: ["marketing", "market", "brand", "social", "media"],
  sales: ["sales", "business", "account"],
  design: ["design", "designer", "ui", "ux", "creative"],
  // Experience
  fresher: ["intern", "junior", "entry", "fresher", "graduate"],
  freshers: ["intern", "junior", "entry", "fresher", "graduate"],
  graduate: ["intern", "junior", "entry", "graduate", "fresher"],
  entry: ["intern", "junior", "entry", "fresher"],
  junior: ["junior", "intern", "entry"],
};

/** Vocabulary for typo correction (edit-distance via tokensFuzzyEqual). */
const TYPO_VOCAB = [
  "finance",
  "financial",
  "banking",
  "accounting",
  "accountant",
  "software",
  "engineer",
  "engineering",
  "developer",
  "programming",
  "programmer",
  "frontend",
  "backend",
  "fullstack",
  "devops",
  "marketing",
  "sales",
  "design",
  "designer",
  "testing",
  "intern",
  "junior",
  "senior",
  "remote",
  "dhaka",
  "sylhet",
  "chittagong",
  "recruitment",
  "technology",
  "computer",
  "computers",
  "fresher",
  "freshers",
  "graduate",
  "python",
  "react",
  "javascript",
  "typescript",
  "laravel",
  "manager",
  "admin",
  "human",
  "resources",
] as const;

/** Explicit misspellings seen in live seeker chat. */
const EXPLICIT_TYPOS: Record<string, string> = {
  finace: "finance",
  finans: "finance",
  finanace: "finance",
  finacee: "finance",
  softwere: "software",
  softwar: "software",
  softwre: "software",
  enginer: "engineer",
  engeneer: "engineer",
  engineeer: "engineer",
  developr: "developer",
  develope: "developer",
  developper: "developer",
  programing: "programming",
  programer: "programmer",
  marketeing: "marketing",
  marketting: "marketing",
  accouting: "accounting",
  accountent: "accountant",
  recuitment: "recruitment",
  tecnology: "technology",
  techology: "technology",
};

/** Industry / role cues that mean "search jobs" even without find/show verbs. */
export const INDUSTRY_OR_ROLE_CUE =
  /\b(it|hr|qa|ml|ai|ui|ux|finance|financial|banking|accounting|accountant|software|developer|engineer|engineering|programming|programmer|coding|frontend|backend|fullstack|full[\s-]?stack|devops|marketing|sales|design|designer|testing|tech|technology|computers?|fresher|freshers|graduate|junior|intern)\b/i;

/**
 * Normalize glued abbreviations and common chat noise before tokenization.
 */
export function normalizeLiveJobQuestion(raw: string): string {
  let q = raw.replace(/\s+/g, " ").trim();
  if (!q) return q;

  // Split glued forms: ITjobs, finacejob, HRjobs
  q = q.replace(/\b(it|hr|qa|ml|ai)(jobs?|openings?|roles?|positions?)\b/gi, "$1 $2");
  q = q.replace(/\b(finace|finance|software|developer|engineer)(jobs?|openings?)\b/gi, "$1 $2");

  // "any job it" / "job it" → treat trailing industry as searchable
  q = q.replace(/\b(jobs?|openings?|roles?|positions?)\s+(it|hr|qa)\b/gi, "$2 $1");

  // Soften filler without deleting industry meaning
  q = q
    .replace(/\b(hii+|hi+|hello|hey|plz|pls|please|thx|thanks)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Correct known typos so intent + ILIKE see "finance" not "finace"
  q = q
    .split(/\s+/)
    .map((tok) => {
      const cleaned = tok.replace(/[^a-zA-Z0-9+#.-]/g, "");
      if (!cleaned) return tok;
      const fixed = correctTypoToken(cleaned.toLowerCase());
      if (fixed === cleaned.toLowerCase()) return tok;
      return tok.replace(new RegExp(cleaned, "i"), fixed);
    })
    .join(" ");

  return q;
}

function correctTypoToken(token: string): string {
  const lower = token.toLowerCase();
  if (EXPLICIT_TYPOS[lower]) return EXPLICIT_TYPOS[lower]!;
  if (LIVE_TERM_ALIASES[lower] || SHORT_ABBREV_TOKENS.has(lower)) return lower;
  if (lower.length < 4) return lower;

  let best: string | null = null;
  for (const vocab of TYPO_VOCAB) {
    if (tokensFuzzyEqual(lower, vocab)) {
      // Prefer exact-length-close matches; first hit is fine for our vocab size.
      best = vocab;
      break;
    }
  }
  return best ?? lower;
}

/**
 * Expand a single normalized token into searchable terms (aliases + self).
 * Returns [] when the token should be dropped (e.g. bare "it" after alias expand).
 */
export function expandLiveSearchToken(token: string): string[] {
  const corrected = correctTypoToken(token);
  const aliases = LIVE_TERM_ALIASES[corrected];
  if (aliases) {
    // Industry aliases already include the useful search forms; skip emitting
    // ultra-short tokens that cause substring false positives.
    return aliases.filter((t) => t.length >= 2);
  }
  if (SHORT_ABBREV_TOKENS.has(corrected)) {
    return [corrected];
  }
  return [corrected];
}

/** True when the message is primarily an industry/role job seek (for intent). */
export function looksLikeIndustryOrRoleJobAsk(question: string): boolean {
  const q = normalizeLiveJobQuestion(question).toLowerCase();
  if (!q) return false;

  // Bare industry / role: "IT", "Finance", "developer?"
  if (
    /^(it|hr|qa|ml|ai|finance|financial|banking|accounting|software|developer|engineer|programming|coding|marketing|sales|design|tech|technology)\??$/i.test(
      q,
    )
  ) {
    return true;
  }

  // "it related", "finance sector", "banking opportunities"
  if (
    INDUSTRY_OR_ROLE_CUE.test(q) &&
    /\b(jobs?|jubs?|openings?|vacancies|positions?|roles?|opportunit(?:y|ies)?|related|sector|field|industry|vacancies|vacancy)\b/i.test(
      q,
    )
  ) {
    return true;
  }

  // "any job it", "any it", "need something in software/finance"
  if (
    /\b(any|some|need|want|looking)\b/i.test(q) &&
    INDUSTRY_OR_ROLE_CUE.test(q)
  ) {
    return true;
  }

  // Conversational: work with computers / in technology / in finance / software work
  if (
    /\b(work with computers|work in (it|tech|technology|finance|banking|software)|job in (it|tech|technology|finance|banking|software)|something in (software|finance|it|tech|programming)|software work|programming work)\b/i.test(
      q,
    )
  ) {
    return true;
  }

  // "find something related to programming" / "anything related to finance"
  if (
    /\b(something|anything|jobs?|roles?)\b[\s\S]{0,40}\brelated\b[\s\S]{0,40}/i.test(q) &&
    INDUSTRY_OR_ROLE_CUE.test(q)
  ) {
    return true;
  }

  // "i need a software work" / "want engineering work"
  if (
    /\b(need|want|looking for)\b[\s\S]{0,40}\b(software|engineer|engineering|programming|finance|banking|it)\b[\s\S]{0,24}\b(work|job|role|gig)?\b/i.test(
      q,
    )
  ) {
    return true;
  }

  // Topic switch follow-up: "what about finance?", "how about IT?", "what about banking?"
  if (/^(what|how) about\b/i.test(q) && INDUSTRY_OR_ROLE_CUE.test(q)) {
    return true;
  }

  return false;
}

/**
 * Pull extra live-search keywords from corpus RAG hits (titles / categories / skills).
 * Never treats corpus rows as applyable jobs.
 */
export function extractLiveTermsFromCorpusMatches(
  matches: Array<{
    title?: string | null;
    category?: string | null;
    skills_text?: string | null;
  }>,
  limit = 8,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.toLowerCase().trim();
    if (t.length < 3 && !SHORT_ABBREV_TOKENS.has(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  for (const m of matches) {
    for (const piece of [m.category, m.title, m.skills_text]) {
      if (!piece) continue;
      for (const tok of piece.toLowerCase().split(/[^a-z0-9+#]+/)) {
        if (!tok) continue;
        const expanded = expandLiveSearchToken(tok);
        for (const e of expanded) push(e);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
