import { describe, expect, it, vi } from "vitest";
import * as supervisorModule from "@/lib/ai/agents/supervisor";
import { runSupervisor } from "@/lib/ai/agents/supervisor";
import { invokeRecruiterAgentViaSupervisor } from "@/lib/ai/recruiter-via-supervisor";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OWNER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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

describe("Phase 7 recruiter — supervisor orchestration", () => {
  it("routes structured shortlist directive to recruiter specialist", async () => {
    const runRecruiterAgent = vi.fn(async () => ({
      ok: true as const,
      message: "Confirm to mark this applicant as shortlisted.",
      specialist: { ok: true, status: "needs_confirm" as const },
    }));

    const result = await runSupervisor(
      {
        question: `Shortlist application ${APP_ID}.`,
        recruiterDirective: {
          kind: "shortlist",
          applicationId: APP_ID,
          confirm: false,
        },
      },
      {
        role: "recruiter",
        userId: OWNER_ID,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runRecruiterAgent,
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );

    expect(runRecruiterAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "shortlist",
        applicationId: APP_ID,
        confirm: false,
        confirmSend: false,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.supervisor?.routedTo).toBe("recruiter");
      expect(result.model).toBe("recruiter-agent");
    }
  });

  it("prefers shortlist over outreach when one UUID appears in a shortlist request", async () => {
    const runRecruiterAgent = vi.fn(async () => ({
      ok: true as const,
      message: "Shortlist queued.",
      specialist: {},
    }));

    await runSupervisor(
      {
        question: `Please shortlist this applicant for application ${APP_ID}`,
      },
      {
        role: "recruiter",
        userId: OWNER_ID,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runRecruiterAgent,
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );

    expect(runRecruiterAgent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "shortlist", applicationId: APP_ID }),
    );
    expect(runRecruiterAgent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "draft_outreach" }),
    );
  });

  it("routes explicit outreach request to draft_outreach with job id", async () => {
    const runRecruiterAgent = vi.fn(async () => ({
      ok: true as const,
      message: "Draft ready.",
      specialist: {},
    }));

    await runSupervisor(
      {
        question: `Draft outreach email campaign for job ${JOB_ID}`,
        recruiterJobId: JOB_ID,
      },
      {
        role: "recruiter",
        userId: OWNER_ID,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runRecruiterAgent,
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );

    expect(runRecruiterAgent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "draft_outreach", jobId: JOB_ID, confirmSend: false }),
    );
  });

  it("rejects non-owner recruiter via specialist forbidden result", async () => {
    const runRecruiterAgent = vi.fn(async () => ({
      ok: false as const,
      code: "forbidden" as const,
      message: "You can only shortlist applicants for jobs you own.",
    }));

    const result = await runSupervisor(
      {
        question: `Shortlist application ${APP_ID}.`,
        recruiterDirective: {
          kind: "shortlist",
          applicationId: APP_ID,
          confirm: true,
        },
      },
      {
        role: "recruiter",
        userId: OTHER_ID,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runRecruiterAgent,
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
      expect(result.supervisor?.routedTo).toBe("recruiter");
    }
  });

  it("draft_outreach directive never auto-sends (confirmSend false from supervisor NL path)", async () => {
    const runRecruiterAgent = vi.fn(async () => ({
      ok: true as const,
      message: "Outreach draft created.",
      specialist: { ok: true, send: undefined },
    }));

    await runSupervisor(
      {
        question: `Draft outreach email campaign for job ${JOB_ID}`,
      },
      {
        role: "recruiter",
        userId: OWNER_ID,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runRecruiterAgent,
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );

    expect(runRecruiterAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "draft_outreach",
        jobId: JOB_ID,
        confirmSend: false,
      }),
    );
  });

  it("seeker discovery routing unchanged", async () => {
    const result = await runSupervisor(
      { question: "Find React jobs in Dhaka" },
      {
        role: "seeker",
        userId: OWNER_ID,
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: async () => {
          throw new Error("legacy should not run");
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.supervisor?.routedTo).toBe("discovery");
      expect(result.liveCitations[0]?.id).toBe("live-1");
    }
  });
});

describe("Phase 7 recruiter API — must enter through runSupervisor", () => {
  it("shortlist action delegates through runSupervisor", async () => {
    const spy = vi.spyOn(supervisorModule, "runSupervisor").mockResolvedValue({
      ok: true,
      answer: "stub",
      insufficientContext: false,
      ragAvailable: false,
      liveJobsAvailable: false,
      soughtLiveJobs: false,
      corpusCitations: [],
      liveCitations: [],
      model: "recruiter-agent",
      supervisor: { routedTo: "recruiter", piiRedacted: false, fairnessAction: "skipped", memoryWritten: false },
      recruiterSpecialist: { ok: true, status: "needs_confirm", message: "Confirm" },
    });

    await invokeRecruiterAgentViaSupervisor(
      { supabase: {} as never, userId: OWNER_ID, role: "recruiter" },
      { action: "shortlist", applicationId: APP_ID, confirm: false },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const turnInput = spy.mock.calls[0]![0];
    expect(turnInput.recruiterDirective).toEqual(
      expect.objectContaining({ kind: "shortlist", applicationId: APP_ID, confirm: false }),
    );

    spy.mockRestore();
  });

  it("draft_outreach action delegates through runSupervisor", async () => {
    const spy = vi.spyOn(supervisorModule, "runSupervisor").mockResolvedValue({
      ok: true,
      answer: "stub",
      insufficientContext: false,
      ragAvailable: false,
      liveJobsAvailable: false,
      soughtLiveJobs: false,
      corpusCitations: [],
      liveCitations: [],
      model: "recruiter-agent",
      supervisor: { routedTo: "recruiter", piiRedacted: false, fairnessAction: "skipped", memoryWritten: false },
      recruiterSpecialist: { ok: true, message: "draft", campaign: {}, preview: {} },
    });

    await invokeRecruiterAgentViaSupervisor(
      { supabase: {} as never, userId: OWNER_ID, role: "recruiter" },
      { action: "draft_outreach", jobId: JOB_ID, confirmSend: false },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].recruiterDirective).toEqual(
      expect.objectContaining({ kind: "draft_outreach", jobId: JOB_ID }),
    );

    spy.mockRestore();
  });

  it("supervised action delegates through runSupervisor without structured directive", async () => {
    const spy = vi.spyOn(supervisorModule, "runSupervisor").mockResolvedValue({
      ok: true,
      answer: "help",
      insufficientContext: false,
      ragAvailable: false,
      liveJobsAvailable: false,
      soughtLiveJobs: false,
      corpusCitations: [],
      liveCitations: [],
      model: "recruiter-supervisor",
      supervisor: { routedTo: "legacy", piiRedacted: false, fairnessAction: "skipped", memoryWritten: false },
    });

    const result = await invokeRecruiterAgentViaSupervisor(
      { supabase: {} as never, userId: OWNER_ID, role: "recruiter" },
      { action: "supervised", question: "What can you help me with?" },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].recruiterDirective).toBeUndefined();
    expect(result).toHaveProperty("supervisor");

    spy.mockRestore();
  });
});
