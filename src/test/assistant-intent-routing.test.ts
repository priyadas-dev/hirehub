import { describe, expect, it, vi } from "vitest";
import { runJobAssistant } from "@/lib/ai/job-assistant";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const liveJob: LiveApprovedJob = {
  id: "live-1",
  title: "Software Developer",
  description: "Build apps with React and TypeScript.",
  location: "Dhaka",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-01-01T00:00:00Z",
  job_type: "full_time",
  company_name: "HireHub Demo Co",
};

describe("intent routing end-to-end", () => {
  it("answers What is OOP? via LLM without job search or corpus RAG", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));
    const retrieveCorpus = vi.fn(async () => ({ ok: true as const, matches: [] }));
    const generateAnswer = vi.fn(async () => ({
      ok: true as const,
      text: "OOP (Object-Oriented Programming) organises code around objects that combine data and behaviour.",
    }));
    const result = await runJobAssistant(
      { question: "What is OOP?" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus,
        listLiveJobs,
        generateAnswer,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(false);
    expect(result.liveCitations).toHaveLength(0);
    expect(result.answer).toMatch(/Object-Oriented|OOP/i);
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
    expect(retrieveCorpus).toHaveBeenCalledTimes(0);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it("routes learning advice after C++ to LLM, not job cards", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));
    const generateAnswer = vi.fn(async (prompt: string) => {
      expect(prompt).toMatch(/learn/i);
      return {
        ok: true as const,
        text: "After C++, many developers learn Python or JavaScript depending on their goals.",
      };
    });
    const result = await runJobAssistant(
      {
        question: "I know C++. What language should I learn to improve?",
        sessionSkills: ["C++", "Communication"],
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs,
        generateAnswer,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(false);
    expect(result.liveCitations).toHaveLength(0);
    expect(result.answer).not.toMatch(/couldn't find any approved jobs/i);
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
  });

  it("keeps explicit job search on the live-job path", async () => {
    const generateAnswer = vi.fn(async () => ({ ok: true as const, text: "should not run" }));
    const result = await runJobAssistant(
      { question: "Find me a software developer job." },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations).toHaveLength(1);
    expect(generateAnswer).toHaveBeenCalledTimes(0);
  });

  it("does not apply resume skills to a Dhaka full-time filter", async () => {
    const listLiveJobs = vi.fn(async (_q: string, options?: { skillTerms?: string[] }) => {
      expect(options?.skillTerms ?? []).toEqual([]);
      return { ok: true as const, jobs: [liveJob] };
    });
    const result = await runJobAssistant(
      {
        question: "Show me full-time jobs in Dhaka.",
        sessionSkills: ["Python", "Django", "Communication"],
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs,
        generateAnswer: async () => ({ ok: true, text: "nope" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.answer).not.toMatch(/Python|Django|Communication/);
    expect(result.liveCitations[0]?.matchedSkills).toBeUndefined();
  });

  it("reports search failure separately from zero results", async () => {
    const result = await runJobAssistant(
      { question: "Find software developer jobs." },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: false, message: "db down" }),
        generateAnswer: async () => ({ ok: true, text: "nope" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveJobsAvailable).toBe(false);
    expect(result.answer).toMatch(/couldn't complete the approved-job search/i);
    expect(result.answer).not.toMatch(/matching those filters/i);
  });
});
