import type { JobType } from "@/lib/hirehub";
import { JOB_TYPE_LABEL } from "@/lib/hirehub";

/** Browse filter includes schema job types plus Remote as a work-arrangement filter. */
export type BrowseJobType = JobType | "remote";

export const BROWSE_JOB_TYPE_LABEL: Record<BrowseJobType, string> = {
  ...JOB_TYPE_LABEL,
  remote: "Remote",
};

export const JOB_CATEGORIES = [
  "Software Development",
  "Frontend",
  "Backend",
  "Full Stack",
  "QA",
  "DevOps / Cloud",
  "AI / ML",
  "Data",
  "UI/UX / Design",
  "Cybersecurity",
] as const;

export type JobCategory = (typeof JOB_CATEGORIES)[number];

/** Common city / country / remote suggestions for the location field. */
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
  "India",
  "Bangladesh",
  "Singapore",
  "Australia",
  "Ireland",
  "Europe",
  "APAC",
  "Dhaka",
  "London",
  "New York",
  "San Francisco",
  "Berlin",
  "Toronto",
  "Sydney",
] as const;

type CategoryRule = {
  remotiveCategories: string[];
  keywords: string[];
};

const CATEGORY_RULES: Record<JobCategory, CategoryRule> = {
  "Software Development": {
    remotiveCategories: ["software development"],
    keywords: ["software", "developer", "engineer", "programming", "sde"],
  },
  Frontend: {
    remotiveCategories: [],
    keywords: ["frontend", "front-end", "front end", "react", "vue", "angular", "next.js", "ui engineer"],
  },
  Backend: {
    remotiveCategories: ["software development"],
    keywords: ["backend", "back-end", "back end", "api engineer", "server-side", "node.js", "django", "spring"],
  },
  "Full Stack": {
    remotiveCategories: ["software development"],
    keywords: ["full stack", "fullstack", "full-stack"],
  },
  QA: {
    remotiveCategories: ["qa", "quality assurance"],
    keywords: ["qa", "quality assurance", "test engineer", "sdet", "automation test"],
  },
  "DevOps / Cloud": {
    remotiveCategories: ["devops", "dev ops"],
    keywords: ["devops", "dev ops", "sre", "kubernetes", "cloud engineer", "aws", "azure", "gcp", "platform engineer"],
  },
  "AI / ML": {
    remotiveCategories: ["artificial intelligence", "ai"],
    keywords: ["ai ", " ai", "machine learning", "ml engineer", "llm", "deep learning", "nlp"],
  },
  Data: {
    remotiveCategories: ["data", "data and analytics"],
    keywords: ["data scientist", "data engineer", "data analyst", "analytics", "etl", "warehouse"],
  },
  "UI/UX / Design": {
    remotiveCategories: ["design", "product design"],
    keywords: ["ui/ux", "ux designer", "ui designer", "product design", "figma", "graphic design"],
  },
  Cybersecurity: {
    remotiveCategories: ["cybersecurity", "security"],
    keywords: ["cybersecurity", "cyber security", "infosec", "security engineer", "penetration", "appsec"],
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

const REMOTE_JOB_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  freelance: "Freelance",
  internship: "Internship",
};

export function formatLiveJobType(jobType: string | null | undefined): string {
  if (!jobType) return "Remote";
  return REMOTE_JOB_TYPE_LABEL[jobType] ?? jobType.replace(/_/g, " ");
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

export function matchesCategory(text: string, remotiveCategory: string | undefined, category: JobCategory | "all"): boolean {
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
  return (jobType ?? "").toLowerCase() === filter;
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
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** Fetch current Remotive listings. Client-safe; API allows CORS. Not persisted. */
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
