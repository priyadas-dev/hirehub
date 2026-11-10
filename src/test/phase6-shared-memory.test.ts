import { beforeEach, describe, expect, it, vi } from "vitest";
import { runDiscoveryAgent } from "@/lib/ai/agents/discovery";
import { runSupervisor } from "@/lib/ai/agents/supervisor";
import {
  createServerAgentMemory,
  extractSearchPreferences,
} from "@/lib/ai/memory/server-memory";
import type { LiveApprovedJob } from "@/lib/ai/live-recommend";
import { redactPii } from "@/lib/ai/guardrails/pii";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const liveJob: LiveApprovedJob = {
  id: JOB_ID,
  title: "React Engineer",
  description: "Build UI with React and TypeScript.",
  location: "Dhaka",
  status: "approved",
  company_id: "co-1",
  created_at: "2026-11-01T00:00:00.000Z",
  company_name: "Acme",
  job_type: "full_time",
};

function legacyStub() {
  return async () => ({
    ok: true as const,
    answer: "legacy",
    insufficientContext: false,
    ragAvailable: false,
    liveJobsAvailable: false,
    soughtLiveJobs: false,
    corpusCitations: [] as [],
    liveCitations: [] as [],
    model: "legacy",
  });
}

describe("Task 3 shared memory — store helpers", () => {
  const memory = createServerAgentMemory();

  beforeEach(() => {
    memory._resetForTests();
  });

  it("redacts PII before storing turns", () => {
    memory.appendTurn(USER_A, "c1", {
      role: "user",
      text: "Email me at priya@example.com about React jobs",
    });
    const mem = memory.get(USER_A, "c1");
    expect(mem?.turns[0]?.text).toContain("[REDACTED_EMAIL]");
    expect(mem?.turns[0]?.text).not.toContain("priya@example.com");
    expect(mem?.turns[0]?.meta?.piiRedacted).toBe(true);
  });

  it("avoids duplicate consecutive memory entries", () => {
    const first = memory.appendTurn(USER_A, "c1", { role: "user", text: "Find React jobs" });
    const second = memory.appendTurn(USER_A, "c1", { role: "user", text: "Find React jobs" });
    expect(first.appended).toBe(true);
    expect(second.appended).toBe(false);
    expect(memory.get(USER_A, "c1")?.turns).toHaveLength(1);
  });

  it("isolates memory by user", () => {
    memory.appendTurn(USER_A, "shared-label", { role: "user", text: "I know React" });
    memory.mergeSkills(USER_A, "shared-label", ["React"]);
    memory.appendTurn(USER_B, "shared-label", { role: "user", text: "I know Python" });
    memory.mergeSkills(USER_B, "shared-label", ["Python"]);

    expect(memory.get(USER_A, "shared-label")?.skills).toEqual(["React"]);
    expect(memory.get(USER_B, "shared-label")?.skills).toEqual(["Python"]);
    expect(memory.getDiscoveryBundle(USER_A, "shared-label").conversationContext).toMatch(/React/);
    expect(memory.getDiscoveryBundle(USER_A, "shared-label").conversationContext).not.toMatch(/Python/);
  });

  it("isolates memory by conversation", () => {
    memory.mergeSkills(USER_A, "conv-1", ["React"]);
    memory.mergeSkills(USER_A, "conv-2", ["SQL"]);
    expect(memory.getDiscoveryBundle(USER_A, "conv-1").skills).toEqual(["React"]);
    expect(memory.getDiscoveryBundle(USER_A, "conv-2").skills).toEqual(["SQL"]);
  });

  it("extracts location/remote preferences from redacted text", () => {
    const prefs = extractSearchPreferences("Find React jobs in Dhaka that are remote");
    expect(prefs.locations.some((l) => /dhaka/i.test(l))).toBe(true);
    expect(prefs.remotePreferred).toBe(true);
  });

  it("process-local module Map is cleared on restart semantics (_resetForTests)", () => {
    memory.mergeSkills(USER_A, "restart-demo", ["React"]);
    memory.mergePreferences(USER_A, "restart-demo", {
      locations: ["Dhaka"],
      remotePreferred: false,
      keywords: ["React"],
    });
    memory.rememberRecentJobs(USER_A, "restart-demo", [
      { id: JOB_ID, title: "React Engineer", location: "Dhaka" },
    ]);
    expect(memory.get(USER_A, "restart-demo")?.skills).toContain("React");

    // createServerAgentMemory() instances share one module-level Map in-process.
    // A server restart clears that Map — simulated here with _resetForTests().
    memory._resetForTests();
    expect(memory.get(USER_A, "restart-demo")).toBeNull();
    expect(memory.getDiscoveryBundle(USER_A, "restart-demo").skills).toEqual([]);
    expect(memory.getApplicationBundle(USER_A, "restart-demo").recentJobs).toEqual([]);
  });
});

describe("Task 3 shared memory — Discovery consumption", () => {
  it("reuses prior skills and search hints from memory", async () => {
    const listLiveJobs = vi.fn(async (question: string) => {
      expect(question).toMatch(/Dhaka|remote|React/i);
      return { ok: true as const, jobs: [liveJob] };
    });

    const result = await runDiscoveryAgent(
      {
        question: "Find more suitable jobs for me",
        memory: {
          skills: ["React", "TypeScript"],
          searchHints: "Dhaka remote",
          conversationContext: "User: I know React and TypeScript\nAssistant: Here are matches",
        },
      },
      { listLiveJobs },
    );

    expect(result.ok).toBe(true);
    expect(listLiveJobs).toHaveBeenCalled();
    const calledQuestion = listLiveJobs.mock.calls[0]![0] as string;
    expect(calledQuestion).toMatch(/Dhaka|remote/i);
  });

  it("supervisor passes stored context into Discovery on follow-up", async () => {
    const memory = createServerAgentMemory();
    memory._resetForTests();

    const listLiveJobs = vi.fn(async () => ({ ok: true as const, jobs: [liveJob] }));

    await runSupervisor(
      { question: "I know React. Find jobs in Dhaka" },
      {
        role: "seeker",
        userId: USER_A,
        conversationId: "mem-1",
        memory,
        listLiveJobs,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacyStub(),
      },
    );

    const bundle = memory.getDiscoveryBundle(USER_A, "mem-1");
    expect(bundle.skills.some((s) => /react/i.test(s))).toBe(true);
    expect(bundle.conversationContext.length).toBeGreaterThan(0);
    expect(bundle.searchHints.length).toBeGreaterThan(0);
    expect(memory.getApplicationBundle(USER_A, "mem-1").recentJobs[0]?.id).toBe(JOB_ID);

    listLiveJobs.mockClear();
    await runSupervisor(
      { question: "Show me more matching jobs" },
      {
        role: "seeker",
        userId: USER_A,
        conversationId: "mem-1",
        memory,
        listLiveJobs,
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacyStub(),
      },
    );

    expect(listLiveJobs).toHaveBeenCalled();
    const followUpQuestion = String(listLiveJobs.mock.calls[0]![0]);
    // Preference hints from prior turn should enrich the follow-up search.
    expect(followUpQuestion.toLowerCase()).toMatch(/dhaka|remote|react/);
  });
});

describe("Task 3 shared memory — Application scoped access + regressions", () => {
  it("Application can resolve recent jobs from memory without full transcript", async () => {
    const memory = createServerAgentMemory();
    memory._resetForTests();
    memory.rememberRecentJobs(USER_A, "app-1", [
      { id: JOB_ID, title: "React Engineer", location: "Dhaka" },
    ]);

    const runApply = vi.fn(async () => ({
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
      { question: "Please apply to the first job" },
      {
        role: "seeker",
        userId: USER_A,
        conversationId: "app-1",
        memory,
        runApplicationAgent: runApply,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacyStub(),
      },
    );

    expect(runApply).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB_ID,
        confirm: false,
        recentJobs: expect.arrayContaining([expect.objectContaining({ id: JOB_ID })]),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pendingApply?.jobId).toBe(JOB_ID);
  });

  it("preserves Save Job routing with memory present", async () => {
    const memory = createServerAgentMemory();
    memory._resetForTests();
    memory.rememberRecentJobs(USER_A, "save-1", [
      { id: JOB_ID, title: "React Engineer", location: "Dhaka" },
    ]);

    const runSave = vi.fn(async () => ({
      ok: true as const,
      status: "saved" as const,
      savedJobId: "saved-1",
      jobId: JOB_ID,
      title: "React Engineer",
      message: "Saved.",
    }));

    const result = await runSupervisor(
      { question: "Please save this job" },
      {
        role: "seeker",
        userId: USER_A,
        conversationId: "save-1",
        memory,
        runSaveJobTool: runSave,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacyStub(),
      },
    );

    expect(runSave).toHaveBeenCalledWith(expect.objectContaining({ jobId: JOB_ID }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.saveOutcome?.status).toBe("saved");
  });

  it("preserves Check Status routing", async () => {
    const runStatus = vi.fn(async () => ({
      ok: true as const,
      applications: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "applied",
          createdAt: "2026-11-01T00:00:00.000Z",
          jobId: JOB_ID,
          jobTitle: "React Engineer",
          companyName: "Acme",
          location: "Dhaka",
        },
      ],
      message: "Your application is applied.",
    }));

    const result = await runSupervisor(
      { question: "Check my application status" },
      {
        role: "seeker",
        userId: USER_A,
        conversationId: "status-1",
        memory: createServerAgentMemory(),
        runCheckApplicationStatusTool: runStatus,
        listLiveJobs: async () => ({ ok: true, jobs: [] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacyStub(),
      },
    );

    expect(runStatus).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.applicationStatuses?.[0]?.status).toBe("applied");
  });

  it("does not store raw PII from supervisor user turns", async () => {
    const memory = createServerAgentMemory();
    memory._resetForTests();
    const raw = "Find React jobs and email me at seeker@hirehub.test";
    expect(redactPii(raw).redacted).toBe(true);

    await runSupervisor(
      { question: raw },
      {
        role: "seeker",
        userId: USER_A,
        conversationId: "pii-1",
        memory,
        listLiveJobs: async () => ({ ok: true, jobs: [liveJob] }),
        retrieveCorpus: async () => ({ ok: true, matches: [] }),
        runLegacyPipeline: legacyStub(),
      },
    );

    const ctx = memory.toConversationContext(USER_A, "pii-1");
    expect(ctx).toContain("[REDACTED_EMAIL]");
    expect(ctx).not.toContain("seeker@hirehub.test");
  });
});
