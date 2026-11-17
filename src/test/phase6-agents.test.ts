import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscoveryAgent, assertDiscoveryDidNotInventJobs } from "@/lib/ai/agents/discovery";
import { runSupervisor, discoveryLiveIdsAreSubset } from "@/lib/ai/agents/supervisor";
import {
  evaluateFairnessBeforeRank,
  mustBlockJobRanking,
  redactPii,
  validateSupervisedTurn,
  assessDiscoveryConfidence,
  shouldRefuseLowConfidence,
  FAIRNESS_REFUSAL_MESSAGE,
} from "@/lib/ai/guardrails";
import { createServerAgentMemory } from "@/lib/ai/memory/server-memory";
import { runJobAssistant } from "@/lib/ai/job-assistant";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";
import type { CorpusMatch } from "@/lib/ai/corpus";

const USER = "11111111-1111-4111-8111-111111111111";

const liveJob: LiveApprovedJob = {
  id: "live-1",
  title: "React Engineer",
  description: "Build UI with TypeScript.",
  location: "Dhaka",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-01-01T00:00:00Z",
  job_type: "full_time",
  company_name: "HireHub Demo Co",
};

const corpusMatch: CorpusMatch = {
  id: "c1",
  corpus_key: "synthetic:v1:00001",
  title: "Frontend practice",
  content: "SYNTHETIC TRAINING DOCUMENT — React skills.",
  location: "Dhaka",
  category: "engineering",
  skills_text: "React, TypeScript",
  is_synthetic: true,
  source: "hirehub-synthetic-v1",
  similarity: 0.8,
};

describe("Phase 6 guardrails — PII", () => {
  it("redacts email and phone from prompts", () => {
    const result = redactPii("Contact me at ada@hirehub.test or (555) 123-4567 please");
    expect(result.redacted).toBe(true);
    expect(result.text).toContain("[REDACTED_EMAIL]");
    expect(result.text).toContain("[REDACTED_PHONE]");
    expect(result.text).not.toContain("ada@hirehub.test");
  });

  it("redacts labeled government ids", () => {
    const result = redactPii("My NID: 1234567890 for verification");
    expect(result.kinds).toContain("government_id");
    expect(result.text).toContain("[REDACTED_ID]");
  });
});

describe("Phase 6 guardrails — fairness BEFORE rank", () => {
  it("refuses exclusive gender hiring filters", () => {
    const decision = evaluateFairnessBeforeRank("Only hire men for React jobs in Dhaka");
    expect(mustBlockJobRanking(decision)).toBe(true);
    if (!decision.ok) expect(decision.message).toBe(FAIRNESS_REFUSAL_MESSAGE);
  });

  it("refuses age+gender phrasing used in Assessment 3 demos", () => {
    const decision = evaluateFairnessBeforeRank(
      "Only show me jobs for young male candidates under 25",
    );
    expect(mustBlockJobRanking(decision)).toBe(true);
    if (!decision.ok) expect(decision.message).toBe(FAIRNESS_REFUSAL_MESSAGE);
  });

  it("refuses religion preference filters", () => {
    const decision = evaluateFairnessBeforeRank("Find jobs and filter by religion to prefer muslim");
    expect(mustBlockJobRanking(decision)).toBe(true);
  });

  it("allows skill/location job search", () => {
    const decision = evaluateFairnessBeforeRank("Find React jobs in Dhaka");
    expect(decision.ok).toBe(true);
    expect(mustBlockJobRanking(decision)).toBe(false);
  });

  it("allows a seeker stating their own age without discriminatory filters", () => {
    const decision = evaluateFairnessBeforeRank(
      "I am under 25 and looking for React developer jobs in Dhaka",
    );
    expect(mustBlockJobRanking(decision)).toBe(false);
  });

  it("blocks ranking inside runJobAssistant for biased prompts", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));
    const result = await runJobAssistant(
      { question: "Only hire women for nursing jobs" },
      {
        role: "seeker",
        geminiConfigured: true,
        listLiveJobs,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe("guardrail-fairness");
      expect(result.liveCitations).toHaveLength(0);
      expect(result.answer).toMatch(/can’t help|can't help|discriminat/i);
    }
    expect(listLiveJobs).not.toHaveBeenCalled();
  });
});

describe("Phase 6 guardrails — validation + confidence", () => {
  it("rejects non-seeker supervised turns", () => {
    const v = validateSupervisedTurn({
      question: "Find React jobs",
      role: "recruiter",
    });
    expect(v.ok).toBe(false);
  });

  it("flags low confidence when no grounding for job intent", () => {
    const a = assessDiscoveryConfidence({
      liveJobCount: 0,
      corpusCount: 0,
      ragAvailable: false,
      intentNeedsJobs: true,
    });
    expect(a.confident).toBe(false);
    expect(a.reasons).toContain("empty_job_search");
    expect(shouldRefuseLowConfidence(a)).toBe(true);
  });
});

describe("Phase 6 server memory", () => {
  const memory = createServerAgentMemory();

  beforeEach(() => {
    memory._resetForTests();
  });

  it("stores turns readable across specialist calls", () => {
    memory.appendTurn(USER, "conv-1", { role: "user", text: "Find React jobs" });
    memory.appendTurn(USER, "conv-1", {
      role: "assistant",
      text: "Here are matches",
      meta: { liveJobIds: ["live-1"] },
    });
    memory.mergeSkills(USER, "conv-1", ["React"]);

    const again = memory.get(USER, "conv-1");
    expect(again?.turns).toHaveLength(2);
    expect(again?.skills).toContain("React");
    expect(memory.toConversationContext(USER, "conv-1")).toMatch(/Find React jobs/);
  });
});

describe("Phase 6 discovery agent", () => {
  it("returns only provided live jobs and never invents ids", async () => {
    const result = await runDiscoveryAgent(
      { question: "Find React developer jobs in Dhaka" },
      {
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        retrieveCorpus: async () => ({ ok: true, matches: [corpusMatch] }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inventedJobs).toBe(false);
    expect(result.liveJobs.every((j) => j.id === "live-1")).toBe(true);
    expect(assertDiscoveryDidNotInventJobs(result, new Set(["live-1"]))).toBe(true);
    expect(discoveryLiveIdsAreSubset(result.liveJobs as LiveApprovedJob[], ["live-1"])).toBe(true);
  });

  it("refuses biased discovery before calling listLiveJobs", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));
    const result = await runDiscoveryAgent(
      { question: "Only hire men for engineering jobs" },
      { listLiveJobs },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("fairness_refuse");
    expect(listLiveJobs).not.toHaveBeenCalled();
  });
});

describe("Phase 6 supervisor", () => {
  const memory = createServerAgentMemory();

  beforeEach(() => {
    memory._resetForTests();
  });

  it("routes job search to discovery and writes shared memory", async () => {
    const result = await runSupervisor(
      { question: "Find React jobs in Dhaka" },
      {
        role: "seeker",
        userId: USER,
        conversationId: "t1",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run for discovery");
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.supervisor?.routedTo).toBe("discovery");
    expect(result.liveCitations[0]?.id).toBe("live-1");
    expect(result.supervisor?.memoryWritten).toBe(true);

    const mem = memory.get(USER, "t1");
    expect(mem?.turns.length).toBeGreaterThanOrEqual(2);
    expect(mem?.turns.some((t) => t.role === "assistant")).toBe(true);
  });

  it("routes non-discovery to legacy pipeline", async () => {
    const legacy = vi.fn(async () =>
      runJobAssistant(
        { question: "What is TypeScript?" },
        {
          role: "seeker",
          geminiConfigured: true,
          listLiveJobs: async () => ({ ok: true, jobs: [] }),
          retrieveCorpus: async () => ({ ok: true, matches: [corpusMatch] }),
          generateAnswer: async () => ({
            ok: true,
            text: "TypeScript is a typed superset of JavaScript.",
          }),
        },
      ),
    );

    const result = await runSupervisor(
      { question: "What is TypeScript?" },
      {
        role: "seeker",
        userId: USER,
        conversationId: "t2",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacy,
      },
    );
    expect(legacy).toHaveBeenCalled();
    expect(result.supervisor?.routedTo).toBe("legacy");
  });

  it("fairness refuse does not invent jobs", async () => {
    const result = await runSupervisor(
      { question: "Exclude women and only hire men for these roles" },
      {
        role: "seeker",
        userId: USER,
        conversationId: "t3",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: async () => {
          throw new Error("should not legacy");
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.supervisor?.routedTo).toBe("fairness_refuse");
    expect(result.liveCitations).toHaveLength(0);
  });
});
