/**
 * Broad coverage for unpredictable seeker questions.
 * Asserts routing/behavior — not one exact LLM sentence.
 */
import { describe, expect, it, vi } from "vitest";
import { classifyAssistantIntent } from "@/lib/ai/assistant-intent";
import { runJobAssistant } from "@/lib/ai/job-assistant";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const approved: LiveApprovedJob = {
  id: "cov-1",
  title: "Software Developer",
  description: "React, TypeScript, and SQL for product UI. Remote friendly.",
  location: "Remote",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-10-01T00:00:00Z",
  job_type: "full_time",
  company_name: "Demo Co",
};

const sylhet: LiveApprovedJob = {
  ...approved,
  id: "cov-2",
  title: "Support Engineer",
  description: "Customer support and networking.",
  location: "Sylhet",
  job_type: "full_time",
};

const pending: LiveApprovedJob = {
  ...approved,
  id: "cov-pending",
  status: "pending",
  title: "Pending Dev",
};

function deps(overrides?: {
  listLiveJobs?: ReturnType<typeof vi.fn>;
  generateAnswer?: ReturnType<typeof vi.fn>;
  retrieveCorpus?: ReturnType<typeof vi.fn>;
}) {
  return {
    role: "seeker" as const,
    geminiConfigured: true,
    retrieveCorpus:
      overrides?.retrieveCorpus ?? vi.fn(async () => ({ ok: true as const, matches: [] })),
    listLiveJobs:
      overrides?.listLiveJobs ??
      vi.fn(async () => ({ ok: true as const, jobs: [approved, sylhet, pending] })),
    generateAnswer:
      overrides?.generateAnswer ??
      vi.fn(async () => ({
        ok: true as const,
        text: "Here is a helpful grounded answer for the seeker.",
      })),
  };
}

describe("diverse intent classification (varied phrasings)", () => {
  const general = [
    "Can you explain what a REST API is?",
    "Help me understand Docker containers",
    "Difference between SQL and NoSQL",
    "Define polymorphism in simple terms",
  ];
  for (const q of general) {
    it(`general: ${q}`, () => {
      const c = classifyAssistantIntent(q);
      expect(c.searchJobs).toBe(false);
      expect(c.useLlmAnswer).toBe(true);
      expect(c.applySessionSkills).toBe(false);
      expect(["general_knowledge", "learning_guidance", "ambiguous"]).toContain(c.intent);
    });
  }

  const learning = [
    "Which framework should I pick after learning HTML?",
    "Best way to learn backend development",
    "I know Java. What should I study next?",
    "Suggest a portfolio project to improve my coding skills",
  ];
  for (const q of learning) {
    it(`learning: ${q}`, () => {
      const c = classifyAssistantIntent(q);
      expect(c.searchJobs).toBe(false);
      expect(c.useLlmAnswer).toBe(true);
    });
  }

  const career = [
    "How should I prepare for a technical interview?",
    "Common behavioral interview tips for developers",
    "Can you help me polish my CV?",
    "What skills should I learn for this role?",
  ];
  for (const q of career) {
    it(`career/interview/resume advice: ${q}`, () => {
      const c = classifyAssistantIntent(q);
      expect(c.searchJobs).toBe(false);
      expect(c.useLlmAnswer).toBe(true);
    });
  }

  const jobs = [
    "Do you have any software developer jobs?",
    "Show part-time openings in Sylhet",
    "Looking for remote contract roles",
    "Data analyst jobs with SQL",
    "Are there hybrid developer positions?",
  ];
  for (const q of jobs) {
    it(`job search: ${q}`, () => {
      const c = classifyAssistantIntent(q);
      expect(c.searchJobs).toBe(true);
      expect(c.applySessionSkills).toBe(false);
    });
  }

  it("resume match vs unrelated location filter with session skills", () => {
    expect(classifyAssistantIntent("Match openings to my resume").applySessionSkills).toBe(true);
    expect(classifyAssistantIntent("Show me full-time jobs in Dhaka").applySessionSkills).toBe(
      false,
    );
    expect(classifyAssistantIntent("Show me full-time jobs in Dhaka").useSkillRanking).toBe(false);
  });
});

describe("routing behavior across categories", () => {
  it("general technical questions never emit no-jobs-matched copy", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [approved] }));
    const generateAnswer = vi.fn(async () => ({
      ok: true as const,
      text: "A REST API exposes resources over HTTP using methods like GET and POST.",
    }));
    const result = await runJobAssistant(
      { question: "Can you explain what a REST API is?", sessionSkills: ["Python", "Django"] },
      deps({ listLiveJobs, generateAnswer }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(false);
    expect(result.liveCitations).toHaveLength(0);
    expect(result.answer).not.toMatch(/couldn't find any approved jobs/i);
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
  });

  it("learning advice with a language mention does not force skill-ranked vacancies", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [approved] }));
    const result = await runJobAssistant(
      { question: "I know Java. What should I study next?", sessionSkills: ["Java"] },
      deps({ listLiveJobs }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(false);
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
  });

  it("job search returns multiple approved matches and skips pending", async () => {
    const result = await runJobAssistant({ question: "Show me full-time jobs" }, deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations.length).toBeGreaterThanOrEqual(2);
    expect(result.liveCitations.every((j) => j.id !== "cov-pending")).toBe(true);
  });

  it("remote filter does not apply resume session skills", async () => {
    const listLiveJobs = vi.fn(async (_q: string, options?: { skillTerms?: string[] }) => {
      expect(options?.skillTerms ?? []).toEqual([]);
      return { ok: true as const, jobs: [approved, sylhet] };
    });
    const result = await runJobAssistant(
      { question: "Are there remote jobs?", sessionSkills: ["Laravel", "Vue", "Communication"] },
      deps({ listLiveJobs }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveCitations.every((j) => j.location?.toLowerCase().includes("remote"))).toBe(
      true,
    );
    expect(result.answer).not.toMatch(/Laravel|Vue|Communication/);
  });

  it("resume match ranks by extracted skills and excludes synthetic corpus titles", async () => {
    const retrieveCorpus = vi.fn(async () => ({
      ok: true as const,
      matches: [
        {
          id: "c1",
          corpus_key: "synthetic:v1:04445",
          title: "Lead Sales Development Representative",
          content: "SYNTHETIC sales",
          location: "Dhaka",
          category: "sales",
          skills_text: "sales",
          is_synthetic: true,
          source: "hirehub-synthetic-v1",
          similarity: 0.9,
        },
      ],
    }));
    const result = await runJobAssistant(
      {
        question: "Find jobs matching my resume",
        sessionSkills: ["React", "TypeScript", "SQL"],
      },
      deps({ retrieveCorpus }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations.some((j) => j.matchedSkills?.includes("React"))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Lead Sales Development Representative/);
    expect(retrieveCorpus).toHaveBeenCalledTimes(0);
  });

  it("follow-up compare uses recent jobs + resume skills", async () => {
    const result = await runJobAssistant(
      {
        question: "Which of those jobs matches my resume?",
        sessionSkills: ["React", "TypeScript"],
        recentJobs: [
          {
            id: "cov-1",
            title: "Software Developer",
            description: "React and TypeScript UI.",
            location: "Remote",
            job_type: "full_time",
            company_name: "Demo Co",
          },
          {
            id: "hr-1",
            title: "HR Coordinator",
            description: "People operations.",
            location: "Dhaka",
            job_type: "full_time",
            company_name: "Other",
          },
        ],
      },
      deps({
        listLiveJobs: vi.fn(async () => ({ ok: true as const, jobs: [] })),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveCitations.some((j) => j.id === "cov-1")).toBe(true);
    expect(result.liveCitations.every((j) => j.id !== "hr-1")).toBe(true);
  });

  it("honest no-match when filters find nothing", async () => {
    const result = await runJobAssistant(
      { question: "Show me full-time jobs in Dhaka" },
      deps({
        listLiveJobs: vi.fn(async () => ({ ok: true as const, jobs: [sylhet] })),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations).toHaveLength(0);
    expect(result.answer).toMatch(/couldn't find any approved jobs matching those filters/i);
  });

  it("search failure is not reported as zero matching jobs", async () => {
    const result = await runJobAssistant(
      { question: "Find developer jobs" },
      deps({
        listLiveJobs: vi.fn(async () => ({ ok: false as const, message: "timeout" })),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveJobsAvailable).toBe(false);
    expect(result.answer).toMatch(/couldn't complete the approved-job search/i);
    expect(result.answer).not.toMatch(/matching those filters/i);
  });

  it("Gemini unavailable surfaces config message only when geminiConfigured is false", async () => {
    const result = await runJobAssistant(
      { question: "What is OOP?" },
      { ...deps(), geminiConfigured: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("gemini_unavailable");
    expect(result.setupHint).toBeTruthy();
  });

  it("generation failure does not claim missing configuration when Gemini is configured", async () => {
    const result = await runJobAssistant(
      { question: "Explain recursion briefly" },
      deps({
        generateAnswer: vi.fn(async () => ({
          ok: false as const,
          message: "Gemini is temporarily unavailable (high demand). Please retry shortly.",
        })),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("generation_failed");
    expect(result.message).toMatch(/unavailable|retry/i);
    expect(result.setupHint).toBeUndefined();
  });

  it("rejects metadata-only resume attach for resume match", async () => {
    const result = await runJobAssistant(
      {
        question: "Find jobs based on my resume",
        attachmentMeta: {
          name: "cv.pdf",
          mime: "application/pdf",
          sizeBytes: 1000,
          kind: "pdf",
        },
      },
      deps(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("resume_unreadable");
  });

  it("seeker-only authorization still blocks recruiters", async () => {
    const result = await runJobAssistant(
      { question: "What is TypeScript?" },
      { ...deps(), role: "recruiter" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("forbidden");
  });
});
