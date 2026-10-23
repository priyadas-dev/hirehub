import { describe, expect, it, vi } from "vitest";
import { runJobAssistant } from "@/lib/ai/job-assistant";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const liveJob: LiveApprovedJob = {
  id: "52267b9c-77c4-44e8-83c5-0347aa5ac593",
  title: "Software Developer",
  description: "Need Laravel and Vue skills for a personal web panel.",
  location: "Remote",
  status: "approved",
  company_id: "8916ba20-f002-4ea0-9aab-d710d0f1a170",
  created_at: "2026-10-01T00:00:00Z",
  job_type: "contract",
  company_name: "Manor IT",
};

const salesCorpus = {
  id: "c-sales",
  corpus_key: "synthetic:v1:04445",
  title: "Lead Sales Development Representative",
  content: "SYNTHETIC sales practice",
  location: "Dhaka",
  category: "sales",
  skills_text: "sales",
  is_synthetic: true,
  source: "hirehub-synthetic-v1",
  similarity: 0.9,
};

describe("resume and skill-based assistant matching", () => {
  it("matches approved jobs from typed skills and never cites synthetic corpus", async () => {
    const retrieveCorpus = vi.fn(async () => ({ ok: true as const, matches: [salesCorpus] }));
    const result = await runJobAssistant(
      { question: "I know Laravel and Vue. Find suitable jobs" },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus,
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveCitations).toHaveLength(1);
    expect(result.liveCitations[0]?.title).toBe("Software Developer");
    expect(result.liveCitations[0]?.matchedSkills).toEqual(
      expect.arrayContaining(["Laravel", "Vue"]),
    );
    expect(result.liveCitations[0]?.matchReason).toMatch(/Laravel|Vue/i);
    expect(result.corpusCitations).toHaveLength(0);
    expect(JSON.stringify(result)).not.toMatch(/Lead Sales Development Representative/);
    expect(retrieveCorpus).toHaveBeenCalledTimes(0);
  });

  it("processes resume PDF text via injected extractor and ranks jobs", async () => {
    const result = await runJobAssistant(
      {
        question: "Show me jobs that match based on my resume",
        attachmentMeta: {
          name: "priya-resume.pdf",
          mime: "application/pdf",
          sizeBytes: 1200,
        },
        resumePdfBase64: "a".repeat(64),
      },
      {
        role: "seeker",
        geminiConfigured: true,
        extractResumePdf: async () => ({
          ok: true,
          text: "Priya Das — Software Developer. Skills: React, TypeScript, Laravel, Vue, SQL.",
        }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async (_q, options) => {
          expect(options?.skillTerms?.length).toBeGreaterThan(0);
          return { ok: true, jobs: [liveJob] };
        },
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumeProcess?.status).toBe("read");
    if (result.resumeProcess?.status === "read") {
      expect(result.resumeProcess.skills).toEqual(
        expect.arrayContaining(["React", "Laravel", "Vue", "SQL"]),
      );
    }
    expect(result.sessionSkills?.length).toBeGreaterThan(0);
    expect(result.liveCitations[0]?.title).toBe("Software Developer");
    expect(JSON.stringify(result)).not.toMatch(/Priya Das — Software Developer/);
  });

  it("fails honestly when PDF metadata is sent without bytes", async () => {
    const result = await runJobAssistant(
      {
        question: "Find jobs based on my resume",
        attachmentMeta: {
          name: "cv.pdf",
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
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("resume_unreadable");
      expect(result.message).toMatch(/filename|contents/i);
    }
  });

  it("remote follow-up filters jobs without forcing resume skill ranking", async () => {
    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));
    const result = await runJobAssistant(
      {
        question: "Are any of these remote?",
        sessionSkills: ["Laravel", "Vue"],
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
    expect(result.liveCitations.some((j) => j.location?.toLowerCase().includes("remote"))).toBe(
      true,
    );
    expect(result.liveCitations[0]?.matchedSkills).toBeUndefined();
    expect(listLiveJobs.mock.calls[0]?.[1]?.skillTerms ?? []).toEqual([]);
  });

  it("still uses session skills when the user explicitly asks for resume matching", async () => {
    const result = await runJobAssistant(
      {
        question: "Show me jobs that match based on my resume",
        sessionSkills: ["Laravel", "Vue"],
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [salesCorpus] }),
        listLiveJobs: async (_q, options) => {
          expect(options?.skillTerms).toEqual(expect.arrayContaining(["Laravel", "Vue"]));
          return { ok: true, jobs: [liveJob] };
        },
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveCitations[0]?.matchedSkills).toEqual(
      expect.arrayContaining(["Laravel", "Vue"]),
    );
  });
});
