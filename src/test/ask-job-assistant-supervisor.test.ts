import { describe, expect, it, vi } from "vitest";
import * as supervisorModule from "@/lib/ai/agents/supervisor";
import { runSeekerAskJobAssistantViaSupervisor } from "@/lib/ai/ask-job-assistant";

describe("ask-job-assistant production entry", () => {
  it("routes seeker requests through runSupervisor", async () => {
    const spy = vi.spyOn(supervisorModule, "runSupervisor").mockResolvedValue({
      ok: true,
      answer: "stub",
      insufficientContext: false,
      ragAvailable: false,
      liveJobsAvailable: false,
      soughtLiveJobs: false,
      corpusCitations: [],
      liveCitations: [],
      model: "discovery-agent",
      supervisor: {
        routedTo: "discovery",
        piiRedacted: false,
        fairnessAction: "pass",
        memoryWritten: true,
      },
    });

    await runSeekerAskJobAssistantViaSupervisor(
      { question: "Find React jobs in Dhaka" },
      {
        supabase: {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        } as never,
        userId: "11111111-1111-4111-8111-111111111111",
        role: "seeker",
      },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![1].runLegacyPipeline).toBeDefined();
    expect(spy.mock.calls[0]![1].runApplicationAgent).toBeDefined();
    expect(spy.mock.calls[0]![1].conversationId).toBe("seeker-assistant");

    spy.mockRestore();
  });

  it("passes confirmApply and applyJobId through to supervisor input", async () => {
    const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const spy = vi.spyOn(supervisorModule, "runSupervisor").mockResolvedValue({
      ok: true,
      answer: "Confirm",
      insufficientContext: false,
      ragAvailable: false,
      liveJobsAvailable: false,
      soughtLiveJobs: false,
      corpusCitations: [],
      liveCitations: [],
      model: "application-agent",
      pendingApply: { jobId, title: "Engineer", requiresConfirm: true },
      supervisor: {
        routedTo: "application",
        piiRedacted: false,
        fairnessAction: "pass",
        memoryWritten: true,
      },
    });

    await runSeekerAskJobAssistantViaSupervisor(
      {
        question: "Please apply to this job",
        applyJobId: jobId,
        confirmApply: false,
      },
      {
        supabase: {} as never,
        userId: "11111111-1111-4111-8111-111111111111",
        role: "seeker",
      },
    );

    expect(spy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ applyJobId: jobId, confirmApply: false }),
    );

    spy.mockRestore();
  });
});
