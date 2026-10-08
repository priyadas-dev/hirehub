import type { JobType } from "@/lib/hirehub";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";

/** Browse filters: schema types + Freelance + Remote (work arrangement). */
export type BrowseJobType = JobType | "freelance" | "remote";

export const BROWSE_JOB_TYPE_LABEL: Record<BrowseJobType, string> = {
  ...JOB_TYPE_LABEL,
  freelance: "Freelance",
  remote: "Remote",
};

export const JOB_CATEGORIES = [
  "Technology & IT",
  "Business & Management",
  "Marketing & Sales",
  "Finance & Accounting",
  "HR & Recruitment",
  "Design & Creative",
  "Writing & Content",
  "Healthcare",
  "Legal",
  "Engineering",
  "Education",
  "Retail & Customer Service",
  "Hospitality & Tourism",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Science & Research",
  "Government & Public Sector",
  "NGO / Non-profit",
  "Consulting",
  "Skilled Trades",
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

/** Common city / country / remote suggestions (searchable + free-text). */
export const LOCATION_SUGGESTIONS = [
  "Remote",
  "Worldwide",
  "United States",
  "USA",
  "United Kingdom",
  "UK",
  "Canada",
  "Germany",
  "Netherlands",
  "France",
  "India",
  "Bangladesh",
  "Singapore",
  "Australia",
  "Ireland",
  "Europe",
  "APAC",
  "LATAM",
  "Dhaka",
  "London",
  "New York",
  "San Francisco",
  "Berlin",
  "Toronto",
  "Sydney",
  "Amsterdam",
  "Dubai",
] as const;

type CategoryRule = {
  remotiveCategories: string[];
  keywords: string[];
};

const CATEGORY_RULES: Record<JobCategory, CategoryRule> = {
  "Technology & IT": {
    remotiveCategories: [
      "software development",
      "devops",
      "information technology",
      "qa",
      "artificial intelligence",
      "data and analytics",
    ],
    keywords: [
      "software",
      "developer",
      "engineer",
      "devops",
      "it support",
      "fullstack",
      "frontend",
      "backend",
      "cyber",
      "cloud",
    ],
  },
  "Business & Management": {
    remotiveCategories: ["product", "project management", "sales / business", "business"],
    keywords: ["business", "manager", "operations", "product manager", "project manager", "strategy"],
  },
  "Marketing & Sales": {
    remotiveCategories: ["marketing", "sales"],
    keywords: ["marketing", "sales", "seo", "growth", "account executive", "demand gen"],
  },
  "Finance & Accounting": {
    remotiveCategories: ["finance", "finance / legal"],
    keywords: ["finance", "accounting", "accountant", "bookkeep", "cfo", "controller", "audit"],
  },
  "HR & Recruitment": {
    remotiveCategories: ["human resources"],
    keywords: ["human resources", "hr ", "recruiter", "talent", "people ops", "hiring"],
  },
  "Design & Creative": {
    remotiveCategories: ["design"],
    keywords: ["designer", "design", "ui/ux", "ux ", "ui ", "creative", "figma", "brand"],
  },
  "Writing & Content": {
    remotiveCategories: ["writing"],
    keywords: ["writer", "writing", "content", "copywriter", "editor", "technical writer"],
  },
  Healthcare: {
    remotiveCategories: ["healthcare", "medical"],
    keywords: ["health", "medical", "nurse", "clinical", "pharma", "patient"],
  },
  Legal: {
    remotiveCategories: ["legal", "finance / legal"],
    keywords: ["legal", "lawyer", "counsel", "compliance", "attorney", "paralegal"],
  },
  Engineering: {
    remotiveCategories: ["software development", "engineering"],
    keywords: ["engineer", "engineering", "mechanical", "electrical", "civil", "hardware"],
  },
  Education: {
    remotiveCategories: ["education"],
    keywords: ["education", "teacher", "tutor", "instructor", "curriculum", "learning"],
  },
  "Retail & Customer Service": {
    remotiveCategories: ["customer service", "retail"],
    keywords: ["customer service", "customer support", "retail", "helpdesk", "call center"],
  },
  "Hospitality & Tourism": {
    remotiveCategories: ["hospitality", "tourism"],
    keywords: ["hospitality", "tourism", "hotel", "travel", "restaurant"],
  },
  "Logistics & Supply Chain": {
    remotiveCategories: ["logistics", "supply"],
    keywords: ["logistics", "supply chain", "warehouse", "procurement", "shipping"],
  },
  Manufacturing: {
    remotiveCategories: ["manufacturing"],
    keywords: ["manufacturing", "production", "factory", "industrial"],
  },
  "Science & Research": {
    remotiveCategories: ["science", "research"],
    keywords: ["science", "research", "scientist", "laboratory", "biotech"],
  },
  "Government & Public Sector": {
    remotiveCategories: ["government", "public"],
    keywords: ["government", "public sector", "civil service", "policy"],
  },
  "NGO / Non-profit": {
    remotiveCategories: ["non-profit", "nonprofit", "ngo"],
    keywords: ["non-profit", "nonprofit", "ngo", "charity", "humanitarian"],
  },
  Consulting: {
    remotiveCategories: ["consulting"],
    keywords: ["consultant", "consulting", "advisory"],
  },
  "Skilled Trades": {
    remotiveCategories: ["trades", "skilled"],
    keywords: ["electrician", "plumber", "carpenter", "welder", "technician", "trades"],
  },
};

export type LiveJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  jobType: string;
  category: string;
  postedAt: string;
  url: string;
  source: "Remotive";
};

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type: string | null;
  publication_date: string;
  candidate_required_location: string;
};

type RemotiveResponse = {
  jobs?: RemotiveJob[];
};

const LIVE_JOB_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Internship",
};

export function formatLiveJobType(jobType: string | null | undefined): string {
  if (!jobType) return "Remote";
  return LIVE_JOB_TYPE_LABEL[jobType] ?? jobType.replace(/_/g, " ");
}

/** Normalize Remotive/HireHub type labels to browse filter keys. */
export function normalizeBrowseJobTypeKey(raw: string | null | undefined): string {
  const lower = (raw ?? "").toLowerCase().replace(/\s+/g, "_");
  if (lower.includes("full")) return "full_time";
  if (lower.includes("part")) return "part_time";
  if (lower.includes("freelance")) return "freelance";
  if (lower.includes("contract")) return "contract";
  if (lower.includes("remote")) return "remote";
  return lower;
}

export function matchesLocation(haystack: string | null | undefined, query: string): boolean {
  const loc = (haystack ?? "").trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q === "remote") {
    return !loc || loc.includes("remote") || loc.includes("worldwide") || loc.includes("anywhere");
  }
  return loc.includes(q);
}

export function matchesCategory(
  text: string,
  remotiveCategory: string | undefined,
  category: JobCategory | "all",
): boolean {
  if (category === "all") return true;
  const rule = CATEGORY_RULES[category];
  const hay = text.toLowerCase();
  const remCat = (remotiveCategory ?? "").toLowerCase();
  if (rule.remotiveCategories.some((c) => remCat.includes(c))) return true;
  return rule.keywords.some((kw) => hay.includes(kw));
}

export function matchesBrowseJobType(
  jobType: string | null | undefined,
  location: string | null | undefined,
  filter: BrowseJobType | "all",
  opts?: { treatAsRemoteBoard?: boolean },
): boolean {
  if (filter === "all") return true;
  if (filter === "remote") {
    if (opts?.treatAsRemoteBoard) return true;
    const loc = (location ?? "").toLowerCase();
    return !location?.trim() || loc.includes("remote") || loc.includes("worldwide") || loc.includes("anywhere");
  }
  return normalizeBrowseJobTypeKey(jobType) === filter;
}

export function mergeLocationSuggestions(...lists: Array<Iterable<string | null | undefined>>): string[] {
  const set = new Set<string>();
  for (const loc of LOCATION_SUGGESTIONS) set.add(loc);
  for (const list of lists) {
    for (const raw of list) {
      const v = raw?.trim();
      if (v) set.add(v);
    }
  }
  return Array.from(set).sort((a, b) => {
    if (a === "Remote") return -1;
    if (b === "Remote") return 1;
    return a.localeCompare(b);
  });
}

export function filterLocationSuggestions(all: string[], query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  const remoteFirst = all.filter((l) => l === "Remote");
  const rest = all.filter((l) => l !== "Remote");
  if (!q) return [...remoteFirst, ...rest].slice(0, limit);
  const matched = rest.filter((l) => l.toLowerCase().includes(q));
  const out = q === "remote" || "remote".startsWith(q) ? [...remoteFirst, ...matched] : matched;
  return out.slice(0, limit);
}

/** Fetch current Remotive listings. Not persisted to Supabase. */
export async function fetchLiveJobs(): Promise<LiveJob[]> {
  const res = await fetch("https://remotive.com/api/remote-jobs");
  if (!res.ok) {
    throw new Error(`Live jobs unavailable (${res.status})`);
  }
  const data = (await res.json()) as RemotiveResponse;
  return (data.jobs ?? []).map((j) => ({
    id: `remotive-${j.id}`,
    title: j.title,
    company: j.company_name,
    location: j.candidate_required_location?.trim() || "Remote",
    jobType: formatLiveJobType(j.job_type),
    category: j.category || "General",
    postedAt: j.publication_date,
    url: j.url,
    source: "Remotive" as const,
  }));
}
