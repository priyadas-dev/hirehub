import { describe, expect, it, vi } from "vitest";
import {
  assertSeekerRole,
  buildAssistantPrompt,
  formatCorpusContext,
  formatLiveJobsContext,
  isInsufficientContext,
  runJobAssistant,
  toCorpusCitations,
  toLiveCitations,
} from "@/lib/ai/job-assistant";
import type { CorpusMatch } from "@/lib/ai/corpus";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const corpusMatch: CorpusMatch = {
  id: "c1",
  corpus_key: "synthetic:v1:00001",
  title: "Frontend Developer",
  content: "SYNTHETIC TRAINING DOCUMENT — React TypeScript skills practice.",
  location: "Dhaka",
  category: "engineering",
  skills_text: "React, TypeScript",
  is_synthetic: true,
  source: "hirehub-synthetic-v1",
  similarity: 0.81,
};

const liveJob: LiveApprovedJob = {
  id: "live-1",
  title: "Approved React Engineer",
  description: "Build UI for HireHub customers.",
  location: "Dhaka",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-01-01T00:00:00Z",
};

describe("role / security boundaries", () => {
  it("blocks missing auth and non-seeker roles", () => {
    expect(assertSeekerRole(null)?.code).toBe("unauthorized");
    expect(assertSeekerRole("recruiter")?.code).toBe("forbidden");
    expect(assertSeekerRole("admin")?.code).toBe("forbidden");
    expect(assertSeekerRole("seeker")).toBeNull();
  });

  it("rejects recruiter/admin through the full pipeline", async () => {
    const result = await runJobAssistant(
      { question: "What skills for React?" },
      {
        role: "recruiter",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [corpusMatch] }),
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});

describe("grounding helpers", () => {
  it("labels corpus as synthetic and live jobs as real", () => {
    const corpusBlock = formatCorpusContext([corpusMatch]);
    const liveBlock = formatLiveJobsContext([liveJob]);
    expect(corpusBlock).toMatch(/SYNTHETIC/);
    expect(corpusBlock).not.toMatch(/REAL approved HireHub job/);
    expect(liveBlock).toMatch(/REAL approved HireHub job/);
    expect(toCorpusCitations([corpusMatch])[0]?.kind).toBe("synthetic_corpus");
    expect(toLiveCitations([liveJob])[0]?.kind).toBe("live_approved_job");
  });

  it("builds a prompt that forbids inventing vacancies", () => {
    const prompt = buildAssistantPrompt({
      question: "How do I grow as a frontend engineer?",
      corpusBlock: formatCorpusContext([corpusMatch]),
      liveBlock: formatLiveJobsContext([liveJob]),
      ragAvailable: true,
    });
    expect(prompt).toMatch(/NEVER invent job vacancies/i);
    expect(prompt).toMatch(/SYNTHETIC/);
    expect(prompt).toContain("How do I grow as a frontend engineer?");
  });
});

describe("runJobAssistant behavior", () => {
  it("returns a grounded answer with separated citations", async () => {
    const generateAnswer = vi.fn(async () => ({
      ok: true as const,
      text: "Focus on React and TypeScript. One approved HireHub role is listed below.",
    }));

    const result = await runJobAssistant(
      { question: "What should I learn for frontend work?" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [corpusMatch] }),
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insufficientContext).toBe(false);
      expect(result.ragAvailable).toBe(true);
      expect(result.corpusCitations).toHaveLength(1);
      expect(result.liveCitations).toHaveLength(1);
      expect(result.corpusCitations[0]?.kind).toBe("synthetic_corpus");
      expect(result.liveCitations[0]?.kind).toBe("live_approved_job");
      expect(JSON.stringify(result)).not.toContain("GEMINI_API_KEY");
    }
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it("admits insufficient context when no corpus or live jobs are available", async () => {
    const generateAnswer = vi.fn(async () => ({ ok: true as const, text: "should not run" }));
    const result = await runJobAssistant(
      { question: "Tell me about obscure roles on Mars" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        generateAnswer,
      },
    );
    expect(isInsufficientContext({ corpusCount: 0, liveCount: 0, ragAvailable: true })).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insufficientContext).toBe(true);
      expect(result.answer).toMatch(/not have enough grounded information/i);
      expect(result.liveCitations).toHaveLength(0);
      expect(result.corpusCitations).toHaveLength(0);
    }
    expect(generateAnswer).toHaveBeenCalledTimes(0);
  });

  it("fails gracefully when Gemini is not configured", async () => {
    const result = await runJobAssistant(
      { question: "What skills for data roles?" },
      {
        role: "seeker",
        geminiConfigured: false,
        retrieveCorpus: async () => ({ ok: true, matches: [corpusMatch] }),
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer: async () => ({ ok: true, text: "nope" }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("gemini_unavailable");
      expect(result.setupHint).toMatch(/GEMINI_API_KEY/);
      expect(result.setupHint).not.toMatch(/AIza|sk-/);
    }
  });
});
