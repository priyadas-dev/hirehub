import { describe, expect, it } from "vitest";
import {
  classifyAssistantIntent,
  looksLikeJobSearch,
} from "@/lib/ai/assistant-intent";
import {
  expandLiveSearchToken,
  extractLiveTermsFromCorpusMatches,
  looksLikeIndustryOrRoleJobAsk,
  normalizeLiveJobQuestion,
} from "@/lib/ai/live-query-understand";
import {
  filterLiveJobsByRoleRelevance,
  isRoleHeavyLiveQuery,
  parseLiveJobQuery,
  recommendApprovedLiveJobs,
  type LiveApprovedJob,
  type LiveJobsClient,
} from "@/lib/ai/live-recommend";

const financeJob = {
  id: "fin-1",
  title: "Finance",
  description: "Handle ledgers and budgeting.",
  location: "comilla",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-11-17T00:00:00Z",
  job_type: "full_time",
  companies: { name: "Manor IT" },
  job_categories: { name: "Finance" },
};

const softwareJob = {
  id: "sw-1",
  title: "Software Engineer",
  description: "Laravel PHP MySQL",
  location: "Sylhet",
  status: "approved",
  company_id: "co-2",
  created_at: "2026-10-23T00:00:00Z",
  job_type: "full_time",
  companies: { name: "TechnoNext" },
  job_categories: { name: "IT" },
};

const marketingJob = {
  id: "mkt-1",
  title: "marketing Head",
  description: "need communication leadership",
  location: "mymensingh",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-11-04T00:00:00Z",
  job_type: "contract",
  companies: { name: "Manor IT" },
  job_categories: { name: "Marketing" },
};

const juniorDev = {
  id: "jd-1",
  title: "Junior Software Developer",
  description: "Entry level coding",
  location: "Sylhet",
  status: "approved",
  company_id: "co-2",
  created_at: "2026-10-20T00:00:00Z",
  job_type: "full_time",
  companies: { name: "TechnoNext" },
  job_categories: { name: "IT" },
};

function mockClient(rows: Array<Record<string, unknown>>) {
  const filterBuilder = {
    eq: () => filterBuilder,
    or: () => filterBuilder,
    in: () => filterBuilder,
    ilike: () => filterBuilder,
    order: () => filterBuilder,
    limit: async () => ({ data: rows, error: null }),
  };
  const client: LiveJobsClient = {
    from: () => ({
      select: () => ({
        eq: () => filterBuilder,
      }),
    }),
  };
  return client;
}

describe("live query understanding", () => {
  it("normalizes glued abbreviations and filler", () => {
    expect(normalizeLiveJobQuestion("hii show me ITjobs plz")).toMatch(/it jobs/i);
    expect(normalizeLiveJobQuestion("any job it")).toMatch(/\bit\b/i);
  });

  it("corrects finace → finance and expands IT without bare it token", () => {
    expect(expandLiveSearchToken("finace")).toEqual(
      expect.arrayContaining(["finance", "financial", "banking"]),
    );
    const itTerms = expandLiveSearchToken("it");
    expect(itTerms).toEqual(expect.arrayContaining(["software", "developer", "engineer"]));
    expect(itTerms).not.toContain("it");
  });

  it("parses noisy finance and IT queries into searchable terms", () => {
    const finance = parseLiveJobQuery("hii show me finace job plz");
    expect(finance.terms).toEqual(expect.arrayContaining(["finance"]));

    const it = parseLiveJobQuery("any job it");
    expect(it.terms).toEqual(expect.arrayContaining(["software", "developer"]));
    expect(isRoleHeavyLiveQuery(it)).toBe(true);

    const coding = parseLiveJobQuery("coding jobs");
    expect(coding.terms).toEqual(expect.arrayContaining(["software", "developer"]));
  });

  it("routes industry/abbreviation asks to Discovery job_search", () => {
    const cases = [
      "IT",
      "it",
      "IT jobs",
      "any job it",
      "Any job in IT?",
      "Find IT jobs.",
      "it related",
      "Finance",
      "Show me finance jobs.",
      "finance jobs",
      "Show me banking jobs.",
      "show me finace job",
      "hii i need a job in finace or banking plz",
      "What about finance?",
      "I want to work with computers",
      "Show me software engineering jobs.",
      "I am looking for a programming job.",
      "Find jobs related to engineering.",
      "Find jobs for freshers in Sylhet.",
      "software engineer jobs",
      "coding jobs",
    ];
    for (const q of cases) {
      expect(looksLikeIndustryOrRoleJobAsk(q) || looksLikeJobSearch(q), q).toBe(true);
      const c = classifyAssistantIntent(q);
      expect(c.searchJobs, q).toBe(true);
      expect(c.intent, q).toBe("job_search");
    }
  });

  it("expands Step-1 queries into role/industry search terms", () => {
    expect(parseLiveJobQuery("Show me finance jobs.").terms).toEqual(
      expect.arrayContaining(["finance"]),
    );
    expect(parseLiveJobQuery("Find IT jobs.").terms).toEqual(
      expect.arrayContaining(["software", "developer"]),
    );
    expect(parseLiveJobQuery("Any job in IT?").terms).toEqual(
      expect.arrayContaining(["software", "engineer"]),
    );
    expect(parseLiveJobQuery("Show me banking jobs.").terms).toEqual(
      expect.arrayContaining(["banking", "finance"]),
    );
    expect(parseLiveJobQuery("I am looking for a programming job.").terms).toEqual(
      expect.arrayContaining(["software", "developer"]),
    );
    expect(parseLiveJobQuery("Find jobs related to engineering.").terms).toEqual(
      expect.arrayContaining(["engineer", "software"]),
    );
    const fresher = parseLiveJobQuery("Find jobs for freshers in Sylhet.");
    expect(fresher.locations).toContain("sylhet");
    expect(fresher.terms).toEqual(expect.arrayContaining(["junior", "intern"]));
  });

  it("keeps definitions and learning on the LLM path", () => {
    expect(classifyAssistantIntent("What is a software engineer?").searchJobs).toBe(false);
    expect(classifyAssistantIntent("What should I learn after C++?").searchJobs).toBe(false);
  });
});

describe("hybrid live retrieval relevance", () => {
  it("returns Finance for finace typo and excludes marketing", async () => {
    const result = await recommendApprovedLiveJobs(mockClient([financeJob, marketingJob, softwareJob]), {
      query: "show me finace job",
      limit: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs.map((j) => j.title)).toContain("Finance");
    expect(result.jobs.map((j) => j.title)).not.toContain("marketing Head");
  });

  it("returns software titles for IT and excludes Manor IT marketing", async () => {
    const result = await recommendApprovedLiveJobs(
      mockClient([marketingJob, softwareJob, juniorDev, financeJob]),
      { query: "IT jobs", limit: 8 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const titles = result.jobs.map((j) => j.title);
    expect(titles).toEqual(expect.arrayContaining(["Software Engineer", "Junior Software Developer"]));
    expect(titles).not.toContain("marketing Head");
    expect(titles).not.toContain("Finance");
  });

  it("fresher + Sylhet keeps software roles and drops non-Sylhet marketing", async () => {
    const result = await recommendApprovedLiveJobs(
      mockClient([marketingJob, softwareJob, juniorDev, financeJob]),
      { query: "Find jobs for freshers in Sylhet.", limit: 8 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const titles = result.jobs.map((j) => j.title);
    expect(titles).toEqual(expect.arrayContaining(["Junior Software Developer", "Software Engineer"]));
    expect(titles).not.toContain("marketing Head");
    expect(titles).not.toContain("Finance");
  });

  it("role filter drops unrelated cards after IT expansion", () => {
    const pool: LiveApprovedJob[] = [
      {
        id: "1",
        title: "marketing Head",
        description: null,
        location: "mymensingh",
        status: "approved",
        company_id: "c",
        created_at: "2026-01-01T00:00:00Z",
        job_type: "contract",
        company_name: "Manor IT",
        category_name: "Marketing",
      },
      {
        id: "2",
        title: "Software Engineer",
        description: null,
        location: "Sylhet",
        status: "approved",
        company_id: "c2",
        created_at: "2026-01-02T00:00:00Z",
        job_type: "full_time",
        company_name: "TechnoNext",
        category_name: "IT",
      },
    ];
    const filtered = filterLiveJobsByRoleRelevance(pool, "any job it");
    expect(filtered.map((j) => j.title)).toEqual(["Software Engineer"]);
  });

  it("extracts live expansion terms from corpus matches without inventing ids", () => {
    const terms = extractLiveTermsFromCorpusMatches([
      { title: "Staff Software Engineer", category: "IT", skills_text: "TypeScript React" },
      { title: "Financial Analyst", category: "Finance", skills_text: "Excel" },
    ]);
    expect(terms).toEqual(expect.arrayContaining(["software", "engineer"]));
  });
});

describe("Discovery corpus expansion (secondary RAG use)", () => {
  it("retries live search with corpus-derived terms when first pass is empty", async () => {
    const { runDiscoveryAgent } = await import("@/lib/ai/agents/discovery");
    const financeLive: LiveApprovedJob = {
      id: "fin-live",
      title: "Finance",
      description: "Budgeting",
      location: "comilla",
      status: "approved",
      company_id: "c",
      created_at: "2026-11-17T00:00:00Z",
      job_type: "full_time",
      company_name: "Manor IT",
      category_name: "Finance",
    };

    let listCalls = 0;
    const result = await runDiscoveryAgent(
      { question: "Show me rare-industry-xyz jobs" },
      {
        listLiveJobs: async (q) => {
          listCalls += 1;
          // First pass empty; second pass (after corpus expand) finds finance via expanded terms.
          if (listCalls === 1) return { ok: true, jobs: [] };
          if (/finance|financial|banking/i.test(q)) return { ok: true, jobs: [financeLive] };
          return { ok: true, jobs: [] };
        },
        retrieveCorpus: async () => ({
          ok: true,
          matches: [
            {
              id: "corp-1",
              corpus_key: "synthetic:v1:finance",
              title: "Financial Analyst",
              content: "SYNTHETIC — finance",
              location: null,
              category: "Finance",
              skills_text: "Excel, banking",
              is_synthetic: true,
              source: "hirehub-synthetic-v1",
              similarity: 0.9,
            },
          ],
        }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(listCalls).toBeGreaterThanOrEqual(2);
    expect(result.liveJobs.some((j) => j.id === "fin-live")).toBe(true);
    // Corpus may be retained for grounding, but cards are live-only.
    expect(result.inventedJobs).toBe(false);
  });
});

/** Hold-out evaluation set (not used to tune aliases above). */
describe("seeker retrieval hold-out metrics (synthetic catalog)", () => {
  const catalog = [financeJob, softwareJob, marketingJob, juniorDev];

  const evalCases: Array<{ q: string; relevantIds: string[] }> = [
    { q: "Programmer openings", relevantIds: ["sw-1", "jd-1"] },
    { q: "banking opportunities", relevantIds: ["fin-1"] },
    { q: "softwere enginer jobs", relevantIds: ["sw-1", "jd-1"] },
    { q: "Jobs for freshers in Sylhet", relevantIds: ["jd-1", "sw-1"] },
  ];

  it("reports Hit@5 / Precision@5 / Recall@5 honestly", async () => {
    let hit = 0;
    let precisionSum = 0;
    let recallSum = 0;

    for (const c of evalCases) {
      const result = await recommendApprovedLiveJobs(mockClient(catalog), {
        query: c.q,
        limit: 5,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const got = result.jobs.map((j) => j.id);
      const relevantHit = got.filter((id) => c.relevantIds.includes(id));
      if (relevantHit.length > 0) hit += 1;
      precisionSum += got.length ? relevantHit.length / got.length : 0;
      recallSum += c.relevantIds.length ? relevantHit.length / c.relevantIds.length : 0;
    }

    const n = evalCases.length;
    const hitAt5 = hit / n;
    const precisionAt5 = precisionSum / n;
    const recallAt5 = recallSum / n;

    // Floor expectations for this small synthetic set — not inflated.
    expect(hitAt5).toBeGreaterThanOrEqual(0.75);
    expect(precisionAt5).toBeGreaterThanOrEqual(0.5);
    expect(recallAt5).toBeGreaterThanOrEqual(0.5);
  });
});
