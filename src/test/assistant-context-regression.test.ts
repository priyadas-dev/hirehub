import { describe, expect, it, vi } from "vitest";
import { looksLikeDefinitionalQuestion, looksLikeGeneralQuestion } from "@/lib/ai/assistant-intent";
import { runJobAssistant } from "@/lib/ai/job-assistant";
import { parseLiveJobQuery } from "@/lib/ai/live-recommend";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";
import { looksLikeTruncatedAssistantAnswer } from "@/lib/ai/gemini-generate";

const dhakaJob: LiveApprovedJob = {
  id: "dhaka-1",
  title: "Customer Support Associate",
  description: "Help customers from our Dhaka office.",
  location: "Dhaka",
  status: "approved",
  company_id: "co-dhaka",
  created_at: "2026-10-01T00:00:00Z",
  job_type: "full_time",
  company_name: "Dhaka Soft",
};

const remoteJob: LiveApprovedJob = {
  id: "remote-1",
  title: "Software Developer",
  description: "Laravel and Vue remote contract.",
  location: "Remote",
  status: "approved",
  company_id: "co-remote",
  created_at: "2026-10-02T00:00:00Z",
  job_type: "contract",
  company_name: "Manor IT",
};

const pendingDhaka: LiveApprovedJob = {
  ...dhakaJob,
  id: "pending-dhaka",
  status: "pending",
  title: "Pending Dhaka Role",
};

describe("exact browser-failure regressions after resume upload", () => {
  const sessionSkills = ["Communication", "JavaScript", "Python", "Django"];

  it("parses Dhaka without residual chat terms like 'there'", () => {
    const q = "i want a job in dhaka is there any jobs";
    const parsed = parseLiveJobQuery(q);
    expect(parsed.locations).toEqual(["dhaka"]);
    expect(parsed.terms).not.toContain("there");
    expect(parsed.terms).not.toContain("want");
    expect(parsed.terms).not.toContain("jobs");
  });

  it("does not force resume skills for: i want a job in dhaka is there any jobs", async () => {
    const listLiveJobs = vi.fn(async (q: string, options?: { skillTerms?: string[] }) => {
      expect(options?.skillTerms ?? []).toEqual([]);
      expect(q.toLowerCase()).toMatch(/dhaka/);
      return { ok: true as const, jobs: [dhakaJob, remoteJob, pendingDhaka] };
    });

    const result = await runJobAssistant(
      {
        question: "i want a job in dhaka is there any jobs",
        sessionSkills,
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs,
        generateAnswer: async () => ({
          ok: true,
          text: "should not run for location search",
        }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.answer).toMatch(/I found 1 approved HireHub job/i);
    expect(result.answer).not.toMatch(/Communication|JavaScript|Python|Django/i);
    expect(result.liveCitations).toHaveLength(1);
    expect(result.liveCitations[0]?.id).toBe("dhaka-1");
    expect(result.liveCitations[0]?.location).toBe("Dhaka");
    expect(result.liveCitations[0]?.matchedSkills).toBeUndefined();
  });

  it("keeps Dhaka filter for: i want a job in dhaka . is there any jobs ?", async () => {
    const result = await runJobAssistant(
      {
        question: "i want a job in dhaka . is there any jobs ?",
        sessionSkills,
        // Simulate prior resume still reflected in session + optional attachment meta without bytes.
        attachmentMeta: {
          name: "resume.pdf",
          mime: "application/pdf",
          sizeBytes: 1200,
          kind: "pdf",
        },
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async () => ({ ok: true, jobs: [dhakaJob, remoteJob] }),
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.soughtLiveJobs).toBe(true);
    expect(result.liveCitations.every((j) => j.location?.toLowerCase().includes("dhaka"))).toBe(
      true,
    );
    expect(result.answer).not.toMatch(/Communication|Python|Django/i);
  });

  it("answers what is react completely without job/resume context", async () => {
    expect(looksLikeGeneralQuestion("what is react")).toBe(true);
    expect(looksLikeDefinitionalQuestion("what is react")).toBe(true);

    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [dhakaJob] }));
    const retrieveCorpus = vi.fn(async () => ({
      ok: true as const,
      matches: [
        {
          id: "c1",
          corpus_key: "synthetic:v1:00001",
          title: "Unrelated corpus",
          content: "SYNTHETIC TRAINING DOCUMENT — sales practice only.",
          location: "Dhaka",
          category: "sales",
          skills_text: "sales",
          is_synthetic: true,
          source: "hirehub-synthetic-v1",
          similarity: 0.4,
        },
      ],
    }));
    const generateAnswer = vi.fn(async (prompt: string) => {
      expect(prompt).toMatch(/Seeker question: what is react/i);
      expect(prompt).not.toMatch(
        /=== SYNTHETIC CORPUS|LIVE APPROVED HIREHUB|Attachment context:\n|Communication,/i,
      );
      return {
        ok: true as const,
        text: "React is a JavaScript library for building user interfaces. Developers use it to create reusable components for web apps.",
      };
    });

    const result = await runJobAssistant(
      {
        question: "what is react",
        sessionSkills,
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
    expect(result.answer).toMatch(/JavaScript library/i);
    expect(result.answer).not.toMatch(/current context doesn't list/i);
    expect(result.answer).not.toMatch(/Communication|Django/i);
    expect(listLiveJobs).toHaveBeenCalledTimes(0);
    expect(retrieveCorpus).toHaveBeenCalledTimes(0);
    expect(generateAnswer).toHaveBeenCalledTimes(1);
  });

  it("still uses resume skills only when explicitly asked after prior upload", async () => {
    const result = await runJobAssistant(
      {
        question: "Find jobs matching my resume",
        sessionSkills,
      },
      {
        role: "seeker",
        geminiConfigured: true,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        listLiveJobs: async (_q, options) => {
          expect(options?.skillTerms).toEqual(
            expect.arrayContaining(["JavaScript", "Python", "Django"]),
          );
          return {
            ok: true,
            jobs: [
              {
                ...remoteJob,
                description: "Need JavaScript and Python.",
              },
            ],
          };
        },
        generateAnswer: async () => ({ ok: true, text: "should not run" }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.liveCitations[0]?.matchedSkills?.length).toBeGreaterThan(0);
  });

  it("flags the incomplete React fragment as truncated", () => {
    expect(
      looksLikeTruncatedAssistantAnswer(
        "While our current context doesn't list specific details or active job openings for it, React",
      ),
    ).toBe(true);
    expect(
      looksLikeTruncatedAssistantAnswer(
        "React is a JavaScript library for building user interfaces. It is commonly used for interactive web apps.",
      ),
    ).toBe(false);
  });
});
