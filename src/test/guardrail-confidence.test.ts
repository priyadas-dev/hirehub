import { describe, expect, it, vi } from "vitest";
import { runDiscoveryAgent } from "@/lib/ai/agents/discovery";
import { runSupervisor } from "@/lib/ai/agents/supervisor";
import { planRecruiterShortlist } from "@/lib/ai/agents/recruiter";
import { runApplicationAgent } from "@/lib/ai/agents/application";
import {
  assessDiscoveryConfidence,
  decideDiscoveryConfidence,
  DISCOVERY_HEURISTIC_REFUSE_MAX,
  evaluateFairnessBeforeRank,
  isVagueJobSearchQuery,
  mustBlockJobRanking,
  redactPii,
  shouldRefuseLowConfidence,
} from "@/lib/ai/guardrails";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const liveJob: LiveApprovedJob = {
  id: "live-1",
  title: "React Engineer",
  description: "Build UI.",
  location: "Dhaka",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-01-01T00:00:00Z",
  job_type: "full_time",
  company_name: "Demo Co",
};

describe("Discovery confidence heuristics (not calibrated)", () => {
  it("refuses empty job search (prior plateau at 0.35)", () => {
    const a = assessDiscoveryConfidence({
      liveJobCount: 0,
      corpusCount: 0,
      ragAvailable: true,
      intentNeedsJobs: true,
    });
    expect(a.confident).toBe(false);
    expect(a.reasons).toContain("empty_job_search");
    expect(a.score).toBeLessThanOrEqual(DISCOVERY_HEURISTIC_REFUSE_MAX);
    expect(shouldRefuseLowConfidence(a)).toBe(true);
    expect(
      decideDiscoveryConfidence({
        assessment: a,
        intentNeedsJobs: true,
        queryTooVague: false,
      }).action,
    ).toBe("refuse");
  });

  it("refuses when score is exactly the historical 0.35 boundary", () => {
    const plateau = {
      confident: false,
      score: 0.35,
      reasons: ["no_live_approved_jobs"],
    };
    expect(shouldRefuseLowConfidence(plateau)).toBe(true);
  });

  it("refuses when score is below the refuse floor", () => {
    expect(
      shouldRefuseLowConfidence({
        confident: false,
        score: 0.2,
        reasons: ["empty_grounding"],
      }),
    ).toBe(true);
  });

  it("clarifies vague empty job search instead of inventing recommendations", () => {
    expect(isVagueJobSearchQuery("find jobs")).toBe(true);
    const a = assessDiscoveryConfidence({
      liveJobCount: 0,
      corpusCount: 0,
      ragAvailable: true,
      intentNeedsJobs: true,
    });
    const d = decideDiscoveryConfidence({
      assessment: a,
      intentNeedsJobs: true,
      queryTooVague: true,
    });
    expect(d.action).toBe("clarify");
  });

  it("allows high-confidence live Discovery results", () => {
    const a = assessDiscoveryConfidence({
      liveJobCount: 3,
      corpusCount: 0,
      ragAvailable: true,
      intentNeedsJobs: true,
    });
    expect(a.confident).toBe(true);
    expect(a.score).toBeGreaterThan(DISCOVERY_HEURISTIC_REFUSE_MAX);
    expect(shouldRefuseLowConfidence(a)).toBe(false);
    expect(
      decideDiscoveryConfidence({
        assessment: a,
        intentNeedsJobs: true,
        queryTooVague: false,
      }).action,
    ).toBe("allow");
  });
});

describe("Discovery agent empty / clarify / success paths", () => {
  it("returns low_confidence for specific empty job search", async () => {
    const result = await runDiscoveryAgent(
      { question: "Find obscure quantum flute jobs in Atlantis" },
      {
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("low_confidence");
    expect(result.inventedJobs).toBe(false);
    expect(result.message).toMatch(/couldn't find any approved jobs/i);
  });

  it("soft-falls back when skill ranking finds no literal skill hits", async () => {
    const related = {
      ...liveJob,
      id: "job-php",
      title: "Backend Engineer",
      description: "PHP and Laravel APIs in Dhaka",
    };
    const result = await runDiscoveryAgent(
      { question: "I know React, JavaScript and SQL. Find suitable job" },
      {
        listLiveJobs: async () => ({ ok: true, jobs: [related] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveJobs.length).toBeGreaterThan(0);
    expect(result.inventedJobs).toBe(false);
  });

  it("returns needs_clarification for vague empty job search", async () => {
    const result = await runDiscoveryAgent(
      { question: "Find jobs" },
      {
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("needs_clarification");
    expect(result.inventedJobs).toBe(false);
  });

  it("returns live jobs for high-confidence Discovery", async () => {
    const result = await runDiscoveryAgent(
      { question: "Find React developer jobs in Dhaka" },
      {
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveJobs).toHaveLength(1);
    expect(result.confidence.refused).toBe(false);
    expect(result.confidence.score).toBeGreaterThan(DISCOVERY_HEURISTIC_REFUSE_MAX);
  });
});

describe("Application / Recruiter gates (not Discovery numeric confidence)", () => {
  it("Application missing required job id does not apply", async () => {
    const applyClient = {
      findApprovedJob: vi.fn(),
      findExistingApplication: vi.fn(),
      insertApplication: vi.fn(),
    };
    const result = await runApplicationAgent(
      { jobId: "", confirm: true },
      {
        seekerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        applyClient,
        isDeadlinePassed: () => false,
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("validation");
      expect(result.insertsAttempted).toBe(0);
    }
    expect(applyClient.insertApplication).not.toHaveBeenCalled();
  });

  it("Recruiter ownership failure does not authorize shortlist", () => {
    const result = planRecruiterShortlist(
      {
        application: {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          seekerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          status: "applied",
          jobRecruiterId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
        confirm: true,
      },
      {
        callerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        callerRole: "recruiter",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("Fairness + PII regressions", () => {
  it("fairness still refuses discriminatory hiring filters", () => {
    const decision = evaluateFairnessBeforeRank("Only hire men for engineering jobs");
    expect(mustBlockJobRanking(decision)).toBe(true);
  });

  it("PII redaction still masks emails", () => {
    const r = redactPii("Email me at seeker@example.com please");
    expect(r.redacted).toBe(true);
    expect(r.text).not.toMatch(/seeker@example\.com/i);
  });
});

describe("Supervisor routing + confirm-to-apply still hold", () => {
  it("routes job search through discovery and surfaces low-confidence without live cards", async () => {
    const result = await runSupervisor(
      { question: "Find obscure quantum flute jobs in Atlantis" },
      {
        role: "seeker",
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        conversationId: "conf-empty",
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe("guardrail-confidence");
    expect(result.liveCitations ?? []).toHaveLength(0);
    expect(result.insufficientContext).toBe(true);
  });

  it("confirm-to-apply still requires confirm (0 inserts when unconfirmed)", async () => {
    const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const runApplication = vi.fn(async () => ({
      ok: true as const,
      status: "needs_confirm" as const,
      pendingApply: {
        jobId: JOB_ID,
        title: "React Engineer",
        requiresConfirm: true as const,
      },
      message: "Confirm to apply.",
      insertsAttempted: 0 as const,
    }));

    const result = await runSupervisor(
      {
        question: "Please apply to this job",
        applyJobId: JOB_ID,
        confirmApply: false,
        recentJobs: [{ id: JOB_ID, title: "React Engineer", location: "Dhaka" }],
      },
      {
        role: "seeker",
        userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        runApplicationAgent: runApplication,
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );

    expect(runApplication).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: JOB_ID, confirm: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pendingApply?.jobId).toBe(JOB_ID);
    expect(result.applyOutcome).toBeUndefined();
  });
});
