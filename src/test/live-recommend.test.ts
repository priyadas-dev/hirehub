import { describe, expect, it } from "vitest";
import {
  escapeIlikePattern,
  extractLiveJobSearchTerms,
  parseLiveJobQuery,
  recommendApprovedLiveJobs,
  type LiveJobsClient,
} from "@/lib/ai/live-recommend";

function mockClient(
  rows: Array<Record<string, unknown>>,
  capture: { or?: string; jobTypeEq?: string; jobTypeIn?: string[] },
) {
  const filterBuilder = {
    eq: (column: string, value: string) => {
      if (column === "job_type") capture.jobTypeEq = value;
      return filterBuilder;
    },
    or: (filters: string) => {
      capture.or = filters;
      return filterBuilder;
    },
    in: (column: string, values: string[]) => {
      if (column === "job_type") capture.jobTypeIn = values;
      return filterBuilder;
    },
    ilike: () => filterBuilder,
    order: () => filterBuilder,
    limit: async () => ({ data: rows, error: null }),
  };
  const client: LiveJobsClient = {
    from: (table) => {
      expect(table).toBe("jobs");
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            expect(column).toBe("status");
            expect(value).toBe("approved");
            return filterBuilder;
          },
        }),
      };
    },
  };
  return client;
}

const softwareDev = {
  id: "52267b9c-77c4-44e8-83c5-0347aa5ac593",
  title: "Software Developer",
  description: "Need Laravel and Vue skills.",
  location: "Remote",
  status: "approved",
  company_id: "8916ba20-f002-4ea0-9aab-d710d0f1a170",
  created_at: "2026-10-01T00:00:00Z",
  job_type: "contract",
  companies: { name: "Manor IT" },
};

const hrFullTime = {
  id: "1b3505db-2ced-4363-acd0-eacc522c8cae",
  title: "HR & Admim",
  description: "Must need English communication skill.",
  location: "Sylhet",
  status: "approved",
  company_id: "co-hr",
  created_at: "2026-09-01T00:00:00Z",
  job_type: "full_time",
  companies: { name: "HR Co" },
};

const pendingDev = {
  id: "pending-1",
  title: "Software Developer Intern",
  description: "Pending role",
  location: "Dhaka",
  status: "pending",
  company_id: "co-2",
  created_at: "2026-10-02T00:00:00Z",
  job_type: "full_time",
  companies: { name: "Pending Co" },
};

describe("parseLiveJobQuery", () => {
  it("extracts role keywords from a conversational job search", () => {
    expect(extractLiveJobSearchTerms("find me a software developer job")).toEqual([
      "software",
      "developer",
    ]);
    const parsed = parseLiveJobQuery("Show me full-time remote jobs in Sylhet");
    expect(parsed.jobTypes).toEqual(["full_time"]);
    expect(parsed.remoteOnly).toBe(true);
    expect(parsed.locations).toContain("sylhet");
  });

  it("expands coding-related wording into searchable tokens", () => {
    const parsed = parseLiveJobQuery("I know coding. Find jobs related to my coding skills");
    expect(parsed.terms).toEqual(expect.arrayContaining(["software", "developer"]));
  });
});

describe("filter helpers for skill widen passes", () => {
  it("buildLiveJobFilterQuery keeps type/remote/location only", async () => {
    const { buildLiveJobFilterQuery, filterLiveJobsByQuery } =
      await import("@/lib/ai/live-recommend");
    expect(buildLiveJobFilterQuery("Only show full-time remote jobs in Dhaka with React")).toMatch(
      /full-time/,
    );
    expect(buildLiveJobFilterQuery("Only show full-time remote jobs in Dhaka with React")).toMatch(
      /remote/,
    );
    expect(buildLiveJobFilterQuery("Only show full-time remote jobs in Dhaka with React")).toMatch(
      /dhaka/i,
    );
    expect(
      buildLiveJobFilterQuery("Only show full-time remote jobs in Dhaka with React"),
    ).not.toMatch(/react/i);

    const jobs = [
      {
        id: "1",
        title: "A",
        description: "React",
        location: "Remote",
        status: "approved",
        company_id: "c",
        created_at: "2026-01-01T00:00:00Z",
        job_type: "full_time",
        company_name: "Co",
      },
      {
        id: "2",
        title: "B",
        description: "React",
        location: "Dhaka",
        status: "approved",
        company_id: "c",
        created_at: "2026-01-01T00:00:00Z",
        job_type: "contract",
        company_name: "Co",
      },
    ] as const;
    const filtered = filterLiveJobsByQuery([...jobs], "Only show full-time jobs");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("1");
  });
});

describe("recommendApprovedLiveJobs", () => {
  it("matches approved software developer jobs using keyword OR filters, not the full sentence", async () => {
    const capture: { or?: string } = {};
    const result = await recommendApprovedLiveJobs(mockClient([softwareDev, pendingDev], capture), {
      query: "find me a software developer job",
      limit: 8,
    });

    expect(result.ok).toBe(true);
    expect(capture.or).toMatch(/title\.ilike\."%software%"/);
    expect(capture.or).not.toMatch(/find me a software developer job/i);
    if (result.ok) {
      expect(result.matchCount).toBe(1);
      expect(result.jobs[0]?.title).toBe("Software Developer");
      expect(result.jobs[0]?.company_name).toBe("Manor IT");
    }
  });

  it("filters full-time and remote separately", async () => {
    const fullCapture: { jobTypeEq?: string } = {};
    const full = await recommendApprovedLiveJobs(
      mockClient([softwareDev, hrFullTime, pendingDev], fullCapture),
      { query: "Show me full time jobs", limit: 8 },
    );
    expect(fullCapture.jobTypeEq).toBe("full_time");
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(full.jobs.every((j) => j.job_type === "full_time")).toBe(true);
      expect(full.jobs.some((j) => j.title === "Software Developer")).toBe(false);
    }

    const remote = await recommendApprovedLiveJobs(mockClient([softwareDev, hrFullTime], {}), {
      query: "Show me remote jobs",
      limit: 8,
    });
    expect(remote.ok).toBe(true);
    if (remote.ok) {
      expect(remote.jobs).toHaveLength(1);
      expect(remote.jobs[0]?.location).toMatch(/remote/i);
    }
  });

  it("escapes ILIKE wildcards from user input", () => {
    expect(escapeIlikePattern("100%_remote")).toBe("100\\%\\_remote");
  });

  it("excludes HR/marketing titles from software engineering searches", async () => {
    const marketing = {
      ...hrFullTime,
      id: "mkt-1",
      title: "marketing Head",
      description: "Need a software growth engineer mindset",
      job_type: "contract",
    };
    const labor = {
      ...hrFullTime,
      id: "labor-1",
      title: "senior labor",
      description: "hard working dedicated man engineer",
      job_type: "contract",
    };
    const result = await recommendApprovedLiveJobs(
      mockClient([softwareDev, hrFullTime, marketing, labor], {}),
      { query: "Show me software engineering jobs", limit: 8 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jobs.every((j) => /software|developer|engineer/i.test(j.title))).toBe(true);
    expect(result.jobs.some((j) => /marketing|labor|hr/i.test(j.title))).toBe(false);
  });
});
