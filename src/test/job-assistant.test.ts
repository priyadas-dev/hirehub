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
  job_type: "full_time",
  company_name: "HireHub Demo Co",
};

const salesCorpusMatch: CorpusMatch = {
  ...corpusMatch,
  id: "c-sales",
  corpus_key: "synthetic:v1:04445",
  title: "Lead Sales Development Representative",
  category: "sales",
  content: "SYNTHETIC TRAINING DOCUMENT — sales development practice only.",
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
      liveCount: 1,
    });
    expect(prompt).toMatch(/NEVER invent job vacancies/i);
    expect(prompt).toMatch(/SYNTHETIC/);
    expect(prompt).toContain("How do I grow as a frontend engineer?");
  });
});

describe("runJobAssistant behavior", () => {
  it("returns live job cards without calling Gemini when the seeker asks for jobs", async () => {
    const generateAnswer = vi.fn(async () => ({
      ok: true as const,
      text: "should not run for vacancy card answers",
    }));
    const retrieveCorpus = vi.fn(async () => ({ ok: true as const, matches: [salesCorpusMatch] }));

    const result = await runJobAssistant(
      { question: "Find me a software developer job" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus,
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.insufficientContext).toBe(false);
      expect(result.corpusCitations).toHaveLength(0);
      expect(result.liveCitations).toHaveLength(1);
      expect(result.liveCitations[0]?.title).toBe("Approved React Engineer");
      expect(result.answer).toMatch(/I found 1 approved HireHub job/i);
      expect(JSON.stringify(result)).not.toMatch(/Lead Sales Development Representative/);
    }
    expect(generateAnswer).toHaveBeenCalledTimes(0);
    expect(retrieveCorpus).toHaveBeenCalledTimes(0);
  });

  it("does not show synthetic corpus as vacancies when no live jobs match a job search", async () => {
    const generateAnswer = vi.fn(async () => ({ ok: true as const, text: "should not run" }));
    const result = await runJobAssistant(
      { question: "Find me a software developer job" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [salesCorpusMatch] }),
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        generateAnswer,
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.liveCitations).toHaveLength(0);
      expect(result.corpusCitations).toHaveLength(0);
      expect(result.answer).toMatch(/couldn't find any approved jobs matching those filters/i);
      expect(result.soughtLiveJobs).toBe(true);
      expect(result.answer).not.toMatch(/Lead Sales Development Representative/i);
    }
    expect(generateAnswer).toHaveBeenCalledTimes(0);
  });

  it("never returns pending jobs as live citations", async () => {
    const pending: LiveApprovedJob = {
      ...liveJob,
      id: "p1",
      status: "pending",
      title: "Pending Dev",
    };
    const result = await runJobAssistant(
      { question: "Find developer jobs" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: true, jobs: [pending, liveJob] }),
        generateAnswer: async () => ({ ok: true, text: "Here is an approved role." }),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.liveCitations).toHaveLength(1);
      expect(result.liveCitations[0]?.id).toBe("live-1");
    }
  });

  it("matches jobs from resume PDF skills without inventing qualifications", async () => {
    const laravelJob: LiveApprovedJob = {
      ...liveJob,
      id: "laravel-1",
      title: "Software Developer",
      description: "Need Laravel and Vue skills.",
      job_type: "contract",
      company_name: "Manor IT",
    };
    const generateAnswer = vi.fn(async () => ({ ok: true as const, text: "should not run" }));
    const result = await runJobAssistant(
      {
        question: "Show me jobs that match based on my resume",
        resumePdfBase64: "dGVzdA==",
        attachmentMeta: {
          name: "priya-resume.pdf",
          mime: "application/pdf",
          sizeBytes: 1200,
        },
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [salesCorpusMatch] }),
        listLiveJobs: async () => ({ ok: true, jobs: [laravelJob, liveJob] }),
        generateAnswer,
        extractResumePdf: async () => ({
          ok: true,
          text: "Experienced engineer. Skills: Laravel, Vue, PHP, Git.",
        }),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resumeProcess?.status).toBe("read");
      expect(result.sessionSkills).toEqual(
        expect.arrayContaining(["Laravel", "Vue", "PHP", "Git"]),
      );
      expect(result.liveCitations.some((j) => j.id === "laravel-1")).toBe(true);
      expect(result.liveCitations[0]?.matchedSkills?.length).toBeGreaterThan(0);
      expect(result.liveCitations[0]?.matchReason).toMatch(/Matches your/i);
      expect(JSON.stringify(result)).not.toMatch(/Lead Sales Development Representative/);
      expect(JSON.stringify(result)).not.toMatch(/Experienced engineer/);
    }
    expect(generateAnswer).toHaveBeenCalledTimes(0);
  });

  it("fails honestly when resume PDF cannot be read", async () => {
    const result = await runJobAssistant(
      {
        question: "Find jobs based on my resume",
        resumePdfBase64: "dGVzdA==",
        attachmentMeta: {
          name: "bad.pdf",
          mime: "application/pdf",
          sizeBytes: 100,
        },
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer: async () => ({ ok: true, text: "nope" }),
        extractResumePdf: async () => ({
          ok: false,
          message:
            "I could not read that PDF. Upload a readable text-based resume PDF or list your skills in chat.",
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("resume_unreadable");
      expect(result.message).toMatch(/could not read that PDF/i);
      expect(result.resumeProcess?.status).toBe("failed");
    }
  });

  it("matches chat-provided skills without a resume upload", async () => {
    const result = await runJobAssistant(
      { question: "I know React, JavaScript and SQL. Find suitable jobs" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [salesCorpusMatch] }),
        listLiveJobs: async () => ({
          ok: true,
          jobs: [
            {
              ...liveJob,
              description: "Build UI with React and TypeScript. SQL nice to have.",
            },
          ],
        }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionSkills).toEqual(expect.arrayContaining(["React", "JavaScript", "SQL"]));
      expect(result.liveCitations[0]?.matchedSkills).toEqual(expect.arrayContaining(["React"]));
    }
  });

  it("ranks multiple approved jobs by skill evidence and skips unrelated ones", async () => {
    const result = await runJobAssistant(
      { question: "Find jobs matching my Python skills", sessionSkills: ["Python", "Django"] },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [salesCorpusMatch] }),
        listLiveJobs: async () => ({
          ok: true,
          jobs: [
            {
              ...liveJob,
              id: "py-1",
              title: "Backend Engineer",
              description: "Python and Django APIs.",
              created_at: "2026-10-02T00:00:00Z",
            },
            {
              ...liveJob,
              id: "py-2",
              title: "Data Analyst",
              description: "Python scripting for reports.",
              created_at: "2026-10-01T00:00:00Z",
            },
            {
              ...liveJob,
              id: "hr-1",
              title: "HR Coordinator",
              description: "People operations and English communication.",
            },
          ],
        }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveCitations).toHaveLength(2);
    expect(result.liveCitations[0]?.id).toBe("py-1");
    expect(result.liveCitations.every((j) => j.id !== "hr-1")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Lead Sales Development Representative/);
  });

  it("applies full-time filter without forcing resume skill ranking", async () => {
    const listLiveJobs = vi.fn(async (q: string) => {
      expect(q.toLowerCase()).toMatch(/full/);
      return {
        ok: true as const,
        jobs: [
          {
            ...liveJob,
            id: "ft-1",
            title: "React Engineer",
            description: "React and TypeScript product UI.",
            job_type: "full_time" as const,
          },
          {
            ...liveJob,
            id: "ct-1",
            title: "React Contractor",
            description: "React and TypeScript short contract.",
            job_type: "contract" as const,
          },
        ],
      };
    });
    const result = await runJobAssistant(
      {
        question: "Only show full-time jobs",
        sessionSkills: ["React", "TypeScript"],
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs,
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations).toHaveLength(1);
    expect(result.liveCitations[0]?.id).toBe("ft-1");
    expect(result.liveCitations[0]?.job_type).toBe("full_time");
    expect(result.liveCitations[0]?.matchedSkills).toBeUndefined();
    expect(result.answer).toMatch(/I found 1 approved HireHub job/i);
    // skillTerms should not be sent for a filter-only follow-up
    expect(listLiveJobs.mock.calls[0]?.[1]?.skillTerms ?? []).toEqual([]);
  });

  it("does not use session skills for a location-only question after a resume upload", async () => {
    const listLiveJobs = vi.fn(async () => ({
      ok: true as const,
      jobs: [
        {
          ...liveJob,
          id: "dhaka-1",
          title: "Support Agent",
          description: "Customer support in Dhaka office.",
          location: "Dhaka",
        },
        {
          ...liveJob,
          id: "remote-1",
          title: "React Engineer",
          description: "React remote role.",
          location: "Remote",
        },
      ],
    }));
    const result = await runJobAssistant(
      {
        question: "I want a job in Dhaka. Are there any jobs?",
        sessionSkills: ["React", "TypeScript", "Laravel"],
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs,
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations.every((j) => j.location?.toLowerCase().includes("dhaka"))).toBe(
      true,
    );
    expect(result.liveCitations[0]?.matchedSkills).toBeUndefined();
    expect(listLiveJobs.mock.calls[0]?.[1]?.skillTerms ?? []).toEqual([]);
  });

  it("answers general knowledge without forcing a job search", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));
    const retrieveCorpus = vi.fn(async () => ({ ok: true as const, matches: [corpusMatch] }));
    const generateAnswer = vi.fn(async () => ({
      ok: true as const,
      text: "React is a JavaScript library for building user interfaces.",
    }));
    const result = await runJobAssistant(
      {
        question: "What is React?",
        sessionSkills: ["Laravel", "Vue"],
      },
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
    expect(result.answer).toMatch(/React/i);
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
    expect(retrieveCorpus).toHaveBeenCalledTimes(0);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it("compares recent jobs to resume skills on follow-up", async () => {
    const result = await runJobAssistant(
      {
        question: "Which of these jobs best matches my resume?",
        sessionSkills: ["React", "TypeScript"],
        recentJobs: [
          {
            id: "live-1",
            title: "Approved React Engineer",
            description: "Build UI with React and TypeScript.",
            location: "Dhaka",
            job_type: "full_time",
            company_name: "HireHub Demo Co",
          },
          {
            id: "hr-1",
            title: "HR Coordinator",
            description: "People operations.",
            location: "Dhaka",
            job_type: "full_time",
            company_name: "Other Co",
          },
        ],
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations.some((j) => j.id === "live-1")).toBe(true);
    expect(result.liveCitations.every((j) => j.id !== "hr-1")).toBe(true);
  });

  it("answers resume skill inventory without searching jobs", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));
    const result = await runJobAssistant(
      {
        question: "What skills did you find in my resume?",
        sessionSkills: ["React", "SQL"],
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs,
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(false);
    expect(result.liveCitations).toHaveLength(0);
    expect(result.answer).toMatch(/React/);
    expect(result.answer).toMatch(/SQL/);
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
  });

  it("processes DOCX text for resume matching when extractor succeeds", async () => {
    const result = await runJobAssistant(
      {
        question: "Find jobs based on my resume",
        attachmentBase64: "a".repeat(64),
        attachmentMeta: {
          name: "cv.docx",
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: 1200,
          kind: "docx",
        },
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({
          ok: true,
          jobs: [
            {
              ...liveJob,
              description: "Need Laravel and Vue experience.",
            },
          ],
        }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
        extractDocx: async () => ({
          ok: true,
          text: "Skills: Laravel, Vue, PHP",
        }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumeProcess?.status).toBe("read");
    expect(result.liveCitations[0]?.matchedSkills).toEqual(
      expect.arrayContaining(["Laravel", "Vue"]),
    );
  });

  it("analyzes an image when asked what is in it", async () => {
    const result = await runJobAssistant(
      {
        question: "What is in this image?",
        attachmentBase64: "a".repeat(64),
        attachmentMeta: {
          name: "shot.png",
          mime: "image/png",
          sizeBytes: 800,
          kind: "image",
        },
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
        analyzeImage: async () => ({
          ok: true,
          text: "A screenshot of a dashboard with charts.",
        }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(false);
    expect(result.liveCitations).toHaveLength(0);
    expect(result.answer).toMatch(/dashboard/i);
    expect(result.resumeProcess?.status).toBe("processed");
  });

  it("answers open-ended guidance via LLM instead of claiming no jobs", async () => {
    const generateAnswer = vi.fn(async () => ({
      ok: true as const,
      text: "There are no software roles on Mars today. Focus on terrestrial developer skills first.",
    }));
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [] }));
    const result = await runJobAssistant(
      { question: "Tell me about obscure roles on Mars" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs,
        generateAnswer,
      },
    );
    expect(isInsufficientContext({ corpusCount: 0, liveCount: 0, ragAvailable: true })).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.soughtLiveJobs).toBe(false);
      expect(result.liveCitations).toHaveLength(0);
      expect(result.answer).toMatch(/Mars/i);
    }
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
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
